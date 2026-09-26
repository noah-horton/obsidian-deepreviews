import { expect, test } from 'bun:test';
import { ancestorFolders, appendFolderRequirements, folderForNote, noteForFolder } from '../src/folder-notes';
import { resolveSchema } from '../src/schema';

test('pairs sibling Markdown paths and walks only actual ancestors', () => {
  expect(folderForNote('Y/X.md')).toBe('Y/X');
  expect(noteForFolder('Y/X')).toBe('Y/X.md');
  expect(folderForNote('image.png')).toBe('');
  expect(ancestorFolders('Y/X/child.md')).toEqual(['Y', 'Y/X']);
  expect(ancestorFolders('Y/X.md')).toEqual(['Y']);
});
test('appended requirements cannot overwrite local or global requirements even on key collisions', () => {
  const resolved = resolveSchema({ name: 'test', path: 'schema.yml', text: 'requirements: {folder_59: Keep this requirement.}' }, new Map());
  const result = appendFolderRequirements(resolved, [
    { folder: 'Y', text: 'Cite sources.' }, { folder: 'Y/X', text: 'Use metric units.' }
  ]);
  expect(Object.values(result.schema.requirements!)).toEqual(['Keep this requirement.', 'Inherited from Y.md:\nCite sources.', 'Inherited from Y/X.md:\nUse metric units.']);
  expect(resolved.schema.requirements).toEqual({ folder_59: 'Keep this requirement.' });
});
