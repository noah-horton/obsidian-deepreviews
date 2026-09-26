import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import { SchemaFooter } from '../src/footer';
test('footer edits inline YAML, selects globals, reviews, collapses, and cleans up', () => {
  const window = new Window();
  const events: unknown[] = [];
  const footer = new SchemaFooter(window.document as unknown as Document, {
    select: x => events.push(['select', x]), edit: x => events.push(['edit', x]),
    review: () => events.push('review'), cancel: () => events.push('cancel'), manage: () => events.push('manage'), refresh: () => events.push('refresh')
  });
  window.document.body.append(footer.root as never);
  footer.setSchemas(['research'], '');
  footer.setSchema('requirements: {}', '.deepschema.note.md.yml', true);
  expect(footer.select.value).toBe('');
  expect(footer.editor.readOnly).toBe(false);
  footer.editor.value = 'summary: changed';
  footer.editor.dispatchEvent(new window.Event('input') as unknown as Event);
  footer.select.value = 'research';
  footer.select.dispatchEvent(new window.Event('change') as unknown as Event);
  footer.review.click();
  expect(events).toEqual([['edit', 'summary: changed'], ['select', 'research'], 'review']);
  footer.setSchema('summary: global', '.deepwork/schemas/research/deepschema.yml', false);
  expect(footer.editor.readOnly).toBe(true);
  footer.setBusy(true); expect(footer.review.disabled).toBe(true);
  expect(footer.cancel.hidden).toBe(false);
  footer.cancel.click();
  expect(events.at(-1)).toBe('cancel');
  footer.setFeedback({ text: 'PASS\nFixed: corrected the sum.', issue: false });
  expect(footer.feedback.nextElementSibling).toBe(footer.root.querySelector('.deepreviews-body'));
  expect(footer.feedback.textContent).toContain('corrected the sum');
  footer.setStatus('2 requirements · Inline');
  expect(footer.feedback.textContent).toContain('corrected the sum');
  footer.setSchemas([], 'research'); expect(footer.select.selectedOptions[0]?.textContent).toContain('missing');
  footer.root.querySelector<HTMLButtonElement>('.deepreviews-toggle')!.click();
  expect(footer.root.querySelector<HTMLElement>('.deepreviews-body')!.hidden).toBe(true);
  expect(footer.feedback.hidden).toBe(false);
  footer.setFeedback({ text: '<b>Unresolved: missing evidence.</b>', issue: true });
  expect(footer.feedback.querySelector('b')).toBeNull();
  expect(footer.feedback.classList.contains('deepreviews-error')).toBe(true);
  footer.setBusy(false); expect(footer.cancel.hidden).toBe(true);
  footer.destroy(); expect(window.document.querySelector('.deepreviews-footer')).toBeNull();
});

test('folder editor saves plain text and inherited sources are read-only beneath editors', () => {
  const window = new Window();
  const edits: string[] = [];
  const footer = new SchemaFooter(window.document as unknown as Document, {
    select() {}, edit() {}, editFolder: text => edits.push(text), review() {}, cancel() {}, manage() {}, refresh() {}
  });
  footer.setFolderRequirements('Y/X', 'Use metric units.', [{ folder: 'Y', text: '<b>Cite sources.</b>' }]);
  expect(footer.folderEditor.disabled).toBe(false);
  footer.folderEditor.value = 'Updated';
  footer.folderEditor.dispatchEvent(new window.Event('input') as unknown as Event);
  expect(edits).toEqual(['Updated']);
  expect(footer.inherited.textContent).toContain('Y.md');
  expect(footer.inherited.textContent).toContain('<b>Cite sources.</b>');
  expect(footer.inherited.querySelector('b, textarea, input, [contenteditable]')).toBeNull();
  expect(footer.root.querySelector('.deepreviews-folder-section')!.nextElementSibling!.contains(footer.inherited)).toBe(true);
  footer.setFolderRequirements(undefined, '', []);
  expect(footer.folderEditor.disabled).toBe(true);
  expect(footer.inherited.parentElement!.hidden).toBe(true);
});
