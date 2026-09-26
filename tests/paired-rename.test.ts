import { afterEach, expect, test } from 'bun:test';
import { mkdtemp, mkdir, readFile, writeFile, access, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { PairedRenamer } from '../src/paired-rename';
import { SchemaStore, inlinePath, remapPaths } from '../src/storage';

type Entry = { path: string; folder: boolean };
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'deepreviews-pair-rename-')); roots.push(root);
  const entries = new Map<string, Entry>();
  const store = new SchemaStore({
    exists: async path => { try { await access(join(root, path)); return true; } catch { return false; } },
    read: path => readFile(join(root, path), 'utf8'),
    write: (path, text) => writeFile(join(root, path), text),
    mkdir: path => mkdir(join(root, path)).then(() => {}),
    rename: (from, to) => rename(join(root, from), join(root, to)),
    list: async path => {
      const items = await readdir(join(root, path), { withFileTypes: true });
      const prefix = path === '.' ? '' : path + '/';
      return { files: items.filter(x => x.isFile()).map(x => prefix + x.name), folders: items.filter(x => x.isDirectory()).map(x => prefix + x.name) };
    }
  });
  async function add(path: string, folder = false) {
    const entry = { path, folder }; entries.set(path, entry);
    if (folder) await mkdir(join(root, path), { recursive: true });
    else await writeFile(join(root, path), `Content: ${path}`);
    return entry;
  }
  let selections: Record<string, string> = { 'Y.md': 'parent-schema', 'Y/X.md': 'nested-schema', 'Y/X/child.md': 'child-schema' };
  const calls: string[] = [];
  const failures = new Set<string>();
  const renamer = new PairedRenamer<Entry>({
    get: path => entries.get(path), isFolder: file => file.folder,
    flush: () => store.flush(), prepareNoteRename: (from, to) => store.checkRenameNote(from, to),
    finishNoteRename: (from, to) => store.renameNote(from, to),
    rename: async (file, to) => {
      calls.push(`${file.path} -> ${to}`);
      if (failures.has(to)) throw new Error(`Simulated failure: ${to}`);
      const from = file.path;
      await rename(join(root, from), join(root, to));
      for (const [path, entry] of [...entries]) if (path === from || (file.folder && path.startsWith(from + '/'))) {
        entries.delete(path); entry.path = to + path.slice(from.length); entries.set(entry.path, entry);
      }
      selections = remapPaths(selections, from, to);
      if (!file.folder) await store.renameNote(from, to);
    }
  });
  const outer = await add('Y', true); const outerNote = await add('Y.md');
  const nested = await add('Y/X', true); const nestedNote = await add('Y/X.md');
  await add('Y/X/child.md');
  await store.writeFolderRequirements('Y', 'Cite sources.');
  await store.writeFolderRequirements('Y/X', 'Use metric units.');
  await store.writeInline('Y.md', 'summary: Outer');
  await store.writeInline('Y/X.md', 'summary: Nested');
  await store.writeInline('Y/X/child.md', 'summary: Child');
  return { root, entries, store, add, renamer, outer, outerNote, nested, nestedNote, calls, failures, selections: () => selections };
}

for (const half of ['folder', 'note']) test(`renaming the ${half} preserves both halves, nested files, schemas and inheritance`, async () => {
  const f = await fixture();
  await f.renamer.rename(half === 'folder' ? f.outer : f.outerNote, half === 'folder' ? 'Research' : 'Research.md');
  expect(f.outer.path).toBe('Research'); expect(f.outerNote.path).toBe('Research.md');
  expect(f.calls).toHaveLength(2);
  expect(await readFile(join(f.root, 'Research/X/child.md'), 'utf8')).toBe('Content: Y/X/child.md');
  expect((await f.store.inline('Research.md')).text).toBe('summary: Outer');
  expect((await f.store.inline('Research/X.md')).text).toBe('summary: Nested');
  expect((await f.store.inline('Research/X/child.md')).text).toBe('summary: Child');
  expect(f.selections()).toEqual({ 'Research.md': 'parent-schema', 'Research/X.md': 'nested-schema', 'Research/X/child.md': 'child-schema' });
  expect(await f.store.inheritedRequirements('Research/X/child.md')).toEqual([
    { folder: 'Research', text: 'Cite sources.' }, { folder: 'Research/X', text: 'Use metric units.' }
  ]);
});

