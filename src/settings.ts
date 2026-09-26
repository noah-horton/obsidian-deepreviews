import { App, FileSystemAdapter, PluginSettingTab, Setting } from 'obsidian';
import type DeepReviewsPlugin from './main';
import { parseSchema } from './schema';
import { REVIEW_MODELS } from './models';
import { testDependencies, type AgentSettings, type DependencyCheck } from './agent';

export class DeepReviewsSettings extends PluginSettingTab {
  constructor(app: App, private plugin: DeepReviewsPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl: el } = this;
    el.empty();
    el.createEl('h2', { text: 'DeepReviews' });
    const privacyNotice = el.createEl('div', {
      cls: 'deepreviews-privacy-notice',
      attr: { role: 'note', 'aria-label': 'Privacy and permissions' }
    });
    privacyNotice.createEl('strong', { text: 'Privacy and permissions' });
    privacyNotice.createEl('p', { text: 'DeepReviews starts a separately installed CLI from the vault directory. Install and sign in to that CLI yourself; DeepReviews does not provide the agent service or manage your credentials.' });
    privacyNotice.createEl('p', { text: 'When you click Review, the current note snapshot, selected schema, and referenced files are sent to the CLI. It may send this content to its provider over the network using your existing account. The agent can inspect other vault files and edit the reviewed note, including renaming it.' });
    privacyNotice.createEl('p', { text: 'Codex runs with danger-full-access, which can access files outside the vault and use the network; prompt instructions do not restrict operating-system access. Claude Code uses acceptEdits. A custom CLI follows its own permissions and configuration. Use only a CLI, notes, and schemas you trust.' });
    new Setting(el).setName('Coding agent').setDesc('Reviews fix the current note, including its filename when needed. Renames also move its inline schema. Codex uses full-access command execution so Obsidian CLI renames can run; Claude uses acceptEdits.').addDropdown(dropdown => {
      dropdown.addOption('codex', 'Codex CLI').addOption('claude', 'Claude Code').addOption('custom', 'Custom CLI')
        .setValue(this.plugin.settings.agent).onChange(value => {
          this.plugin.settings.agent = value as AgentSettings['agent'];
          this.plugin.settings.executable = '';
          this.plugin.settings.model = '';
          this.plugin.persistSettings(); this.display();
        });
    });
    const provider = this.plugin.settings.agent;
    if (provider !== 'custom') {
      new Setting(el).setName('Suggested review model').setDesc('Choose a model available to your CLI account, or enter an exact name below. CLI default uses your existing CLI configuration.').addDropdown(dropdown => {
        dropdown.addOption('', 'CLI default');
        for (const model of REVIEW_MODELS[provider]) dropdown.addOption(model.id, model.label);
        const current = this.plugin.settings.model;
        if (current && !REVIEW_MODELS[provider].some(model => model.id === current)) dropdown.addOption(current, `Custom: ${current}`);
        dropdown.setValue(current).onChange(value => {
          this.plugin.settings.model = value; this.plugin.persistSettings(); this.display();
        });
      });
    }
    new Setting(el).setName('Review model name').setDesc(provider === 'custom'
      ? 'Optional model ID for the {model} placeholder in custom arguments.'
      : 'Enter any model ID or alias, including models not listed above. Leave blank for the CLI default.').addText(text => text
      .setPlaceholder('CLI default').setValue(this.plugin.settings.model).onChange(value => {
        this.plugin.settings.model = value.trim(); this.plugin.persistSettings();
      }));
    new Setting(el).setName('Executable path').setDesc('Full path recommended for GUI apps. Leave blank for the selected CLI on PATH. Specify an executable, not a shell command. On Windows, use a native .exe or a runtime such as node.exe with a script argument.').addText(text => text
      .setPlaceholder(provider === 'custom' ? '/path/to/agent' : provider)
      .setValue(this.plugin.settings.executable).onChange(value => { this.plugin.settings.executable = value; this.plugin.persistSettings(); }));
    const dependencySetting = new Setting(el).setName('Dependencies').setDesc('Check that your selected CLI runs, whether its sign-in can be verified, and that the Obsidian CLI can be launched.');
    const dependencyResults = dependencySetting.descEl.createEl('div', { cls: 'deepreviews-dependency-results', attr: { role: 'status', 'aria-live': 'polite' } });
    dependencySetting.addButton(button => button
      .setButtonText('Test Dependencies')
      .onClick(async () => {
        button.setDisabled(true);
        dependencyResults.className = 'deepreviews-dependency-results deepreviews-dependency-checking';
        dependencyResults.setText('Checking dependencies…');
        try {
          const adapter = this.app.vault.adapter;
          const vaultPath = adapter instanceof FileSystemAdapter ? adapter.getBasePath() : undefined;
          const checks = await testDependencies(this.plugin.settings, vaultPath);
          dependencyResults.empty();
          for (const check of checks) this.renderDependencyResult(dependencyResults, check);
        } catch (error) {
          dependencyResults.className = 'deepreviews-dependency-results deepreviews-dependency-failed';
          dependencyResults.setText(`Dependency check failed: ${String(error)}`);
        } finally {
          button.setDisabled(false);
        }
      }));
    if (this.plugin.settings.agent === 'custom') {
      new Setting(el).setName('Arguments (JSON array)').setDesc('The full review prompt is sent to stdin. Available placeholders: {vault}, {file}, {promptFile}, {model}. No shell expansion. Example: ["--print", "--model", "{model}"].').addTextArea(text => text
        .setValue(this.plugin.settings.customArgs).onChange(value => { this.plugin.settings.customArgs = value; this.plugin.persistSettings(); }));
    }
    new Setting(el).setName('Allow schema verification commands').setDesc('Allows the agent to run verification_bash_command entries, subject to its sandbox. Disabled by default. Only enable for schemas you trust.').addToggle(toggle => toggle
      .setValue(this.plugin.settings.allowVerification).onChange(value => { this.plugin.settings.allowVerification = value; this.plugin.persistSettings(); }));
    new Setting(el).setName('Review timeout').setDesc('Maximum minutes before stopping the agent (1–120).').addText(text => text
      .setValue(String(this.plugin.settings.timeoutMinutes)).onChange(value => {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 1 && n <= 120) { this.plugin.settings.timeoutMinutes = n; this.plugin.persistSettings(); }
      }));
    const schemaSetting = new Setting(el).setName('Default schema').setDesc('YAML used for notes without a saved inline schema and as the starting point for new global schemas. Existing saved schemas are unchanged.');
    schemaSetting.settingEl.addClass('deepreviews-default-schema');
    const schemaError = schemaSetting.descEl.createEl('div', { cls: 'deepreviews-error', attr: { role: 'status' } });
    const validateDefault = (value: string) => {
      try { parseSchema(value); schemaError.textContent = ''; }
      catch (error) { schemaError.textContent = `Invalid default schema: ${String(error)}. Fix the YAML before reviewing notes that use it.`; }
    };
    schemaSetting.addTextArea(text => {
      text.inputEl.rows = 9;
      text.inputEl.spellcheck = false;
      text.inputEl.setAttribute('aria-label', 'Default schema YAML');
      text.setValue(this.plugin.settings.defaultSchema).onChange(value => {
        this.plugin.settings.defaultSchema = value;
        validateDefault(value);
        this.plugin.persistSettings();
        this.plugin.refreshAll();
      });
    });
    validateDefault(this.plugin.settings.defaultSchema);
    new Setting(el).setName('Global schemas').setDesc('Create or edit YAML schemas shared by notes in this vault.').addButton(button => button
      .setButtonText('Manage schemas').onClick(() => this.plugin.openGlobals()));
    el.createEl('p', { text: 'Inline YAML lives beside each note in a hidden .deepschema.<filename>.yml file. Review snapshots and reports are saved under .deepreviews/reviews. Both are hidden from normal Obsidian navigation.', cls: 'setting-item-description' });
  }

  private renderDependencyResult(container: HTMLElement, check: DependencyCheck): void {
    const row = container.createEl('div', { cls: `deepreviews-dependency-result deepreviews-dependency-${check.status}` });
    row.createEl('strong', { text: `${check.name}: ` });
    row.appendText(check.message);
  }
}
