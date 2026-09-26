import { join } from 'node:path';

/** The renderer helper is not the Obsidian CLI and aborts when launched directly. */
export function obsidianCliExecutable(rendererExecutable = process.execPath, platform = process.platform): string {
  if (platform !== 'darwin') return 'obsidian';
  const bundle = rendererExecutable.match(/^(.*?\/Obsidian\.app)\/Contents\//)?.[1];
  return bundle ? join(bundle, 'Contents/MacOS/Obsidian') : 'obsidian';
}
