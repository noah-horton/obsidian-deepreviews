import { App, Modal, Notice, Setting } from 'obsidian';
import { parseSchema, resolveSchema, type SchemaSource } from './schema';
import { globalPath, type SchemaStore } from './storage';

export class GlobalSchemasModal extends Modal {
  constructor(app: App, private store: SchemaStore, private changed: () => void) { super(app); }
  onOpen(): void { this.modalEl.addClass('deepreviews-modal'); void this.showList(); }
  private async showList(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: 'Global DeepSchemas' });
    this.contentEl.createEl('p', { cls: 'deepreviews-help', text: 'Shared across this vault. Stored in .deepwork/schemas/<name>/deepschema.yml. Select one beneath any note.' });
    const list = this.contentEl.createDiv();
    try {
      const schemas = await this.store.globals();
      if (!schemas.size) list.createEl('p', { text: 'No global schemas yet. Create one or copy an existing DeepSchema folder into .deepwork/schemas.' });
      for (const source of schemas.values()) {
        const row = list.createDiv({ cls: 'deepreviews-global-row' });
        row.createSpan({ text: source.name });
        row.createEl('button', { text: 'Edit' }).onclick = () => this.edit(source);
      }
      this.contentEl.createEl('button', { text: 'New global schema', cls: 'mod-cta' }).onclick = () => this.edit();
    } catch (error) { list.createEl('p', { text: String(error), cls: 'deepreviews-error' }); }
  }
  private edit(source?: SchemaSource): void {
    this.contentEl.empty();
    this.contentEl.createEl('h2', { text: source ? `Edit ${source.name}` : 'New global schema' });
    let name = source?.name ?? '';
    new Setting(this.contentEl).setName('Schema name').setDesc('Used in the dropdown and parent_deep_schemas.').addText(input => {
      input.setPlaceholder('research-note').setValue(name).onChange(value => { name = value; });
      input.setDisabled(Boolean(source));
    });
    const editor = this.contentEl.createEl('textarea', { cls: 'deepreviews-schema-input', attr: { 'aria-label': 'Global DeepSchema YAML' } });
    editor.value = source?.text ?? this.store.defaultSchema;
    editor.spellcheck = false;
    const error = this.contentEl.createEl('p', { cls: 'deepreviews-error', attr: { role: 'status' } });
    const actions = this.contentEl.createDiv({ cls: 'deepreviews-actions' });
    const save = actions.createEl('button', { text: 'Save schema', cls: 'mod-cta' });
    save.onclick = async () => {
      save.disabled = true;
      try {
        const path = source?.path ?? globalPath(name);
        parseSchema(editor.value);
        const schemas = await this.store.globals();
        const updated = { name, path, text: editor.value };
        schemas.set(name, updated);
        resolveSchema(updated, schemas);
        await this.store.writeGlobal(name, editor.value, !source);
        this.changed();
        await this.showList();
      } catch (cause) { error.textContent = String(cause); save.disabled = false; }
    };
    actions.createEl('button', { text: 'Back' }).onclick = () => { void this.showList(); };
  }
  onClose(): void { this.contentEl.empty(); }
}

export class ReviewModal extends Modal {
  private status!: HTMLElement;
  private output!: HTMLElement;
  private diagnostics!: HTMLElement;
  private details!: HTMLDetailsElement;
  private cancelButton!: HTMLButtonElement;
  private report = '';
  cancelRun: (() => void) | undefined;
  private stdout = '';
  private stderr = '';
  private paintTimer?: ReturnType<typeof setTimeout>;
  constructor(app: App, private notePath: string) { super(app); }
  onOpen(): void {
    this.modalEl.addClass('deepreviews-modal');
    this.contentEl.createEl('h2', { text: 'DeepReviews' });
    this.contentEl.createEl('p', { text: this.notePath, cls: 'deepreviews-help' });
    this.status = this.contentEl.createEl('p', { text: 'Preparing review…', attr: { role: 'status' } });
    this.output = this.contentEl.createEl('pre', { cls: 'deepreviews-output' });
    this.details = this.contentEl.createEl('details');
    this.details.createEl('summary', { text: 'Agent diagnostics' });
    this.diagnostics = this.details.createEl('pre', { cls: 'deepreviews-diagnostics' });
    const actions = this.contentEl.createDiv({ cls: 'deepreviews-actions' });
    this.cancelButton = actions.createEl('button', { text: 'Cancel review' });
    this.cancelButton.onclick = () => { this.cancelRun?.(); this.setStatus('Cancelling…'); };
    actions.createEl('button', { text: 'Copy output' }).onclick = () => {
      void navigator.clipboard.writeText(this.report || this.snapshot(this.status.textContent ?? '')).then(() => new Notice('Review copied.'), () => new Notice('Could not copy output. Select and copy the text manually.'));
    };
  }
  setStatus(text: string): void { this.status.textContent = text; }
  append(text: string, error: boolean): void {
    if (error) this.stderr = (this.stderr + text).slice(-100_000);
    else this.stdout = (this.stdout + text).slice(-1_000_000);
    if (!this.paintTimer) this.paintTimer = setTimeout(() => { this.paintTimer = undefined; this.paint(); }, 100);
  }
  private paint(): void { this.output.textContent = this.stdout; this.diagnostics.textContent = this.stderr; }
  private snapshot(status: string): string {
    return `# DeepReviews: ${this.notePath}\n\n${status}\n\n${this.stdout || '(No review output.)'}\n\n## Agent diagnostics\n\n${this.stderr || '(No agent diagnostics received.)'}`;
  }
  finish(status: string, report?: string, failed = true): string {
    clearTimeout(this.paintTimer);
    this.paintTimer = undefined;
    this.paint();
    this.report = report ?? this.snapshot(status);
    if (failed) this.details.open = true;
    this.setStatus(status);
    this.cancelButton.disabled = true;
    this.cancelRun = undefined;
    return this.report;
  }
  onClose(): void {
    this.cancelRun?.();
    clearTimeout(this.paintTimer);
    this.contentEl.empty();
  }
}
