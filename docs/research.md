# Implementation research

Research performed September 16, 2026.

- [DeepWork DeepSchema implementation](https://github.com/Unsupervisedcom/deepwork/tree/419b043d1c7f9c59d6e8b27634138d20ab9e9d5c/src/deepwork/deepschema): inspected discovery, inheritance resolution, review bridge, definition validation, and write-hook command conventions at commit `419b043d1c7f9c59d6e8b27634138d20ab9e9d5c`. DeepReviews implements the format independently and does not incorporate upstream implementation code.
- [DeepSchema specification](https://github.com/Unsupervisedcom/deepwork/blob/419b043d1c7f9c59d6e8b27634138d20ab9e9d5c/doc/specs/deepwork/DW-REQ-011-deepschema.md): named and anonymous schema layout, optional fields, parent requirements, reference behavior, and review severity. The README documents the explicitly selected schema model and other differences from full DeepWork.
- [Obsidian developer documentation: Vault](https://github.com/obsidianmd/obsidian-developer-docs/blob/main/en/Plugins/Vault.md): normal Vault APIs only address visible files; hidden files need the adapter API. This supports using hidden sidecars accessed through `app.vault.adapter`.
- [Obsidian data storage](https://obsidian.md/help/data-storage): vaults are normal local folders with a hidden configuration directory. The plugin uses Obsidian's `loadData`/`saveData` for settings and selection metadata, respecting a custom configuration directory.
- [Obsidian API](https://github.com/obsidianmd/obsidian-api): `MarkdownView`, `contentEl`, `getViewData`, workspace lifecycle events, `FileSystemAdapter`, settings, and modal interfaces. The footer is a separate DOM sibling under each Markdown view, with no CodeMirror monkeypatches.
- [Codex noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode): `codex exec` reads prompts from stdin, emits its response on stdout and diagnostics on stderr, and supports the read-only sandbox. Also checked the installed `codex exec --help` for these flags and `--skip-git-repo-check`.

Hidden sidecars were additionally verified in the live Obsidian 1.12.7 file explorer: the ordinary note is visible and the saved `.deepschema.*.yml` file is not.
