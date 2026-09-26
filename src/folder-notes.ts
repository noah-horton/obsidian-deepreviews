import { posix } from 'node:path';
import type { ResolvedSchema } from './schema';

export const FOLDER_REQUIREMENTS_FILE = '.deepwork-requirements.md';
export interface FolderRequirement { folder: string; text: string }
export const folderForNote = (note: string): string => note.endsWith('.md') ? note.slice(0, -3) : '';
export const noteForFolder = (folder: string): string => `${folder}.md`;
export const folderRequirementsPath = (folder: string): string => `${folder}/${FOLDER_REQUIREMENTS_FILE}`;

/** Only ancestors, in outermost-first order. A folder's sibling note is not its child. */
export function ancestorFolders(note: string): string[] {
  const parts = posix.dirname(note).split('/').filter(part => part && part !== '.');
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}
export function appendFolderRequirements(resolved: ResolvedSchema, inherited: FolderRequirement[]): ResolvedSchema {
  const requirements = { ...resolved.schema.requirements };
  for (const entry of inherited) {
    if (!entry.text.trim()) continue;
    let key = `folder_${Buffer.from(entry.folder).toString('hex')}`;
    while (Object.hasOwn(requirements, key)) key += '_';
    requirements[key] = `Inherited from ${noteForFolder(entry.folder)}:\n${entry.text}`;
  }
  return { ...resolved, schema: { ...resolved.schema, requirements } };
}
