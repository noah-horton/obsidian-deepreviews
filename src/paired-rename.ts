import { posix } from 'node:path';
import { folderForNote, noteForFolder } from './folder-notes';

interface Entry { path: string }
export interface PairedRenameIO<T extends Entry> {
  get(path: string): T | null | undefined;
  isFolder(file: T): boolean;
  rename(file: T, path: string): Promise<void>;
  prepareNoteRename(from: string, to: string): Promise<void>;
  finishNoteRename(from: string, to: string): Promise<void>;
  flush(): Promise<void>;
}

/** Coordinate native renames before either half of a pair is changed. */
export class PairedRenamer<T extends Entry> {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly io: PairedRenameIO<T>) {}

  rename(file: T, destination: string): Promise<void> {
    const oldPath = file.path;
    if (oldPath === destination) return Promise.resolve();
    const folder = this.io.isFolder(file);
    const otherPath = folder ? noteForFolder(oldPath) : folderForNote(oldPath);
    const other = posix.dirname(oldPath) === posix.dirname(destination) && otherPath ? this.io.get(otherPath) : undefined;
    if (!other || this.io.isFolder(other) === folder) {
      const operation = this.tail.then(async () => {
        await this.io.flush();
        if (file.path !== oldPath) throw new Error('The file changed while waiting to rename. Try again.');
        if (!folder) await this.io.prepareNoteRename(oldPath, destination);
        await this.io.rename(file, destination);
        if (!folder) {
          try { await this.io.finishNoteRename(oldPath, destination); }
          catch (error) {
            try {
              if (file.path !== destination || this.io.get(oldPath)) throw new Error('Original path is no longer available.');
              await this.io.rename(file, oldPath);
              await this.io.finishNoteRename(destination, oldPath);
            } catch (rollbackError) {
              throw new Error(`Schema rename failed: ${String(error)}. Could not restore note: ${String(rollbackError)}. Current path: ${file.path}.`);
            }
            throw new Error(`Schema rename failed; original note name restored. ${String(error)}`);
          }
        }
        await this.io.flush();
      });
      this.tail = operation.catch(() => {});
      return operation;
    }
    if (!folder && !destination.endsWith('.md')) return Promise.reject(new Error('A folder note must keep its .md extension.'));
    const otherDestination = folder ? noteForFolder(destination) : folderForNote(destination);
    const operation = this.tail.then(async () => {
      await this.io.flush();
      if (file.path !== oldPath || other.path !== otherPath) throw new Error('The folder note changed while waiting to rename. Try again.');
      const steps = [
        { file, from: oldPath, to: destination },
        { file: other, from: otherPath, to: otherDestination }
      ];
      for (const step of steps) {
        const existing = this.io.get(step.to);
        if (existing && existing !== step.file) throw new Error(`Cannot rename folder note: ${step.to} already exists.`);
      }
      await this.io.prepareNoteRename(folder ? otherPath : oldPath, folder ? otherDestination : destination);
      try {
        for (const step of steps) {
          await this.io.rename(step.file, step.to);
          if (!this.io.isFolder(step.file)) await this.io.finishNoteRename(step.from, step.to);
          await this.io.flush();
        }
      } catch (error) {
        const rollbackErrors: string[] = [];
        for (const step of [...steps].reverse()) {
          if (step.file.path === step.from) continue;
          if (step.file.path !== step.to) {
            rollbackErrors.push(`${step.from} moved again to ${step.file.path}`); continue;
          }
          try {
            const existing = this.io.get(step.from);
            if (existing && existing !== step.file) throw new Error(`${step.from} is now occupied`);
            await this.io.rename(step.file, step.from);
            if (!this.io.isFolder(step.file)) await this.io.finishNoteRename(step.to, step.from);
            await this.io.flush();
          } catch (rollbackError) { rollbackErrors.push(String(rollbackError)); }
        }
        if (rollbackErrors.length) throw new Error(`Folder note rename failed: ${String(error)}. Could not fully restore the original names: ${rollbackErrors.join('; ')}. Current paths: ${file.path}, ${other.path}.`);
        throw new Error(`Folder note rename failed; original names restored. ${String(error)}`);
      }
    });
    this.tail = operation.catch(() => {});
    return operation;
  }
}
