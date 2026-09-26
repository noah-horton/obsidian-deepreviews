import { expect, mock, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { App } from 'obsidian';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaFooter } from '../src/footer';

const window = new Window();
let copied = '';
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: { writeText: async (text: string) => { copied = text; } } } });
// Minimal Obsidian DOM helpers; exercise the actual modal and Copy output handler.
Object.assign(window.HTMLElement.prototype, {
  addClass(this: HTMLElement, cls: string) { this.classList.add(cls); },
  createEl(this: HTMLElement, tag: string, options: { text?: string; cls?: string; attr?: Record<string, string> } = {}) {
    const el = window.document.createElement(tag);
    if (options.text) el.textContent = options.text;
    if (options.cls) el.className = options.cls;
    for (const [key, value] of Object.entries(options.attr ?? {})) el.setAttribute(key, value);
    this.appendChild(el as unknown as Node);
    return el;
  },
  createDiv(this: HTMLElement, options: { cls?: string }) { return this.createEl('div', options); }
});
let opened = 0;
class TestAdapter {
  constructor(private path: string) {}
  getBasePath() { return this.path; }
}
mock.module('obsidian', () => ({
  Modal: class {
    modalEl = window.document.createElement('div'); contentEl = window.document.createElement('div');
    open() { opened++; (this as unknown as { onOpen(): void }).onOpen(); }
  },
  Notice: class {}, Setting: class {}, Plugin: class {}, PluginSettingTab: class {},
  FileSystemAdapter: TestAdapter, MarkdownView: class {}, TFile: class {}, TFolder: class {}
}));
const { ReviewModal } = await import('../src/modals');
function modal() {
  const modal = new ReviewModal({} as App, 'test.md');
  modal.onOpen();
  return modal;
}
function copy(modal: InstanceType<typeof ReviewModal>) {
  const button = Array.from(modal.contentEl.querySelectorAll('button')).find(el => el.textContent === 'Copy output')!;
  button.click();
  return copied;
}
test('preparation failures are copyable even without any agent output', () => {
  const view = modal();
  const report = view.finish('Error: invalid custom arguments');
  expect(copy(view)).toBe(report);
  expect(report).toContain('Error: invalid custom arguments');
  expect(report).toContain('No agent diagnostics received');
});
test('failure preserves stdout and stderr and expands diagnostics', () => {
  const view = modal();
  view.append('partial review', false);
  view.append('authentication failed', true);
  view.finish('Error: could not save review');
  expect(copy(view)).toContain('partial review');
  expect(copy(view)).toContain('authentication failed');
  expect(copy(view)).toContain('could not save review');
  expect(view.contentEl.querySelector('details')!.open).toBe(true);
  expect(view.contentEl.querySelector('.deepreviews-diagnostics')!.textContent).toBe('authentication failed');
});
test('copying an active review includes diagnostics and completed reviews use the full report', () => {
  const view = modal();
  view.append('diagnostic before stdout', true);
  expect(copy(view)).toContain('diagnostic before stdout');
  view.finish('Review complete', 'full saved report', false);
  expect(copy(view)).toBe('full saved report');
  expect(view.contentEl.querySelector('details')!.open).toBe(false);
});

