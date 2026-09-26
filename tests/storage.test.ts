import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, writeFile, mkdir, access, readdir, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SchemaStore, inlinePath, globalPath, remapPaths, type Adapter } from '../src/storage';
const roots: string[] = [];
export async function fixture(): Promise<{ store: SchemaStore; root: string; adapter: Adapter }> {
  const root = await mkdtemp(join(tmpdir(), 'deepreviews-test-')); roots.push(root);
  const adapter: Adapter = {
    exists: async p => { try { await access(join(root, p)); return true; } catch { return false; } },
    read: p => readFile(join(root, p), 'utf8'),
    write: (p, s) => writeFile(join(root, p), s),
    mkdir: p => mkdir(join(root, p)).then(() => {}),
    rename: (a, b) => rename(join(root, a), join(root, b)),
    list: async p => {
      const items = await readdir(join(root, p), { withFileTypes: true });
      return { files: items.filter(x => x.isFile()).map(x => `${p}/${x.name}`), folders: items.filter(x => x.isDirectory()).map(x => `${p}/${x.name}`) };
    }
  };
  return { root, adapter, store: new SchemaStore(adapter) };
}
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
describe('hidden storage with actual filesystem IO', () => {
  test('uses the current configured default without overwriting saved inline or global schemas', async () => {
    const { adapter } = await fixture();
    let defaultSchema = 'summary: First default';
    const store = new SchemaStore(adapter, () => defaultSchema);
    expect((await store.inline('new.md')).text).toBe(defaultSchema);
    expect(await adapter.exists(inlinePath('new.md'))).toBe(false);
    await store.writeInline('saved.md', 'summary: Custom inline');
    await store.writeGlobal('saved', 'summary: Custom global', true);
    defaultSchema = 'summary: Updated default';
    expect((await store.inline('new.md')).text).toBe(defaultSchema);
    expect(store.defaultSchema).toBe(defaultSchema);
    expect((await store.inline('saved.md')).text).toBe('summary: Custom inline');
    expect((await store.globals()).get('saved')?.text).toBe('summary: Custom global');
    defaultSchema = '';
    expect((await store.inline('new.md')).text).toBe('');
  });
  test('uses upstream hidden sidecar names without altering notes', async () => {
    const { store, adapter } = await fixture();
    await adapter.mkdir('Notes');
    await adapter.write('Notes/My note.md', '# untouched');
    expect(inlinePath('Notes/My note.md')).toBe('Notes/.deepschema.My note.md.yml');
    expect((await store.inline('Notes/My note.md')).text).toContain('requirements:');
    expect(await adapter.exists(inlinePath('Notes/My note.md'))).toBe(false);
    await store.writeInline('Notes/My note.md', 'requirements: {x: Note MUST exist}');
    expect(await adapter.read('Notes/My note.md')).toBe('# untouched');
    expect((await store.inline('Notes/My note.md')).text).toContain('Note MUST exist');
  });
  test('queues rapid edits and rename without losing the final draft', async () => {
    const { store } = await fixture();
    const operations = [store.writeInline('old.md', 'first'), store.writeInline('old.md', 'last'), store.renameNote('old.md', 'new.md'), store.writeInline('new.md', 'latest')];
    await Promise.all(operations);
    expect((await store.inline('new.md')).text).toBe('latest');
  });
  test('never clobbers another sidecar on rename', async () => {
    const { store } = await fixture();
    await store.writeInline('old.md', 'old'); await store.writeInline('new.md', 'new');
    await expect(store.renameNote('old.md', 'new.md')).rejects.toThrow('already exists');
    expect((await store.inline('old.md')).text).toBe('old');
    expect((await store.inline('new.md')).text).toBe('new');
  });
  test('creates globals, discovers sorted names, and rejects duplicate creation', async () => {
    const { store } = await fixture();
    await store.writeGlobal('zeta', 'summary: Z', true);
    await store.writeGlobal('alpha', 'summary: A', true);
    expect([...await store.globals()].map(([name]) => name)).toEqual(['alpha', 'zeta']);
    await expect(store.writeGlobal('alpha', 'summary: overwrite', true)).rejects.toThrow('already exists');
    await store.writeGlobal('alpha', 'summary: updated', false);
    expect((await store.globals()).get('alpha')?.text).toContain('updated');
  });
  test('preserves invalid drafts and recovers the write queue after errors', async () => {
    const { store } = await fixture();
    await expect(store.writeInline('missing/note.md', 'x')).rejects.toThrow();
    await store.writeInline('note.md', 'requirements: [');
    expect((await store.inline('note.md')).text).toBe('requirements: [');
  });
  test('remaps note and folder assignments on path boundaries', () => {
    expect(remapPaths({ 'A/x.md': 'one', 'A/B/y.md': 'two', 'AB/z.md': 'three' }, 'A', 'New')).toEqual({ 'New/x.md': 'one', 'New/B/y.md': 'two', 'AB/z.md': 'three' });
    expect(() => globalPath('../outside')).toThrow();
  });
});

test('folder requirements accumulate by ancestry, survive folder moves, and do not rewrite children', async () => {
  const { store, adapter } = await fixture();
  await adapter.mkdir('Y'); await adapter.mkdir('Y/X'); await adapter.mkdir('Y/X/Deep');
  await adapter.write('Y.md', '# Y'); await adapter.write('Y/X.md', '# X');
  await adapter.write('Y/X/Deep/child.md', '# unchanged');
  await store.writeFolderRequirements('Y', 'Cite sources.');
  await store.writeFolderRequirements('Y/X', 'Use metric units.');
  expect(await store.inheritedRequirements('Y/X/Deep/child.md')).toEqual([
    { folder: 'Y', text: 'Cite sources.' }, { folder: 'Y/X', text: 'Use metric units.' }
  ]);
  expect(await store.inheritedRequirements('Y/X.md')).toEqual([{ folder: 'Y', text: 'Cite sources.' }]);
  expect(await store.inheritedRequirements('Y.md')).toEqual([]);
  expect(await store.inheritedRequirements('YY/child.md')).toEqual([]);
  expect(await store.inheritedRequirements('Y/X/image.png')).toHaveLength(2);
  await adapter.rename('Y', 'Z'); await adapter.rename('Y.md', 'Z.md');
  expect(await store.inheritedRequirements('Z/X/Deep/child.md')).toHaveLength(2);
  expect(await adapter.read('Z/X/Deep/child.md')).toBe('# unchanged');
  await store.writeFolderRequirements('Z/X', '');
  expect(await store.inheritedRequirements('Z/X/Deep/child.md')).toEqual([{ folder: 'Z', text: 'Cite sources.' }]);
  await adapter.rename('Z.md', 'Unpaired.md');
  expect(await store.inheritedRequirements('Z/X/Deep/child.md')).toEqual([]);
});

test('folder requirement writes are queued and reading does not create a sidecar', async () => {
  const { store, adapter } = await fixture();
  await adapter.mkdir('X');
  expect(await store.folderRequirements('X')).toBe('');
  expect((await adapter.list('X')).files).toEqual([]);
  await Promise.all([store.writeFolderRequirements('X', 'old'), store.writeFolderRequirements('X', 'latest')]);
  expect(await store.folderRequirements('X')).toBe('latest');
});
