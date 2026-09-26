# DeepReviews

An Obsidian desktop plugin that puts a DeepSchema editor and **Review** button beneath every open Markdown note. Inline schemas are the default; choose a named schema to share requirements across your vault. Reviews launch your configured coding-agent CLI and display the result inside Obsidian.

## Privacy and permissions

DeepReviews requires a separately installed and signed-in coding-agent CLI. When you click **Review**, the plugin sends the current note snapshot, selected schema, and referenced files to that CLI. The CLI may send this content to its provider over the network using your existing account; DeepReviews does not provide the agent service or manage your credentials. The agent can inspect other files in the vault and edit the reviewed note, including renaming it when needed.

The default Codex CLI command runs with `danger-full-access`. This can access files outside the vault and use the network; prompt instructions do not enforce an operating-system boundary. Claude Code runs with `acceptEdits`. A custom CLI follows its own permissions and configuration. Use a CLI you trust, and review notes and schemas before sending them to an agent.

## Install

The ready-to-install plugin is in `dist/deepreviews/` after building.

1. Copy the **deepreviews** folder (containing `main.js`, `manifest.json`, and `styles.css`) into `<vault>/.obsidian/plugins/`. If your vault uses a custom configuration directory, use that directory instead of `.obsidian`.
2. In Obsidian, open **Settings → Community plugins**, enable community plugins if necessary, and enable **DeepReviews**. Reload Obsidian if the plugin does not appear.
3. In **Settings → DeepReviews**, select Codex, Claude Code, or a custom CLI and configure the review model if desired. Install and sign in to that CLI separately. A full executable path is useful when a desktop app cannot find your terminal's PATH.
4. Open a Markdown note. Edit the YAML in the footer and click **Review**.

Requires desktop Obsidian 1.5.0+ and an installed agent CLI. Live-tested with Obsidian 1.12.7 on macOS. Mobile is intentionally unsupported because the plugin launches a local process.

## Schema editor

- The footer appears in Live Preview, Source, and Reading views, including separate note panes. It can be collapsed.
- **Inline · this note** is the default. **Settings → DeepReviews → Default schema** supplies the YAML for notes without a saved inline schema and for new global schemas. It starts with General note requirements for consistency and spelling/grammar. Changing the setting updates unsaved defaults without overwriting existing schemas. Editing auto-saves, including temporarily invalid YAML; invalid schemas cannot be reviewed.
- **Global schemas** opens a manager to create/edit schemas shared by this vault. Global selections show a read-only preview in the footer. Editing a global definition affects every note using it.
- **Reload** refreshes schemas edited outside Obsidian. Reviews always load the current saved definitions.
- **Review current note**, **Manage global schemas**, and **Reload schemas** also appear in the command palette.

Example DeepSchema:

```yaml
summary: Decision record
instructions: |
  Check that someone outside the project could understand this decision.
requirements:
  decision: The note MUST state the decision and its rationale.
  alternatives: The note SHOULD discuss plausible alternatives.
  owner: Follow-up actions SHOULD identify an owner.
parent_deep_schemas: [writing]
references:
  - path: ../Guidelines.md
    description: Team decision-making guidance
examples:
  - path: ../Examples/Good decision.md
    description: A well-supported decision
```

Omit `parent_deep_schemas` until you have created a global schema named `writing`.

## Hidden storage and DeepSchema compatibility

| Data | Location relative to vault |
| --- | --- |
| Inline schema for `Notes/Plan.md` | `Notes/.deepschema.Plan.md.yml` |
| Global schema named `writing` | `.deepwork/schemas/writing/deepschema.yml` |
| Plugin settings (including default schema) and note/global assignments | `<configDir>/plugins/deepreviews/data.json` |
| Review request, exact note snapshot, and report | `.deepreviews/reviews/<timestamp-id>/` |

Obsidian's normal vault index does not expose these dotfiles as notes. The plugin uses the adapter API to access them. This is hidden storage, not encryption: other programs and plugins that reveal hidden files can access it. Ensure your backup/sync tool includes dotfiles if you want schemas and review history on other computers; arbitrary hidden files are not guaranteed to sync through Obsidian Sync.

