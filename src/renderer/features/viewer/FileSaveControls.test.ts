// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MobileChromeContext } from '@/components/mobile-chrome-context';
import { FileSaveControls } from './EditableFileViewer';

let root: Root;
let container: HTMLDivElement;
let float: HTMLDivElement;
const onSave = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); float = document.createElement('div');
  document.body.append(container, float);
  root = createRoot(container);
  onSave.mockClear();
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); float.remove(); vi.unstubAllGlobals(); });

async function render(props: { dirty: boolean; saving?: boolean; readOnly?: boolean }, phone = true) {
  const controls = createElement(FileSaveControls, { saving: false, readOnly: false, onSave, ...props });
  await act(async () => root.render(createElement(TooltipProvider, null, phone ? createElement(MobileChromeContext.Provider, { value: { title: null, actions: null, float } }, controls) : controls)));
}

it('floats Save on a phone only while there is something to save', async () => {
  await render({ dirty: false });
  expect(float.querySelector('button')).toBeNull();
  await render({ dirty: true });
  const button = float.querySelector<HTMLButtonElement>('.mobile-main-action')!;
  expect(button.textContent).toBe('Save');
  expect(container.querySelector('button')).toBeNull();
  await act(async () => button.click());
  expect(onSave).toHaveBeenCalledOnce();
});

it('says when saving is under way or not possible', async () => {
  await render({ dirty: true, saving: true });
  expect(float.querySelector<HTMLButtonElement>('button')!.textContent).toBe('Saving…');
  expect(float.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
  await render({ dirty: true, readOnly: true });
  expect(float.querySelector<HTMLButtonElement>('button')!.textContent).toBe('Read only');
  expect(float.querySelector<HTMLButtonElement>('button')!.disabled).toBe(true);
});

it('stays in place above the phone layout', async () => {
  await render({ dirty: true }, false);
  expect(float.querySelector('button')).toBeNull();
  expect(container.querySelector('.file-save-button')?.textContent).toBe('Save');
});