test('renaming a nested pair does not change its parent or lose inherited requirements', async () => {
  const f = await fixture();
  await f.renamer.rename(f.nested, 'Y/Research');
  expect(f.nestedNote.path).toBe('Y/Research.md'); expect(f.outer.path).toBe('Y');
  expect(await f.store.inheritedRequirements('Y/Research/child.md')).toHaveLength(2);
});

for (const conflict of ['Research', 'Research.md', '.deepschema.Research.md.yml']) test(`collision at ${conflict} changes neither half`, async () => {
  const f = await fixture();
  if (conflict.startsWith('.')) await f.store.adapter.write(conflict, 'Do not overwrite');
  else await f.add(conflict, conflict === 'Research');
  await expect(f.renamer.rename(f.outer, 'Research')).rejects.toThrow('already exists');
  expect(f.outer.path).toBe('Y'); expect(f.outerNote.path).toBe('Y.md');
  expect(f.calls).toEqual([]);
  if (conflict.startsWith('.')) expect(await f.store.adapter.read(conflict)).toBe('Do not overwrite');
});

for (const half of ['folder', 'note']) test(`failure renaming the second half restores a ${half}-initiated rename`, async () => {
  const f = await fixture();
  f.failures.add(half === 'folder' ? 'Research.md' : 'Research');
  await expect(f.renamer.rename(half === 'folder' ? f.outer : f.outerNote, half === 'folder' ? 'Research' : 'Research.md')).rejects.toThrow('original names restored');
  expect(f.outer.path).toBe('Y'); expect(f.outerNote.path).toBe('Y.md');
  expect((await f.store.inline('Y.md')).text).toBe('summary: Outer');
  expect(await f.store.inheritedRequirements('Y/X/child.md')).toHaveLength(2);
  f.failures.clear();
  await f.renamer.rename(f.outer, 'Research');
  expect(f.outerNote.path).toBe('Research.md');
});

test('rollback failures report current paths without claiming successful restoration', async () => {
  const f = await fixture(); f.failures.add('Research.md'); f.failures.add('Y');
  await expect(f.renamer.rename(f.outer, 'Research')).rejects.toThrow('Current paths: Research, Y.md');
  expect(f.outer.path).toBe('Research'); expect(f.outerNote.path).toBe('Y.md');
});

test('case-only paired renames include the inline schema', async () => {
  const f = await fixture();
  await f.renamer.rename(f.outerNote, 'y.md');
  expect(f.outer.path).toBe('y'); expect(f.outerNote.path).toBe('y.md');
  const names = await readdir(f.root);
  expect(names).toContain(inlinePath('y.md'));
  expect(names).not.toContain(inlinePath('Y.md'));
});

test('moves and unpaired renames remain single native operations', async () => {
  const f = await fixture(); const solo = await f.add('Solo.md');
  await f.renamer.rename(solo, 'Renamed.md');
  await f.add('Destination', true);
  await f.renamer.rename(f.outer, 'Destination/Y');
  expect(f.outerNote.path).toBe('Y.md');
  expect(f.calls).toEqual(['Solo.md -> Renamed.md', 'Y -> Destination/Y']);
});

test('unpaired note rename checks its schema destination before renaming the note', async () => {
  const f = await fixture(); const solo = await f.add('Solo.md');
  await f.store.writeInline('Solo.md', 'summary: Solo');
  await f.store.writeInline('Renamed.md', 'summary: Occupied');
  await expect(f.renamer.rename(solo, 'Renamed.md')).rejects.toThrow('already exists');
  expect(solo.path).toBe('Solo.md');
  expect(f.calls).toEqual([]);
  expect((await f.store.inline('Solo.md')).text).toBe('summary: Solo');
  expect((await f.store.inline('Renamed.md')).text).toBe('summary: Occupied');
});