Inline schema names, named schema directories, YAML fields, requirement-key overrides, and RFC 2119 review severity follow [DeepWork's DeepSchema format](https://github.com/Unsupervisedcom/deepwork/tree/419b043d1c7f9c59d6e8b27634138d20ab9e9d5c/src/deepwork/deepschema). This plugin is an independent implementation; DeepWork need not be installed.

Supported fields: `summary`, `instructions`, `requirements`, `parent_deep_schemas`, `json_schema_path`, `verification_bash_command`, `examples`, `references`, and `matchers`. Unknown fields, wrong types, duplicate YAML keys, missing parents, and inheritance cycles produce actionable errors. Empty schemas are valid.

Parent requirements are merged in order; later parents override earlier parents, and child keys override all parents. Verification commands are collected parents-first. A child's JSON Schema wins, otherwise the first parent's is inherited. Other descriptive fields are local to the selected schema. Relative references resolve from the defining schema directory; an inherited JSON Schema retains its parent's directory. References must stay within the vault. References are included in the prompt (up to 200,000 characters per file); examples are listed for inspection on demand. Missing references are disclosed to the agent.

This version uses explicit note selection instead of automatically applying every matching schema. `matchers` are retained as metadata. It discovers named schemas in this vault's `.deepwork/schemas`, without importing DeepWork's bundled standards or environment-configured folders. It does not install DeepWork's write hooks, jobs, or MCP server. JSON Schema validation and optional verification commands are delegated to the selected agent during review; this plugin does not claim deterministic local validation of the note itself.

If you also run DeepWork separately, it can discover the same files, but it does not read DeepReviews' note/global dropdown assignments. An inline schema is preserved when selecting a global schema, so an external DeepWork run may discover both.

Obsidian note renames move the inline sidecar and update schema assignments; folder renames carry contained sidecars and update selections. Renames are checked for destination sidecar collisions before Obsidian changes the note name. Existing destination sidecars are never overwritten. Renames made while the plugin is disabled or outside Obsidian require manually moving the matching sidecar. Deleting a note leaves its sidecar for recovery; recreating that path reuses it. Simultaneous edits from separate Obsidian instances use ordinary filesystem last-writer behavior.

## Agent configuration and results

**Codex CLI** (default) runs:

```text
codex exec --sandbox danger-full-access --skip-git-repo-check --color never -
```

The vault is the working directory; the complete prompt is streamed on stdin. The CLI uses its existing authentication and default model unless **Review model name** is set. The model picker offers current suggestions for Codex and Claude; the adjacent name field accepts any model ID or alias, including future models. Model suggestions are maintained in `src/models.ts`. No API keys are managed by the plugin. Claude Code runs in noninteractive print mode with `acceptEdits` permissions. Review saves the current editor contents before launching the agent. The prompt includes that snapshot, resolved requirements, schema sources, and references. It also instructs the agent to search for and read other useful files in the vault, including linked notes and related context not listed in the schema, while keeping those files read-only. The agent automatically applies clear, supported fixes to the reviewed note, preserves unrelated and concurrent edits, and rechecks its changes. If the filename itself needs repair, the agent uses Obsidian's `rename` CLI command; DeepReviews moves the backing inline schema and preserves the selected rules through Obsidian's rename events. Enable the Obsidian CLI in **Settings → General** for review-agent renames. It reports PASS / FAIL / INCOMPLETE after repairs, with extremely short bullets describing only issues fixed or left unresolved. A clean review returns “PASS — No issues found.”

Codex reviews run with `danger-full-access` because the Obsidian CLI aborts under Codex's `workspace-write` sandbox when Codex is launched from this plugin. This grants review commands access beyond the vault, including network access; the prompt's target-note restriction is not a filesystem boundary. Use reviews only with notes and schemas you trust.

On macOS, executable discovery also searches the Codex desktop app in `/Applications` and `~/Applications`, after PATH and common CLI install locations. You can override discovery with a full executable path.

**Custom CLI** accepts an executable plus a JSON array of arguments. For a print-mode CLI, use the appropriate flags for that program (for example, `["--print"]` if it supports that option). The full prompt is always sent to stdin. Argument placeholders are `{vault}`, `{file}`, `{promptFile}`, and `{model}`. Each argument is passed literally; no shell interpolation is performed. Programs requiring a TTY are not supported by this noninteractive runner. On Windows, use a native executable, or `node.exe` plus a CLI JavaScript entry point; `.cmd`/`.bat` wrappers require a shell and are not directly supported.

Schema `verification_bash_command` execution is off by default. Enable it only for trusted schemas. When enabled, the prompt permits the agent to run commands with the note path as `$1`, a 30-second timeout, and the vault as working directory, subject to its existing sandbox. Checks apply to the updated disk file after repairs. The prompt limits edits to the target note and its Obsidian-managed rename, but Codex's full-access mode does not enforce that scope. A custom CLI needs permission to write the target note and uses its own sandbox settings.

Review progress and concise agent feedback appear in the footer above the schema editor, even when the editor is collapsed. The footer’s **Cancel** button stops an active review; disabling the plugin also stops active agents. Successful reviews, including applied repairs, do not open a popup. Remaining violations, incomplete or missing verdicts, and execution failures open a results window with copyable output and **Agent diagnostics**. Ordinary stderr diagnostics alone do not trigger a popup. Feedback remains available when switching away from and back to a note during the current plugin session. The default timeout is ten minutes. Output is bounded to keep the UI responsive. Unix cancellation targets the spawned process group; Windows cancellation targets the direct CLI process.

Each review stores `prompt.md`, `note.md`, and `review.md` in its hidden history directory. Launch failures are saved as failed reviews with diagnostics, including the command, working directory, and search PATH. Preparation or saving failures after history creation save `error.txt` with the error and any captured output. Failed reviews automatically expand diagnostics, and **Copy output** includes status and diagnostics even when the agent never produces stdout. These snapshots contain note and reference content. History persists until you remove it; there is no automatic retention cleanup. A completed process is not a PASS verdict—read the agent's report.

## Development

Install [Bun](https://bun.sh), then:

```sh
bun install --frozen-lockfile
bun run check        # tests, TypeScript check, production bundle
bun run dev          # watch-build main.js
```

Tests exercise schema validation/inheritance, hidden storage and rename behavior, prompt construction, footer interactions, real subprocess stdin/stdout, launch failures, and cancellation. `scripts/fake-agent.cjs` is a network-free agent stand-in for testing the complete Review flow. Configure Custom CLI with a Node executable and an argument containing that script's absolute path.

See [research notes](docs/research.md) for source links and [validation notes](docs/validation.md) for live test results.

## Folder notes

Right-click a Markdown note → **Convert to Folder**, or a folder → **Create Note for Folder**. Matching sibling notes and folders appear as one explorer entry. Click to open the note; click again while active to expand or collapse. Renaming a combined entry updates both the note and folder names, with collision checks and rollback if the second rename fails. Folder notes have a footer box for requirements inherited by all descendants, cumulatively through nested folders. See [the functionality spec](docs/folder-notes-spec.md).
