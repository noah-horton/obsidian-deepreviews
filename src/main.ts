import { FileSystemAdapter, MarkdownView, Notice, Plugin, TFile, TFolder } from 'obsidian';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DEFAULT_SETTINGS, startAgent, type AgentRun, type AgentSettings } from './agent';
import { SchemaFooter, type ReviewFeedback } from './footer';
import { PairedRenamer } from './paired-rename';
import { FolderNoteExplorer } from './explorer';
import { appendFolderRequirements, folderForNote, noteForFolder, type FolderRequirement } from './folder-notes';
import { reviewFeedback } from './feedback';
import { GlobalSchemasModal, ReviewModal } from './modals';
import { buildReviewPrompt } from './prompt';
import { obsidianCliExecutable } from './obsidian-cli';
import { DEFAULT_SCHEMA, resolveSchema, type SchemaSource } from './schema';
import { DeepReviewsSettings } from './settings';
import { remapPaths, SchemaStore } from './storage';

interface Mount {
  view: MarkdownView;
  file: TFile;
  path: string;
  footer: SchemaFooter;
  observer: MutationObserver;
  revision: number;
  source?: SchemaSource;
  globals: Map<string, SchemaSource>;
  saveError?: string;
  inherited: FolderRequirement[];
  folderRevision: number;
}
interface PluginSettings extends AgentSettings {
  defaultSchema: string;
  footerExpandedHeight?: number;
  footerCollapsedHeight: number;
}
interface PluginData { settings: PluginSettings; selections: Record<string, string> }
export default class DeepReviewsPlugin extends Plugin {
  settings: PluginSettings = { ...DEFAULT_SETTINGS, defaultSchema: DEFAULT_SCHEMA, footerCollapsedHeight: 64 };
  private selections: Record<string, string> = {};
  private mounts = new Map<MarkdownView, Mount>();
  private explorers = new Map<HTMLElement, FolderNoteExplorer>();
  private folderWrites = new Map<string, number>();
  private folderSaveErrors = new Map<string, string>();
  private runs = new Map<TFile, Pick<AgentRun, 'cancel'>>();
  private feedback = new Map<TFile, ReviewFeedback>();
  private store!: SchemaStore;
  private saveTail: Promise<unknown> = Promise.resolve();
  private disposed = false;

