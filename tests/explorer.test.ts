import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { FolderNoteExplorer } from '../src/explorer';

test('combined entry opens note first, then permits native toggle; arrow and modified clicks stay native', async () => {
  const window = new Window();
  const root = window.document.createElement('div');
  root.innerHTML = `<div class="nav-folder"><div class="nav-folder-title" data-path="Y"><span class="nav-folder-collapse-indicator">▸</span><span class="nav-folder-title-content">Y</span></div></div><div class="nav-file"><div class="nav-file-title" data-path="Y.md">Y</div></div><div class="nav-file"><div class="nav-file-title" data-path="Other.md">Other</div></div>`;
  window.document.body.append(root);
  let active = 'Other.md', nativeClicks = 0, paired = true;
  const opened: string[] = [];
  const explorer = new FolderNoteExplorer(root as unknown as HTMLElement, {
    pairedNote: folder => paired && folder === 'Y' ? 'Y.md' : undefined,
    activeNote: () => active,
    openNote: path => { opened.push(path); active = path; }
  });
  root.addEventListener('click', () => nativeClicks++);
  const click = (selector: string, init = {}) => root.querySelector(selector)!.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true, ...init }));
  expect(root.querySelectorAll('.deepreviews-paired-file').length).toBe(1);
  click('.nav-folder-title-content');
  expect(opened).toEqual(['Y.md']); expect(nativeClicks).toBe(0);
  click('.nav-folder-title-content'); expect(nativeClicks).toBe(1);
  active = 'Other.md';
  click('.nav-folder-collapse-indicator'); expect(nativeClicks).toBe(2);
  click('.nav-folder-title-content', { metaKey: true }); expect(nativeClicks).toBe(3);
  paired = false; explorer.refresh();
  expect(root.querySelector('.deepreviews-paired-file')).toBeNull();
  paired = true; explorer.refresh();
  // Observer must settle instead of repeatedly observing its own class changes.
  await window.happyDOM.waitUntilComplete();
  explorer.destroy();
  expect(root.querySelector('.deepreviews-folder-note')).toBeNull();
  expect(root.querySelector('.deepreviews-paired-file')).toBeNull();
  click('.nav-folder-title-content'); expect(nativeClicks).toBe(4);
});
