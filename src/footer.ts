import type { FolderRequirement } from './folder-notes';
/** Plain DOM UI, mounted once per MarkdownView. No editor internals. */
export interface FooterActions {
  select: (value: string) => void;
  edit: (text: string) => void;
  editFolder?: (text: string) => void;
  review: () => void;
  cancel: () => void;
  manage: () => void;
  refresh: () => void;
  resize?: (expandedHeight: number, finished: boolean) => void;
  collapse?: (expanded: boolean, expandedHeight: number) => void;
}
export interface ReviewFeedback { text: string; issue: boolean }
export interface FooterLayout { expandedHeight?: number; collapsedHeight: number }
export class SchemaFooter {
  readonly root: HTMLElement;
  readonly select: HTMLSelectElement;
  readonly editor: HTMLTextAreaElement;
  readonly folderEditor: HTMLTextAreaElement;
  readonly inherited: HTMLElement;
  private readonly folderSection: HTMLElement;
  private readonly inheritedSection: HTMLElement;
  readonly status: HTMLElement;
  readonly review: HTMLButtonElement;
  readonly location: HTMLElement;
  readonly feedback: HTMLElement;
  readonly cancel: HTMLButtonElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly resizeHandle: HTMLDivElement;
  private readonly manage: HTMLButtonElement;
  private collapsed = false;
  private expandedHeight?: number;
  private collapsedHeight: number;
  constructor(document: Document, actions: FooterActions, layout: FooterLayout = { collapsedHeight: 64 }) {
    const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = '') => {
      const node = document.createElement(tag); node.className = cls; node.textContent = text; return node;
    };
    this.root = el('section', 'deepreviews-footer');
    this.root.setAttribute('aria-label', 'DeepReviews schema editor');
    this.collapsedHeight = layout.collapsedHeight;
    this.expandedHeight = layout.expandedHeight;
    if (this.expandedHeight !== undefined) this.root.style.flexBasis = `${this.expandedHeight}px`;
    this.resizeHandle = el('div', 'deepreviews-resize-handle');
    this.resizeHandle.setAttribute('role', 'separator');
    this.resizeHandle.setAttribute('aria-orientation', 'horizontal');
    this.resizeHandle.setAttribute('aria-label', 'Resize DeepReviews footer');
    this.resizeHandle.setAttribute('aria-valuemin', '80');
    this.resizeHandle.setAttribute('aria-valuenow', '80');
    this.resizeHandle.tabIndex = 0;
    const header = el('div', 'deepreviews-header');
    this.toggle = el('button', 'deepreviews-toggle', '▾');
    this.toggle.setAttribute('aria-label', 'Collapse schema editor');
    this.toggle.setAttribute('aria-expanded', 'true');
    this.title = el('strong', 'deepreviews-title', 'DeepReviews');
    const badge = el('span', 'deepreviews-badge', 'DEEPSCHEMA');
    this.select = el('select', 'deepreviews-select');
    this.select.setAttribute('aria-label', 'Schema for this note');
    this.review = el('button', 'mod-cta deepreviews-review', 'Review');
    this.cancel = el('button', 'deepreviews-cancel', 'Cancel');
    this.cancel.hidden = true;
    header.append(this.toggle, this.title, badge, this.select, this.review, this.cancel);
    this.feedback = el('div', 'deepreviews-feedback');
    this.feedback.hidden = true;
    this.feedback.setAttribute('role', 'status');
    this.feedback.setAttribute('aria-live', 'polite');
    this.feedback.setAttribute('aria-label', 'Review feedback');
    this.body = el('div', 'deepreviews-body');
    this.location = el('div', 'deepreviews-location');
    this.editor = el('textarea', 'deepreviews-editor');
    this.editor.setAttribute('aria-label', 'DeepSchema YAML');
    this.editor.spellcheck = false;
    this.editor.rows = 7;
    this.folderSection = el('label', 'deepreviews-folder-section');
    this.folderSection.hidden = true;
    this.folderSection.append(el('div', 'deepreviews-location', 'Additional requirements for all files in folder or subfolders'));
    this.folderEditor = el('textarea', 'deepreviews-editor');
    this.folderEditor.rows = 3;
    this.folderEditor.setAttribute('aria-label', 'Additional requirements for all files in folder or subfolders');
    this.folderEditor.placeholder = 'Requirements inherited by every descendant file…';
    this.folderEditor.addEventListener('input', () => actions.editFolder?.(this.folderEditor.value));
    this.folderSection.append(this.folderEditor);
    this.inheritedSection = el('section', 'deepreviews-inherited-section');
    this.inheritedSection.hidden = true;
    this.inherited = el('div', 'deepreviews-inherited');
    this.inherited.setAttribute('aria-label', 'Inherited requirements');
    this.inheritedSection.append(el('div', 'deepreviews-location', 'Inherited requirements'), this.inherited);
    const bar = el('div', 'deepreviews-toolbar');
    this.status = el('span', 'deepreviews-status', 'Loading schema…');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.manage = el('button', 'deepreviews-link', 'Global schemas');
    const refresh = el('button', 'deepreviews-link', 'Reload');
    refresh.title = 'Reload schemas changed outside Obsidian';
    bar.append(this.status, this.manage, refresh);
    this.body.append(this.location, this.editor, this.folderSection, this.inheritedSection, bar);
    this.root.append(this.resizeHandle, header, this.feedback, this.body);
    this.select.addEventListener('change', () => actions.select(this.select.value));
    this.editor.addEventListener('input', () => actions.edit(this.editor.value));
    this.review.addEventListener('click', () => actions.review());
    this.cancel.addEventListener('click', () => actions.cancel());
    this.manage.addEventListener('click', () => actions.manage());
    refresh.addEventListener('click', () => actions.refresh());
    this.toggle.addEventListener('click', () => {
      if (!this.collapsed) this.expandedHeight = this.root.getBoundingClientRect().height;
      this.collapsed = !this.collapsed;
      this.body.hidden = this.collapsed;
      this.root.classList.toggle('deepreviews-collapsed', this.collapsed);
      this.toggle.textContent = this.collapsed ? '▸' : '▾';
      this.toggle.setAttribute('aria-expanded', String(!this.collapsed));
      this.toggle.setAttribute('aria-label', `${this.collapsed ? 'Expand' : 'Collapse'} schema editor`);
      this.resizeHandle.setAttribute('aria-disabled', String(this.collapsed));
      this.root.style.flexBasis = `${this.collapsed ? this.collapsedHeight : (this.expandedHeight ?? this.root.getBoundingClientRect().height)}px`;
      actions.collapse?.(!this.collapsed, this.expandedHeight ?? this.root.getBoundingClientRect().height);
    });
    const resizeBy = (delta: number, finished = false) => {
      if (this.collapsed) return;
      const available = this.root.parentElement?.clientHeight ?? 0;
      const min = 80;
      const max = Math.max(min, available - 80);
      const current = this.root.getBoundingClientRect().height;
      const next = Math.min(max, Math.max(min, current + delta));
      this.root.style.flexBasis = `${next}px`;
      this.resizeHandle.setAttribute('aria-valuemax', String(Math.round(max)));
      this.resizeHandle.setAttribute('aria-valuenow', String(Math.round(next)));
      this.expandedHeight = next;
      actions.resize?.(next, finished);
    };
    this.resizeHandle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || this.collapsed) return;
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = this.root.getBoundingClientRect().height;
      this.resizeHandle.setPointerCapture(event.pointerId);
      const move = (moveEvent: PointerEvent) => {
        const delta = startHeight + startY - moveEvent.clientY - this.root.getBoundingClientRect().height;
        resizeBy(delta);
      };
      const finish = (upEvent: PointerEvent) => {
        this.resizeHandle.removeEventListener('pointermove', move);
        this.resizeHandle.removeEventListener('pointerup', finish);
        this.resizeHandle.removeEventListener('pointercancel', finish);
        if (this.resizeHandle.hasPointerCapture(upEvent.pointerId)) this.resizeHandle.releasePointerCapture(upEvent.pointerId);
        if (!this.collapsed) actions.resize?.(this.root.getBoundingClientRect().height, true);
      };
      this.resizeHandle.addEventListener('pointermove', move);
      this.resizeHandle.addEventListener('pointerup', finish);
      this.resizeHandle.addEventListener('pointercancel', finish);
    });
    this.resizeHandle.addEventListener('keydown', event => {
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        resizeBy((event.key === 'ArrowUp' ? 1 : -1) * (event.shiftKey ? 60 : 20), true);
      }
    });
  }
  setSharedHeights(expandedHeight: number | undefined, collapsedHeight: number): void {
    this.collapsedHeight = collapsedHeight;
    if (this.collapsed) this.root.style.flexBasis = `${collapsedHeight}px`;
    if (expandedHeight !== undefined) this.expandedHeight = expandedHeight;
    if (!this.collapsed && expandedHeight !== undefined) this.root.style.flexBasis = `${expandedHeight}px`;
  }
  setSchemas(names: string[], selected: string): void {
    this.select.replaceChildren();
    const add = (value: string, label: string) => {
      const option = this.select.ownerDocument.createElement('option');
      option.value = value; option.textContent = label; this.select.append(option);
    };
    add('', 'Inline · this note');
    for (const name of names) add(name, name);
    if (selected && !names.includes(selected)) add(selected, `${selected} (missing)`);
    this.select.value = selected;
  }
  setSchema(text: string, path: string, inline: boolean): void {
    if (this.editor.value !== text) this.editor.value = text;
    this.editor.readOnly = !inline;
    this.location.textContent = inline ? 'Inline schema · saved automatically in a hidden sidecar' : 'Global schema · shared across notes · edit via Global schemas';
    this.location.title = path;
  }
  setFolderRequirements(folder: string | undefined, text: string, inherited: FolderRequirement[]): void {
    this.folderSection.hidden = !folder;
    this.folderEditor.disabled = !folder;
    if (this.folderEditor.value !== text) this.folderEditor.value = text;
    this.inheritedSection.hidden = inherited.length === 0;
    this.inherited.replaceChildren();
    for (const entry of inherited) {
      const block = this.root.ownerDocument.createElement('div');
      const source = this.root.ownerDocument.createElement('strong');
      source.textContent = `${entry.folder}.md`;
      const body = this.root.ownerDocument.createElement('div');
      body.textContent = entry.text;
      block.append(source, body);
      this.inherited.append(block);
    }
  }
  setStatus(message: string, error = false): void {
    this.status.textContent = message;
    this.status.classList.toggle('deepreviews-error', error);
  }
  setBusy(busy: boolean): void {
    this.review.disabled = busy;
    this.review.textContent = busy ? 'Reviewing…' : 'Review';
    this.cancel.hidden = !busy;
  }
  setFeedback(feedback: ReviewFeedback): void {
    this.feedback.textContent = feedback.text;
    this.feedback.hidden = !feedback.text;
    this.feedback.classList.toggle('deepreviews-error', feedback.issue);
  }
  destroy(): void { this.root.remove(); }
}
