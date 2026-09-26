import { posix } from 'node:path';
import { ancestorFolders, folderRequirementsPath, noteForFolder, type FolderRequirement } from './folder-notes';
import { DEFAULT_SCHEMA, type SchemaSource } from './schema';

export interface Adapter {
  exists(path: string): Promise<boolean>;
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<{ files: string[]; folders: string[] }>;
  rename(from: string, to: string): Promise<void>;
}
export const GLOBAL_ROOT = '.deepwork/schemas';
export function inlinePath(note: string): string {
  return posix.join(posix.dirname(note), `.deepschema.${posix.basename(note)}.yml`);
}
export function globalPath(name: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(name)) throw new Error('Use 1–80 letters, digits, hyphens, or underscores for the schema name.');
  return `${GLOBAL_ROOT}/${name}/deepschema.yml`;
}
export function remapPaths<T>(entries: Record<string, T>, oldPath: string, newPath: string): Record<string, T> {
  return Object.fromEntries(Object.entries(entries).map(([key, value]) => [
    key === oldPath || key.startsWith(`${oldPath}/`) ? newPath + key.slice(oldPath.length) : key, value
  ]));
}
export class SchemaStore {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(readonly adapter: Adapter, private getDefaultSchema: () => string = () => DEFAULT_SCHEMA) {}

  get defaultSchema(): string { return this.getDefaultSchema(); }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => {});
    return next;
  }
  async flush(): Promise<void> { await this.tail; }
  async mkdir(path: string): Promise<void> {
    if (!path || path === '.') return;
    if (await this.adapter.exists(path)) return;
    await this.mkdir(posix.dirname(path));
    await this.adapter.mkdir(path);
  }
  async inline(note: string): Promise<SchemaSource> {
    await this.flush();
    const path = inlinePath(note);
    return { name: `Inline: ${note}`, path, text: await this.adapter.exists(path) ? await this.adapter.read(path) : this.defaultSchema };
  }
  writeInline(note: string, text: string): Promise<void> {
    return this.enqueue(() => this.adapter.write(inlinePath(note), text));
  }
  async folderRequirements(folder: string): Promise<string> {
    await this.flush();
    const path = folderRequirementsPath(folder);
    return await this.adapter.exists(path) ? this.adapter.read(path) : '';
  }
  writeFolderRequirements(folder: string, text: string): Promise<void> {
    return this.enqueue(() => this.adapter.write(folderRequirementsPath(folder), text));
  }
  async inheritedRequirements(note: string): Promise<FolderRequirement[]> {
    await this.flush();
    const result: FolderRequirement[] = [];
    for (const folder of ancestorFolders(note)) {
      if (!await this.adapter.exists(noteForFolder(folder))) continue;
      const text = await this.folderRequirements(folder);
      if (text.trim()) result.push({ folder, text });
    }
    return result;
  }
  writeGlobal(name: string, text: string, create: boolean): Promise<void> {
    return this.enqueue(async () => {
      const path = globalPath(name);
      if (create && await this.adapter.exists(path)) throw new Error(`A global schema named ${name} already exists.`);
      await this.mkdir(posix.dirname(path));
      await this.adapter.write(path, text);
    });
  }
  async globals(): Promise<Map<string, SchemaSource>> {
    await this.flush();
    const result = new Map<string, SchemaSource>();
    if (!await this.adapter.exists(GLOBAL_ROOT)) return result;
    const { folders } = await this.adapter.list(GLOBAL_ROOT);
    for (const folder of folders.sort()) {
      const path = `${folder}/deepschema.yml`;
      if (await this.adapter.exists(path)) {
        const name = posix.basename(folder);
        result.set(name, { name, path, text: await this.adapter.read(path) });
      }
    }
    return result;
  }
  /** Check before changing either half of a folder note. */
  async checkRenameNote(oldPath: string, newPath: string): Promise<void> {
    const from = inlinePath(oldPath), to = inlinePath(newPath);
    if (from === to || !await this.adapter.exists(to)) return;
    // On case-insensitive volumes, exists(to) may refer to the source itself.
    if (from.toLowerCase() === to.toLowerCase()) {
      const { files } = await this.adapter.list(posix.dirname(from));
      const paths = files.map(path => posix.normalize(path));
      if (paths.includes(from) && !paths.includes(to)) return;
    }
    throw new Error(`Schema move blocked: ${to} already exists. Original preserved at ${from}.`);
  }
  /** Folder moves carry dotfiles automatically. Individual note moves need this. */
  renameNote(oldPath: string, newPath: string): Promise<void> {
    return this.enqueue(async () => {
      const from = inlinePath(oldPath), to = inlinePath(newPath);
      if (from === to || !await this.adapter.exists(from)) return;
      // On a case-insensitive volume, exists(from) still finds an already moved
      // case-only destination. Obsidian's rename event can enqueue the move
      // before the paired renamer's explicit completion step.
      if (from.toLowerCase() === to.toLowerCase()) {
        const { files } = await this.adapter.list(posix.dirname(from));
        const names = new Set(files.map(path => posix.normalize(path)));
        if (!names.has(from) && names.has(to)) return;
      }
      await this.checkRenameNote(oldPath, newPath);
      await this.adapter.rename(from, to);
    });
  }
  writeArtifact(path: string, text: string): Promise<void> {
    return this.enqueue(async () => {
      await this.mkdir(posix.dirname(path));
      await this.adapter.write(path, text);
    });
  }
}