  async onload(): Promise<void> {
    const data = await this.loadData() as Partial<PluginData> | null;
    this.settings = { ...DEFAULT_SETTINGS, defaultSchema: DEFAULT_SCHEMA, footerCollapsedHeight: 64, ...data?.settings };
    if (typeof this.settings.defaultSchema !== 'string') this.settings.defaultSchema = DEFAULT_SCHEMA;
    if (typeof this.settings.footerExpandedHeight !== 'number' || !Number.isFinite(this.settings.footerExpandedHeight) || this.settings.footerExpandedHeight < 80) delete this.settings.footerExpandedHeight;
    if (typeof this.settings.footerCollapsedHeight !== 'number' || !Number.isFinite(this.settings.footerCollapsedHeight) || this.settings.footerCollapsedHeight < 48 || this.settings.footerCollapsedHeight >= 80) this.settings.footerCollapsedHeight = 64;
    if (this.settings.agent !== 'codex' && this.settings.agent !== 'claude' && this.settings.agent !== 'custom') this.settings.agent = 'codex';
    if (typeof this.settings.model !== 'string') this.settings.model = '';
    this.selections = Object.fromEntries(Object.entries(data?.selections ?? {}).filter(([, v]) => typeof v === 'string'));
    this.store = new SchemaStore(this.app.vault.adapter, () => this.settings.defaultSchema);
    this.installPairedRenames();
    this.addSettingTab(new DeepReviewsSettings(this.app, this));
    this.addCommand({ id: 'review-current-note', name: 'Review current note', checkCallback: checking => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view?.file) return false;
      if (!checking) void this.review(view);
      return true;
    } });
    this.addCommand({ id: 'manage-global-schemas', name: 'Manage global schemas', callback: () => this.openGlobals() });
    this.addCommand({ id: 'reload-schemas', name: 'Reload schemas', callback: () => this.refreshAll() });
    this.registerEvent(this.app.workspace.on('layout-change', () => this.reconcile()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.reconcile()));
    this.registerEvent(this.app.workspace.on('file-open', () => { this.reconcile(); this.refreshAll(); }));
    this.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (file instanceof TFile && file.extension === 'md' && !this.backingFolder(file.path)) {
        menu.addItem(item => item.setTitle('Convert to Folder').setIcon('folder-plus').onClick(() => {
          void this.convertToFolder(file).catch(error => new Notice(`DeepReviews: ${String(error)}`));
        }));
      } else if (file instanceof TFolder && !file.isRoot() && !this.pairedNote(file.path)) {
        menu.addItem(item => item.setTitle('Create Note for Folder').setIcon('file-plus').onClick(() => {
          void this.createFolderNote(file).catch(error => new Notice(`DeepReviews: ${String(error)}`));
        }));
      }
    }));
    this.registerEvent(this.app.vault.on('create', () => { this.reconcile(); this.refreshAll(); }));
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      this.selections = remapPaths(this.selections, oldPath, file.path);
      this.persistSettings();
      if (file instanceof TFolder) this.folderSaveErrors = new Map(Object.entries(remapPaths(Object.fromEntries(this.folderSaveErrors), oldPath, file.path)));
      this.reconcileExplorers();
      // Queue sidecar relocation before any new-path editor saves can occur.
      const move = file instanceof TFile ? this.store.renameNote(oldPath, file.path) : Promise.resolve();
      for (const mount of this.mounts.values()) {
        if (mount.path === oldPath || (file instanceof TFolder && mount.path.startsWith(oldPath + '/'))) {
          mount.path = file.path + mount.path.slice(oldPath.length);
          mount.revision++;
        }
      }
      void move.then(() => this.refreshAll(), error => { new Notice(`DeepReviews: ${String(error)}`, 12000); this.refreshAll(); });
    }));
    this.registerEvent(this.app.vault.on('delete', file => {
      if (file instanceof TFile) { this.runs.get(file)?.cancel(); this.feedback.delete(file); }
      for (const key of Object.keys(this.selections)) if (key === file.path || key.startsWith(file.path + '/')) delete this.selections[key];
      this.persistSettings();
      this.reconcile(); this.refreshAll();
    }));
    this.app.workspace.onLayoutReady(() => { if (!this.disposed) this.reconcile(); });
    // Mode changes and restored/popout leaves do not all emit file-open.
    this.registerInterval(window.setInterval(() => this.reconcile(), 1500));
  }

  private installPairedRenames(): void {
    const manager = this.app.fileManager;
    const original = manager.renameFile;
    const renamer = new PairedRenamer({
      get: path => this.app.vault.getAbstractFileByPath(path),
      isFolder: file => file instanceof TFolder,
      rename: (file, path) => original.call(manager, file, path),
      prepareNoteRename: (from, to) => this.store.checkRenameNote(from, to),
      finishNoteRename: (from, to) => this.store.renameNote(from, to),
      flush: () => this.store.flush()
    });
    let enabled = true;
    const wrapped: typeof original = (file, path) => enabled ? renamer.rename(file, path) : original.call(manager, file, path);
    manager.renameFile = wrapped;
    this.register(() => {
      enabled = false;
      if (manager.renameFile === wrapped) manager.renameFile = original;
    });
  }
  private backingFolder(note: string): TFolder | undefined {
    const path = folderForNote(note);
    const folder = path ? this.app.vault.getAbstractFileByPath?.(path) : null;
    return folder instanceof TFolder ? folder : undefined;
  }
  private pairedNote(folder: string): TFile | undefined {
    const note = this.app.vault.getAbstractFileByPath(noteForFolder(folder));
    return note instanceof TFile && note.extension === 'md' ? note : undefined;
  }
  private async convertToFolder(file: TFile): Promise<void> {
    const path = folderForNote(file.path);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && !(existing instanceof TFolder)) throw new Error(`Cannot create folder: ${path} already exists.`);
    if (!existing) await this.app.vault.createFolder(path);
    this.reconcile(); this.refreshAll();
  }
  private async createFolderNote(folder: TFolder): Promise<void> {
    const path = noteForFolder(folder.path);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing && !(existing instanceof TFile)) throw new Error(`Cannot create note: ${path} already exists.`);
    const note = existing instanceof TFile ? existing : await this.app.vault.create(path, '');
    await this.app.workspace.getLeaf(false).openFile(note);
    this.reconcile(); this.refreshAll();
  }
  private reconcileExplorers(): void {
    const live = new Set<HTMLElement>();
    for (const leaf of this.app.workspace.getLeavesOfType('file-explorer')) {
      const root = leaf.view.containerEl;
      live.add(root);
      if (!this.explorers.has(root)) this.explorers.set(root, new FolderNoteExplorer(root, {
        pairedNote: folder => this.pairedNote(folder)?.path,
        activeNote: () => this.app.workspace.getActiveFile()?.path,
        openNote: path => {
          const file = this.app.vault.getAbstractFileByPath(path);
          if (file instanceof TFile) void this.app.workspace.getLeaf(false).openFile(file)
            .catch(error => new Notice(`DeepReviews: ${String(error)}`));
        }
      }));
      else this.explorers.get(root)!.refresh();
    }
    for (const [root, explorer] of this.explorers) if (!live.has(root)) { explorer.destroy(); this.explorers.delete(root); }
  }
  persistSettings(): void {
    const data: PluginData = { settings: { ...this.settings }, selections: { ...this.selections } };
    const next = this.saveTail.then(() => this.saveData(data));
    this.saveTail = next.catch(error => { new Notice(`DeepReviews settings could not be saved: ${String(error)}`); });
  }
  private updateFooterHeight(height: number, finished: boolean): void {
    if (!Number.isFinite(height) || height < 80) return;
    this.settings.footerExpandedHeight = height;
    this.applyFooterHeights();
    if (finished) this.persistSettings();
  }
  private applyFooterHeights(): void {
    for (const mount of this.mounts.values()) mount.footer.setSharedHeights(this.settings.footerExpandedHeight, this.settings.footerCollapsedHeight);
  }
  openGlobals(): void { new GlobalSchemasModal(this.app, this.store, () => this.refreshAll()).open(); }
  private selection(path: string): string { return Object.hasOwn(this.selections, path) ? this.selections[path] : ''; }
  private reconcile(): void {
    if (this.disposed) return;
    this.reconcileExplorers();
    const live = new Set<MarkdownView>();
    this.app.workspace.iterateAllLeaves(leaf => {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || !view.file || view.file.extension !== 'md') return;
      live.add(view);
      let mount = this.mounts.get(view);
      if (mount && (mount.file !== view.file || mount.path !== view.file.path)) {
        this.unmount(mount); this.mounts.delete(view); mount = undefined;
      }
      if (!mount) {
        const footer = new SchemaFooter(view.contentEl.ownerDocument, {
          select: value => {
            const current = this.mounts.get(view);
            if (!current) return;
            if (value) this.selections[current.path] = value; else delete this.selections[current.path];
            this.persistSettings(); this.refreshNote(current.path);
          },
          edit: text => { const current = this.mounts.get(view); if (current) this.editInline(current, text); },
          editFolder: text => { const current = this.mounts.get(view); if (current) this.editFolder(current, text); },
          review: () => { void this.review(view); },
          cancel: () => { const file = view.file; if (file) this.runs.get(file)?.cancel(); },
          manage: () => this.openGlobals(), refresh: () => this.refreshAll(),
          resize: (height, finished) => this.updateFooterHeight(height, finished),
          collapse: (expanded, height) => {
            if (!expanded) this.settings.footerExpandedHeight = height;
            this.applyFooterHeights();
            if (!expanded) this.persistSettings();
          }
        }, { expandedHeight: this.settings.footerExpandedHeight, collapsedHeight: this.settings.footerCollapsedHeight });
        const observer = new MutationObserver(() => {
          if (!this.disposed && !view.contentEl.contains(footer.root)) view.contentEl.append(footer.root);
        });
        mount = { view, file: view.file, path: view.file.path, footer, observer, revision: 0, globals: new Map(), inherited: [], folderRevision: 0 };
        this.mounts.set(view, mount);
        view.contentEl.addClass('deepreviews-has-footer');
        view.contentEl.append(footer.root);
        const feedback = this.feedback.get(view.file);
        if (feedback) footer.setFeedback(feedback);
        footer.setBusy(this.runs.has(view.file));
        observer.observe(view.contentEl, { childList: true });
        void this.loadMount(mount);
      } else if (!view.contentEl.contains(mount.footer.root)) view.contentEl.append(mount.footer.root);
    });
    for (const [view, mount] of this.mounts) if (!live.has(view)) { this.unmount(mount); this.mounts.delete(view); }
  }
  private unmount(mount: Mount): void {
    mount.revision++;
    mount.observer.disconnect(); mount.footer.destroy(); mount.view.contentEl.removeClass('deepreviews-has-footer');
  }
  refreshAll(): void { for (const mount of this.mounts.values()) void this.loadMount(mount); }
  private refreshNote(path: string): void { for (const mount of this.mounts.values()) if (mount.path === path) void this.loadMount(mount); }
  private async loadMount(mount: Mount): Promise<void> {
    const revision = ++mount.revision;
    mount.footer.editor.disabled = true;
    mount.footer.folderEditor.disabled = true;
    mount.footer.review.disabled = true;
    try {
      const globals = await this.store.globals();
      const selected = this.selection(mount.path);
      const source = selected ? globals.get(selected) : await this.store.inline(mount.path);
      const folder = this.backingFolder(mount.path)?.path;
      const [folderText, inherited] = await Promise.all([
        folder ? this.store.folderRequirements(folder) : Promise.resolve(''),
        this.store.inheritedRequirements(mount.path)
      ]);
      if (this.disposed || revision !== mount.revision) return;
      mount.inherited = inherited;
      mount.footer.setFolderRequirements(folder, folderText, inherited);
      mount.globals = globals; mount.source = source;
      mount.footer.setSchemas([...globals.keys()], selected);
      if (!source) throw new Error(`Global schema “${selected}” is missing. Choose another schema or switch to Inline.`);
      mount.footer.setSchema(source.text, source.path, !selected);
      mount.footer.editor.disabled = false;
      mount.saveError = undefined;
      this.validateMount(mount);
    } catch (error) {
      if (revision !== mount.revision) return;
      mount.footer.setStatus(String(error), true);
      mount.footer.review.disabled = true;
    }
  }
  private validateMount(mount: Mount): void {
    mount.footer.setBusy(this.runs.has(mount.file));
    try {
      if (!mount.source) throw new Error('Schema is not loaded.');
      if (mount.saveError) throw new Error(`Save failed: ${mount.saveError}`);
      this.checkFolderSaves(mount.path);
      const resolved = appendFolderRequirements(resolveSchema(mount.source, mount.globals), mount.inherited);
      const count = Object.keys(resolved.schema.requirements ?? {}).length;
      mount.footer.setStatus(`${count} requirement${count === 1 ? '' : 's'} · ${this.selection(mount.path) ? 'Global' : 'Inline'}`);
    } catch (error) { mount.footer.setStatus(String(error), true); mount.footer.review.disabled = true; }
  }
  private editInline(mount: Mount, text: string): void {
    if (this.selection(mount.path) || !mount.source) return;
    mount.source = { ...mount.source, text };
    const revision = ++mount.revision;
    const path = mount.path;
    mount.footer.setStatus('Saving…');
    mount.footer.review.disabled = true;
    // Preserve invalid drafts too; validation only gates Review.
    void this.store.writeInline(path, text).then(() => {
      if (revision !== mount.revision || this.disposed) return;
      mount.saveError = undefined;
      this.validateMount(mount);
      for (const sibling of this.mounts.values()) if (sibling !== mount && sibling.path === path) void this.loadMount(sibling);
    }, error => {
      if (revision !== mount.revision) return;
      mount.saveError = String(error);
      mount.footer.setStatus(`Save failed: ${String(error)}`, true);
    });
  }

  private checkFolderSaves(note: string): void {
    for (const [folder, error] of this.folderSaveErrors) {
      if (note === noteForFolder(folder) || note.startsWith(folder + '/')) throw new Error(`Folder requirements could not be saved for ${folder}: ${error}`);
    }
  }
  private refreshFolderRequirements(): void {
    // Do not disable/reload the schema or focused folder editor on each keystroke.
    for (const mount of this.mounts.values()) void this.loadFolderRequirements(mount);
  }
  private async loadFolderRequirements(mount: Mount): Promise<void> {
    const revision = mount.revision;
    const folderRevision = ++mount.folderRevision;
    try {
      const folder = this.backingFolder(mount.path)?.path;
      const [text, inherited] = await Promise.all([
        folder ? this.store.folderRequirements(folder) : Promise.resolve(''),
        this.store.inheritedRequirements(mount.path)
      ]);
      if (this.disposed || revision !== mount.revision || folderRevision !== mount.folderRevision) return;
      mount.inherited = inherited;
      mount.footer.setFolderRequirements(folder, text, inherited);
      this.validateMount(mount);
    } catch (error) {
      if (this.disposed || revision !== mount.revision || folderRevision !== mount.folderRevision) return;
      mount.footer.setStatus(`Could not load folder requirements: ${String(error)}`, true);
      mount.footer.review.disabled = true;
    }
  }
  private editFolder(mount: Mount, text: string): void {
    const folder = this.backingFolder(mount.path)?.path;
    if (!folder) return;
    ++mount.revision;
    const write = (this.folderWrites.get(folder) ?? 0) + 1;
    this.folderWrites.set(folder, write);
    mount.footer.setStatus('Saving folder requirements…');
    mount.footer.review.disabled = true;
    void this.store.writeFolderRequirements(folder, text).then(() => {
      this.folderSaveErrors.delete(folder);
      if (this.disposed || write !== this.folderWrites.get(folder)) return;
      this.refreshFolderRequirements();
    }, error => {
      this.folderSaveErrors.set(folder, String(error));
      if (this.disposed) return;
      for (const current of this.mounts.values()) this.validateMount(current);
    });
  }

  private showFeedback(file: TFile, feedback: ReviewFeedback): void {
    if (this.disposed) return;
    this.feedback.set(file, feedback);
    for (const mount of this.mounts.values()) if (mount.file === file) mount.footer.setFeedback(feedback);
  }

  private async review(view: MarkdownView): Promise<void> {
    const file = view.file;
    if (!file || this.runs.has(file)) return;
    let cancelled = false;
    let run: AgentRun | undefined;
    this.runs.set(file, { cancel: () => {
      cancelled = true;
      run?.cancel();
      this.showFeedback(file, { text: 'Cancelling…', issue: false });
    } });
    for (const mount of this.mounts.values()) if (mount.file === file) mount.footer.setBusy(true);
    this.showFeedback(file, { text: 'Preparing review…', issue: false });
    let stdout = '', stderr = '';
    let artifactRoot: string | undefined;
    const showIssue = (status: string, report?: string) => {
      if (this.disposed) return;
      const modal = new ReviewModal(this.app, file.path);
      modal.open();
      modal.append(stdout, false);
      modal.append(stderr, true);
      modal.finish(status, report);
    };
    const checkCancelled = () => { if (cancelled || this.disposed) throw new Error('Review cancelled.'); };
    try {
      if (!(this.app.vault.adapter instanceof FileSystemAdapter)) throw new Error('Reviews require a local desktop vault.');
      const mount = this.mounts.get(view);
      if (mount?.saveError) throw new Error(`Schema was not saved: ${mount.saveError}. Edit it again or reload before reviewing.`);
      await this.store.flush();
      checkCancelled();
      const notePath = file.path;
      if (view.file !== file) throw new Error('The open note changed. Run Review again on the intended note.');
      // Flush editor changes so the agent edits the same content that was reviewed.
      await view.save();
      checkCancelled();
      if (view.file !== file || file.path !== notePath) throw new Error('The note changed or moved while preparing the review. Run Review again.');
      const noteText = view.getViewData();
      const globals = await this.store.globals();
      const selected = this.selection(notePath);
      const source = selected ? globals.get(selected) : await this.store.inline(notePath);
      if (!source) throw new Error(`Global schema “${selected}” is missing.`);
      this.checkFolderSaves(notePath);
      const inherited = await this.store.inheritedRequirements(notePath);
      const resolved = appendFolderRequirements(resolveSchema(source, globals), inherited);
      if (!selected) await this.store.writeInline(notePath, source.text);
      const vault = this.app.vault.adapter.getBasePath();
      const settings = { ...this.settings };
      const obsidianExecutable = obsidianCliExecutable();
      const prompt = await buildReviewPrompt({ notePath, noteText, vaultPath: vault, resolved, allowVerification: settings.allowVerification,
        obsidianExecutable, pairedFolder: this.backingFolder(notePath)?.path,
        read: path => this.app.vault.adapter.read(path) });
      checkCancelled();
      artifactRoot = `.deepreviews/reviews/${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`;
      await this.store.writeArtifact(`${artifactRoot}/prompt.md`, prompt);
      await this.store.writeArtifact(`${artifactRoot}/note.md`, noteText);
      checkCancelled();
      if (file.path !== notePath) throw new Error('The note moved while preparing the review. Run Review again.');
      this.showFeedback(file, { text: `Reviewing with ${settings.agent === 'codex' ? 'Codex' : settings.agent === 'claude' ? 'Claude' : 'custom CLI'}${settings.model ? ` (${settings.model})` : ''}…`, issue: false });
      run = startAgent(settings, { vault, file: join(vault, notePath), promptFile: join(vault, artifactRoot, 'prompt.md') }, prompt, (text, error) => {
        if (error) stderr = (stderr + text).slice(-1_000_000);
        else {
          stdout = (stdout + text).slice(-1_000_000);
          this.showFeedback(file, { text: stdout, issue: false });
        }
      });
      const result = await run.result;
      stdout = result.stdout; stderr = result.stderr;
      await this.store.flush();
      const report = `# DeepReviews: ${file.path}\n\nOriginal path: ${notePath}\nStatus: ${result.status}\nAgent: ${settings.agent}\nModel: ${settings.model || 'CLI default'}\nExit code: ${result.exitCode ?? 'none'}\nSchema: ${source.path}\nReviewed: ${new Date().toISOString()}\n\n${result.stdout || '(No review output.)'}\n\n## Agent diagnostics\n\n${result.stderr}`;
      await this.store.writeArtifact(`${artifactRoot}/review.md`, report);
      const feedback = reviewFeedback(result);
      this.showFeedback(file, feedback);
      if (feedback.issue) showIssue(`Review needs attention. Saved to ${artifactRoot}/review.md`, report);
    } catch (error) {
      const message = String(error);
      const report = `# DeepReviews: ${file.path}\n\n${message}\n\n${stdout || '(No review output.)'}\n\n## Agent diagnostics\n\n${stderr || '(No agent diagnostics received.)'}`;
      this.showFeedback(file, { text: [message, stdout].filter(Boolean).join('\n\n'), issue: true });
      showIssue(message, report);
      if (artifactRoot) {
        try { await this.store.writeArtifact(`${artifactRoot}/error.txt`, report); } catch { /* Original error is already surfaced. */ }
      }
    } finally {
      this.runs.delete(file);
      if (!this.disposed) for (const mount of this.mounts.values()) if (mount.file === file) this.validateMount(mount);
    }
  }
  onunload(): void {
    this.disposed = true;
    for (const run of this.runs.values()) run?.cancel();
    for (const mount of this.mounts.values()) this.unmount(mount);
    this.mounts.clear();
    for (const explorer of this.explorers.values()) explorer.destroy();
    this.explorers.clear();
    this.feedback.clear();
  }
}