const { default: DeepReviewsPlugin } = await import('../src/main');
const { DEFAULT_SETTINGS } = await import('../src/agent');
// Exercise the real review orchestration and subprocess with a disposable note.
async function reviewScenario(output: string, exitCode = 0, saveFails = false) {
  const vault = await mkdtemp(join(tmpdir(), 'deepreviews-review-'));
  const artifacts = new Map<string, string>();
  const footer = new SchemaFooter(window.document as unknown as Document, {
    select() {}, edit() {}, review() {}, cancel() {}, manage() {}, refresh() {}
  });
  const file = { path: 'note.md' };
  const source = { name: 'inline', path: '.deepschema.note.md.yml', text: 'requirements: {correct: Arithmetic MUST be correct.}' };
  const view = {
    file, getViewData: () => '1+3=3', save: async () => {
      if (saveFails) throw new Error('Cannot save editor contents');
      await writeFile(join(vault, file.path), '1+3=3');
    }
  };
  const plugin = new DeepReviewsPlugin({} as App, {} as never);
  Object.assign(plugin, {
    app: { vault: { adapter: new TestAdapter(vault) } },
    store: {
      flush: async () => {}, globals: async () => new Map(), inline: async () => source,
      inheritedRequirements: async () => [{ folder: 'Y', text: 'All notes MUST cite sources.' }, { folder: 'Y/X', text: 'Use metric units.' }],
      writeInline: async () => {}, writeArtifact: async (path: string, text: string) => { artifacts.set(path, text); }
    },
    mounts: new Map([[view, { view, file, path: file.path, footer, source, globals: new Map(), inherited: [] }]])
  });
  plugin.settings = {
    ...plugin.settings, ...DEFAULT_SETTINGS, agent: 'custom', executable: process.execPath,
    customArgs: JSON.stringify(['-e', `const fs=require('node:fs');process.stdin.resume();process.stdin.on('end',()=>{if(fs.readFileSync('note.md','utf8')!=='1+3=3')process.exit(9);fs.writeFileSync('note.md','1+3=4');console.error('normal diagnostic');console.log(${JSON.stringify(output)});process.exitCode=${exitCode};});`])
  };
  opened = 0;
  try {
    await (plugin as unknown as { review(view: unknown): Promise<void> }).review(view);
    return { opened, text: footer.feedback.textContent, issue: footer.feedback.classList.contains('deepreviews-error'), busy: footer.review.disabled,
      note: saveFails ? '' : await readFile(join(vault, file.path), 'utf8'), artifacts };
  } finally { await rm(vault, { recursive: true, force: true }); }
}
test('review saves the editor, runs repairs, and keeps successful feedback inline without opening a modal', async () => {
  const run = await reviewScenario('PASS\n- Fixed: corrected the sum.');
  expect(run.opened).toBe(0);
  expect(run.note).toBe('1+3=4');
  const prompt = [...run.artifacts].find(([path]) => path.endsWith('/prompt.md'))?.[1];
  expect(prompt).toContain('All notes MUST cite sources.');
  expect(prompt).toContain('Use metric units.');
  expect(run.text).toContain('Fixed: corrected the sum.');
  expect(run.issue).toBe(false);
  expect(run.busy).toBe(false);
  expect([...run.artifacts].find(([path]) => path.endsWith('/note.md'))?.[1]).toBe('1+3=3');
  expect([...run.artifacts].find(([path]) => path.endsWith('/review.md'))?.[1]).toContain('normal diagnostic');
});
test('completed review with unresolved findings opens an issue modal and preserves inline feedback', async () => {
  const run = await reviewScenario('FAIL\n- Unresolved: source needed.');
  expect(run.opened).toBe(1);
  expect(run.text).toContain('source needed');
  expect(run.issue).toBe(true);
});
test('process failures open an issue modal even if stdout says PASS', async () => {
  const run = await reviewScenario('PASS', 7);
  expect(run.opened).toBe(1);
  expect(run.text).toContain('failed (exit 7)');
  expect(run.busy).toBe(false);
});
test('saving errors stop before launching the agent and appear in the footer and popup', async () => {
  const run = await reviewScenario('', 0, true);
  expect(run.opened).toBe(1);
  expect(run.text).toContain('Cannot save editor contents');
  expect(run.artifacts.size).toBe(0);
  expect(run.busy).toBe(false);
});

