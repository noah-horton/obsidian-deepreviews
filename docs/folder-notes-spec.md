# Folder notes and inherited requirements

Status: implemented in DeepReviews.

## Filesystem model

A folder note consists of a Markdown note and a sibling folder with exactly the
same basename: `Y.md` + `Y/`, or `Y/X.md` + `Y/X/`. No frontmatter flags,
index notes, file moves, or note-content rewrites are required. Existing pairs
are recognized automatically. Only Markdown notes participate; the vault root
has no paired note.

## Creation

- Right-click an unpaired Markdown note and choose **Convert to Folder**.
  Create its sibling folder and preserve the note and its content.
- Right-click an unpaired folder and choose **Create Note for Folder**.
  Create an empty sibling `.md` file and open it in the current editor.
- Never overwrite an existing file or folder. Repeated requests reuse an
  existing compatible counterpart; path conflicts display an error.

## Navigation

The core File explorer displays each pair once, in the folder's position and
sort order. The standalone note row is hidden; the folder keeps its children.

- Clicking the combined label opens the paired note in the current editor.
- Clicking the label while that note is already active uses the normal folder
  expand/collapse behavior.
- The disclosure arrow always expands/collapses without opening a note.
- Modified clicks and native folder context menus remain native behavior.
- Unpaired entries behave normally. Creating, moving, renaming, or deleting
  either counterpart recomputes the pairing. Plugin unload restores ordinary
  explorer rows and listeners.

### Renaming a combined entry

Renaming a combined entry updates **both** sibling names. For example, renaming
`Y/X` to `Y/Research` produces `Y/Research/` and `Y/Research.md`. This applies
when renaming either the folder in the explorer or the paired Markdown note
through Obsidian's file manager. The pair continues to appear as one entry.

Check both destination names and the note's inline-schema sidecar before making
changes. Never overwrite an existing destination. If a later operation fails,
restore the original names when possible and report any rollback failure with
current paths. Renames are serialized, use Obsidian's native file manager so
its link-update behavior is preserved, and retain schema selections, inline
schemas, descendant contents, and inherited folder requirements. Case-only
renames are supported subject to the filesystem's native behavior.

Moves to another parent folder and deletion remain ordinary operations on the
selected filesystem item; they do not implicitly move/delete both counterparts.

## Footer

A paired note has a plain-text editor labeled **Additional requirements for all
files in folder or subfolders**. Text is saved automatically in
`<folder>/.deepwork-requirements.md`. A hidden file inside the folder lets its
requirements travel with a folder move. Merely opening a note creates nothing.
An empty value contributes no requirements. The box remains editable even when
the note uses a global schema.

Descendant notes show **Inherited requirements** below their editable boxes.
This read-only section names each source note and displays its requirement text
as literal text. Edit requirements at their source folder note. Saved changes
refresh open footers automatically, including other open views of the same note.
Hidden sidecars changed by external tools can be refreshed with **Reload**;
reviews always read them afresh.

## Cumulative inheritance

Walk the file's enclosing folders from outermost to innermost, including every
folder that currently has a paired Markdown note and nonempty requirements.
Requirements from different folders accumulate; nearer requirements cannot
replace outer requirements, or vice versa. Unpaired intermediate folders do
not interrupt inheritance from paired ancestors. Pairing checks are based on
path boundaries, so `Y/` never contributes to `YY/`.

Example:

```text
Y.md                  # Edits requirements for Y's descendants
Y/
  .deepwork-requirements.md      # Cite sources.
  X.md                # Inherits Y; edits requirements for X's descendants
  X/
    .deepwork-requirements.md    # Use metric units.
    child.md          # Inherits BOTH Y and X
    deeper/
      grandchild.md   # Inherits BOTH Y and X
```

`Y/X.md` inherits Y's requirements, while `Y/X/child.md` inherits both X and Y.
The requirements authored on X apply to files *inside* `X/`, not X's own sibling
note. Put requirements for the folder note itself in its ordinary schema.

Inheritance is resolved dynamically, not copied into child notes or their
editable schemas. Clearing requirements, removing a pairing, or moving a child
changes its effective requirements without rewriting descendant files.
The resolver supports descendant file paths of any extension; footer and review
UI remain limited to Markdown, as in the existing extension.

## Reviews and persistence

Resolve the note's inline/global schema normally, then append each ancestor's
text as a separate requirement with its source path. Generated `folder_*` IDs
are collision-safe; local/global requirements and all ancestor entries survive.
Review snapshots therefore include the same inherited requirements shown in the
footer. Flush pending saves before constructing a review. Report save failures
and prevent reviews from silently using a known stale requirement value.

Folder requirements use the existing serialized storage queue. They do not
modify `.deepschema.<note>.yml` or shared global schemas. Folder moves carry the
hidden requirement file; existing inline-schema relocation continues unchanged.

## Acceptance checks

1. Convert a note with content; confirm content unchanged and one explorer row.
2. Create a note for a folder containing children; confirm children unchanged.
3. Open a combined label from another note; click again to expand/collapse.
4. Verify the disclosure arrow, unrelated entries, and unload restoration.
5. Set Y and X requirements; verify a deeply nested child shows both, with source
   labels, and neither inherited entry can be edited there.
6. Review with a local/global schema; verify all inherited and local requirements
   appear in the prompt, even when generated IDs collide with local IDs.
7. Edit/clear a requirement, remove a pairing, or move a subtree; verify inheritance
   updates and no descendant contents are rewritten.
8. Verify rapid saves, save failures, empty values, and path conflicts.
9. Rename either half of a pair; verify both new names, descendant content,
   inline schemas, schema selections, and inherited requirements. Test collisions
   at either destination, case-only renames, and recovery from a failed second
   rename. Unpaired renames and moves must retain native behavior.

Automated coverage lives in `tests/explorer.test.ts`, `tests/folder-notes.test.ts`,
`tests/storage.test.ts`, `tests/footer.test.ts`, `tests/paired-rename.test.ts`,
and `tests/modals.test.ts`.
