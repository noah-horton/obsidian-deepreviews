import { expect, test } from 'bun:test';
import { obsidianCliExecutable } from '../src/obsidian-cli';

const cli = '/Applications/Obsidian.app/Contents/MacOS/Obsidian';

test('resolves the app CLI instead of the renderer helper', () => {
  expect(obsidianCliExecutable('/Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper (Renderer).app/Contents/MacOS/Obsidian Helper (Renderer)', 'darwin')).toBe(cli);
  expect(obsidianCliExecutable('/Applications/Obsidian.app/Contents/MacOS/Obsidian', 'darwin')).toBe(cli);
  expect(obsidianCliExecutable('/opt/Obsidian', 'linux')).toBe('obsidian');
});
