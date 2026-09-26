import { expect, test } from 'bun:test';
import { buildReviewPrompt } from '../src/prompt';
import { resolveSchema } from '../src/schema';
test('review carries unsaved note snapshot, resolved schema, source-relative references and command policy', async () => {
  const parent = { name: 'base', path: '.deepwork/schemas/base/deepschema.yml', text: 'requirements: {title: Note MUST have a title}\njson_schema_path: note.json' };
  const child = { name: 'inline', path: 'Notes/.deepschema.Test.md.yml', text: `parent_deep_schemas: [base]
references:
  - {path: ../Reference.md, description: Guide}
  - {path: missing.md, description: Missing}
  - {path: 'https://example.com', description: Web}
examples: [{path: Good.md, description: Sample}]
verification_bash_command: ['echo "$1"']` };
  const resolved = resolveSchema(child, new Map([['base', parent]]));
  const reads: string[] = [];
  const prompt = await buildReviewPrompt({ notePath: 'Notes/Test.md', noteText: 'UNSAVED editor snapshot', vaultPath: '/vault with spaces', resolved, allowVerification: false, obsidianExecutable: '/Applications/Obsidian.app/Contents/MacOS/Obsidian', read: async path => {
    reads.push(path); if (path.endsWith('missing.md')) throw new Error('File not found'); return '{}';
  } });
  expect(prompt).toContain('UNSAVED editor snapshot');
  expect(prompt).toContain('Note MUST have a title');
  expect(prompt).toContain('do not execute them');
  expect(prompt).toContain('INCOMPLETE');
  expect(prompt).toContain('automatically fix the target note in place');
  expect(prompt).toContain('Only modify the target note');
  expect(prompt).toContain('Use ONLY the Obsidian CLI for renames');
  expect(prompt).toContain('path=Notes/Test.md');
  expect(prompt).toContain('Notes/.deepschema.Test.md.yml');
  expect(prompt).toContain('DeepReviews handles the Obsidian rename');
  expect(prompt).toContain('Search for and read any other files in the vault that may be useful to the review');
  expect(prompt).toContain('related context not explicitly listed in the schema');
  expect(prompt).toContain('Treat these files as read-only review material');
  expect(prompt).toContain('preserve any changes made since the snapshot');
  expect(prompt).toContain('Be extremely concise and specific');
  expect(prompt).toContain('AFTER fixes');
  expect(prompt).not.toContain('Do not apply fixes');
  expect(prompt).toContain('File not found');
  expect(prompt).toContain('Notes/Good.md');
  expect(reads).toEqual(['Reference.md', 'Notes/missing.md', '.deepwork/schemas/base/note.json']);
});
