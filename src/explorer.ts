/** DOM adapter for the core File explorer. No replacement tree or persisted UI state. */
export interface ExplorerActions {
  pairedNote(folder: string): string | undefined;
  activeNote(): string | undefined;
  openNote(path: string): void;
}
export class FolderNoteExplorer {
  private readonly observer: MutationObserver;
  private queued = false;
  private disposed = false;
  constructor(private readonly root: HTMLElement, private readonly actions: ExplorerActions) {
    const Observer = root.ownerDocument.defaultView!.MutationObserver;
    this.observer = new Observer(() => this.schedule());
    this.observer.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-path', 'class'] });
    root.addEventListener('click', this.click, true);
    this.refresh();
  }
  private schedule(): void {
    if (this.queued || this.disposed) return;
    this.queued = true;
    queueMicrotask(() => { this.queued = false; if (!this.disposed) this.refresh(); });
  }
  private toggle(el: Element, name: string, enabled: boolean): void {
    if (el.classList.contains(name) !== enabled) el.classList.toggle(name, enabled);
  }
  refresh(): void {
    const paired = new Set<string>();
    for (const title of Array.from(this.root.querySelectorAll<HTMLElement>('.nav-folder-title[data-path]'))) {
      const note = this.actions.pairedNote(title.dataset.path!);
      this.toggle(title, 'deepreviews-folder-note', !!note);
      this.toggle(title, 'deepreviews-folder-note-active', !!note && note === this.actions.activeNote());
      if (note) paired.add(note);
    }
    for (const title of Array.from(this.root.querySelectorAll<HTMLElement>('.nav-file-title[data-path]'))) {
      const row = title.closest('.nav-file');
      if (row) this.toggle(row, 'deepreviews-paired-file', paired.has(title.dataset.path!));
    }
  }
  private click = (event: MouseEvent): void => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    const target = event.target as Element | null;
    const title = target?.closest<HTMLElement>('.nav-folder-title[data-path]');
    if (!title || !this.root.contains(title) || target?.closest('input, textarea')) return;
    const note = this.actions.pairedNote(title.dataset.path!);
    // The disclosure arrow always remains an ordinary folder toggle.
    if (!note || target?.closest('.nav-folder-collapse-indicator')) return;
    if (note === this.actions.activeNote()) return; // Native explorer toggles the folder.
    event.preventDefault(); event.stopImmediatePropagation();
    this.actions.openNote(note);
  };
  destroy(): void {
    this.disposed = true;
    this.observer.disconnect();
    this.root.removeEventListener('click', this.click, true);
    for (const el of Array.from(this.root.querySelectorAll('.deepreviews-paired-file, .deepreviews-folder-note, .deepreviews-folder-note-active'))) {
      el.classList.remove('deepreviews-paired-file', 'deepreviews-folder-note', 'deepreviews-folder-note-active');
    }
  }
}
