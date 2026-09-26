# Validation

## Automated

`bun run check` runs 40 tests, TypeScript strict checking, and the production esbuild bundle.

Covered behavior:

- All public DeepSchema fields, empty schemas, wrong types, unknown fields, duplicate keys.
- Ordered inheritance, child overrides, diamond graphs, cycles, missing parents, inherited JSON Schema reference origins.
- Hidden sidecar naming, initial defaults, actual filesystem persistence, ordered rapid writes, note rename, destination collision preservation, global discovery, invalid draft retention, and selection remapping.
- Prompt note snapshots, references and examples, missing-reference disclosure, RFC 2119 interpretation, and disabled-command policy.
- DOM footer editing, selection, read-only global preview, review callback, collapse, and cleanup.
- Actual subprocess startup, stdin delivery, literal filenames with spaces/quotes/shell metacharacters, stdout/stderr capture, nonzero exits, missing executables, and cancellation.
- macOS Codex app discovery, missing-working-directory diagnostics, launch-error streaming, and the review modal's Copy output handler for preparation failures, partial output, active diagnostics, and completed reports.

## September 26 automatic repairs and inline feedback

All 40 tests, strict typechecking, and the production build pass. New coverage verifies target-only repair instructions, write-enabled Codex arguments, verdict classification, persistent footer feedback, cancellation controls, and review orchestration with actual subprocesses. The orchestration tests verify saving the editor before repair, retaining the original snapshot, no popup for successful repairs, popups for unresolved findings and process failures, and stopping before launch when saving fails.

Live-tested in Obsidian **1.13.7 on macOS** using the disposable `dist` vault and a local deterministic CLI (no model calls). The CLI repaired `1+3=3` to `1+3=4`; the updated content appeared in the editor and on disk, and its concise feedback appeared above the schema editor without a popup. A clean rerun displayed “PASS — No issues found.” with the editor collapsed. Ordinary stderr diagnostics did not trigger a popup. An unresolved finding displayed inline and opened the issue popup with diagnostics. Obsidian's button styles required an explicit scoped `[hidden]` rule to hide the idle Cancel button.

The final production build was reloaded in the Personal vault and the footer remained active. No review was run against Personal notes and their content and schemas were not changed.

## September 26 launch failure fix

The Personal vault's saved errors and live error modal showed `spawn codex ENOENT`. Its default settings left the executable blank; the installed CLI was `/Applications/Codex.app/Contents/Resources/codex`, outside the plugin's previous search paths. Launch errors rejected before reaching the diagnostics stream, while the modal copied only stdout if no completed report existed.

The runner now includes standard macOS Codex app locations and returns launch failures through the normal diagnostic/report path. The modal expands diagnostics on failure and includes errors and captured output when copying or saving a failure. All 33 tests, strict typechecking, and the production build pass. A real `codex --version` subprocess launched through the updated runner with PATH restricted to `/usr/bin:/bin:/usr/sbin:/sbin` succeeded (`codex-cli 0.154.0-alpha.6.2`). Live reloading was blocked by the Mac lock screen; no model-backed review was run for this fix.

## Live Obsidian

Tested in an isolated local vault under the ignored `dist/` directory, with Obsidian **1.12.7 on macOS**. The user's existing vault was not modified.

Verified:

- Built plugin enables successfully.
- Footer renders in Live Preview, Reading view, and Source mode.
- Inline editing saves exact YAML into a hidden `.deepschema.Welcome.md.yml` file, absent from the regular file explorer.
- Global manager creates `research-note`; dropdown selection shows its YAML as read-only.
- Switching back to Inline restores the previous draft.
- Renaming `Welcome.md` to `Renamed.md` moves the sidecar and preserves the selected global schema; switching back restores the inline content at the new path.
- Invalid YAML remains editable and disables Review with a parse error; fixing it re-enables Review.
- Reloading Obsidian restores the saved schema and footer.
- A custom Node test agent receives the full prompt, returns a synthetic report, and the UI displays completion with the hidden saved report path.
- Footer padding was adjusted and visually rechecked to avoid Obsidian's status-bar overlay.

The first test agent, invoked as a script in the Documents directory, stalled inside a native file-open operation before any script output; the configured one-minute timeout terminated it and saved an honest timed-out report. The same test program passed immediately when supplied through Node's `-e` argument, confirming the complete launch/stdin/stdout/report flow without depending on that external script-file read. The precise OS cause of the stalled open was not established.

No paid/model-backed review was run. Codex command compatibility was checked against official documentation and the installed CLI's help. Windows/Linux and other Obsidian versions have not been live-tested. Automated tests use a DOM test environment rather than emulating Obsidian internals.

## Folder notes — 2026-09-26

`bun run check` passes: 50 tests, strict TypeScript checking, and the production bundle. Coverage includes sibling conversion and conflicts, explorer click routing and cleanup, cumulative nested inheritance, unchanged child files, folder moves, queued saves, save failures, focused-editor preservation, read-only inherited footer text, and inheritance in real review orchestration prompts. The installable directory and ZIP were refreshed.

Live Obsidian verification is pending: UI automation reported that the Mac was locked and could not be unlocked automatically. No Personal vault notes, schemas, or settings were edited. A disposable fixture is prepared at `/private/tmp/DeepReviews-FolderNotes-Test` for conversion, navigation, and nested-inheritance checks after unlock. The live plugin still needs to be reloaded.

## Paired renames — 2026-09-26

`bun run check` passes: 61 tests, strict TypeScript checking, and production bundling. New filesystem tests cover folder-initiated and note-initiated renames, nested paths, preserved sidecars and schema selections, inherited requirements, collisions at both destinations and the schema sidecar, second-operation failure and rollback, failed rollback diagnostics, case-only changes, and native behavior for unpaired renames and moves.

Live verification completed in the existing `dist` test vault with disposable `Rename QA` fixtures. Used the combined explorer entry’s native Rename menu to change `Y` to `Research`; confirmed both `Research/` and `Research.md` on disk, unchanged child content, relocated inline schema, preserved folder requirements, a single navigable explorer entry, and the nested footer’s updated `Rename QA/Research.md` source. Returned to Personal, used Settings → Community plugins → Reload plugins (confirmed the reload notice), and verified the ordinary note footer remains present. No Personal note or schema was edited. This supersedes the earlier locked-Mac verification limitation for navigation, inheritance display and plugin reload.