const { TFile, TFolder } = await import('obsidian');
test('conversions preserve existing content, create sibling paths, reuse counterparts and reject conflicts', async () => {
  const files = new Map<string, InstanceType<typeof TFile> | InstanceType<typeof TFolder>>();
  const contents = new Map<string, string>();
  const makeNote = (path: string, text: string) => {
    const file = Object.assign(new TFile(), { path, extension: 'md' });
    files.set(path, file); contents.set(path, text); return file;
  };
  const makeFolder = (path: string) => {
    const folder = Object.assign(new TFolder(), { path }); files.set(path, folder); return folder;
  };
  const note = makeNote('Existing.md', '# Keep my content');
  const folder = makeFolder('Bare');
  makeNote('Bare/child.md', 'Keep the child');
  const opened: string[] = [];
  const plugin = new DeepReviewsPlugin({} as App, {} as never);
  Object.assign(plugin, {
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => files.get(path),
        createFolder: async (path: string) => makeFolder(path),
        create: async (path: string, text: string) => makeNote(path, text)
      },
      workspace: { getLeaf: (newLeaf: boolean) => {
        expect(newLeaf).toBe(false);
        return { openFile: async (file: { path: string }) => { opened.push(file.path); } };
      } }
    },
    reconcile() {}, refreshAll() {}
  });
  const actions = plugin as unknown as { convertToFolder(file: unknown): Promise<void>; createFolderNote(file: unknown): Promise<void> };
  await actions.convertToFolder(note); await actions.convertToFolder(note);
  expect(files.get('Existing')).toBeInstanceOf(TFolder);
  expect(contents.get('Existing.md')).toBe('# Keep my content');
  await actions.createFolderNote(folder);
  expect(opened).toEqual(['Bare.md']);
  expect(contents.get('Bare.md')).toBe('');
  expect(contents.get('Bare/child.md')).toBe('Keep the child');
  contents.set('Bare.md', 'Now edited');
  await actions.createFolderNote(folder);
  expect(contents.get('Bare.md')).toBe('Now edited');
  const blockedNote = makeNote('Blocked.md', 'Keep'); makeNote('Blocked', 'conflict');
  await expect(actions.convertToFolder(blockedNote)).rejects.toThrow('already exists');
  const blockedFolder = makeFolder('Other'); makeFolder('Other.md');
  await expect(actions.createFolderNote(blockedFolder)).rejects.toThrow('already exists');
});

test('folder saves propagate after editor revisions change; failed saves block descendant review', async () => {
  const plugin = new DeepReviewsPlugin({} as App, {} as never);
  let finish: (() => void) | undefined;
  let refreshes = 0;
  const footer = new SchemaFooter(window.document as unknown as Document, {
    select() {}, edit() {}, review() {}, cancel() {}, manage() {}, refresh() {}
  });
  const mount = { path: 'Y.md', revision: 0, footer };
  Object.assign(plugin, {
    backingFolder: () => ({ path: 'Y' }),
    store: { writeFolderRequirements: () => new Promise<void>(resolve => { finish = resolve; }) },
    refreshFolderRequirements: () => { refreshes++; }
  });
  const actions = plugin as unknown as { editFolder(mount: unknown, text: string): void; checkFolderSaves(note: string): void };
  actions.editFolder(mount, 'Cite sources.');
  // Another schema edit or view navigation must not suppress child propagation.
  mount.revision++;
  finish!(); await Promise.resolve();
  expect(refreshes).toBe(1);
  Object.assign(plugin, { store: { writeFolderRequirements: () => Promise.reject(new Error('disk full')) } });
  actions.editFolder(mount, 'Unsaved change'); await Promise.resolve();
  expect(() => actions.checkFolderSaves('Y/X/child.md')).toThrow('disk full');
  expect(() => actions.checkFolderSaves('YY/child.md')).not.toThrow();
  Object.assign(plugin, { store: { writeFolderRequirements: () => Promise.resolve() } });
  actions.editFolder(mount, 'Saved change'); await Promise.resolve();
  expect(() => actions.checkFolderSaves('Y/X/child.md')).not.toThrow();
});

test('propagation updates open footers without disabling the editor or replacing a newer draft', async () => {
  const plugin = new DeepReviewsPlugin({} as App, {} as never);
  const footer = new SchemaFooter(window.document as unknown as Document, {
    select() {}, edit() {}, review() {}, cancel() {}, manage() {}, refresh() {}
  });
  window.document.body.append(footer.root as never);
  footer.setFolderRequirements('Y', 'Saved', []);
  footer.folderEditor.focus();
  const mount = { path: 'Y.md', revision: 0, folderRevision: 0, footer, inherited: [] };
  let complete: ((text: string) => void) | undefined;
  Object.assign(plugin, {
    backingFolder: () => ({ path: 'Y' }), validateMount() {},
    store: { folderRequirements: () => new Promise<string>(resolve => { complete = resolve; }), inheritedRequirements: async () => [] }
  });
  const actions = plugin as unknown as { loadFolderRequirements(mount: unknown): Promise<void> };
  const loading = actions.loadFolderRequirements(mount);
  expect(footer.folderEditor.disabled).toBe(false);
  expect(window.document.activeElement).toBe(footer.folderEditor as never);
  footer.folderEditor.value = 'New draft'; mount.revision++;
  complete!('Old saved value'); await loading;
  expect(footer.folderEditor.value).toBe('New draft');
  footer.destroy();
});
