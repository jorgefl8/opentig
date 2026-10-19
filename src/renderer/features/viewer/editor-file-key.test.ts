// @vitest-environment jsdom
import { act, createElement, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useEditorFileKey } from './editor-file-key';

let root: Root;
let container: HTMLDivElement;
const latest = { current: null as unknown as ReturnType<typeof useEditorFileKey> };

function Probe({ value, editing }: { value: string; editing: boolean }) {
  const result = useEditorFileKey('src/.env', value, editing);
  useLayoutEffect(() => { latest.current = result; });
  return null;
}
async function render(value: string, editing: boolean) {
  await act(async () => root.render(createElement(Probe, { value, editing })));
  return latest.current.key;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div');
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it('keeps the key while the editor reports its own text, including a save', async () => {
  const initial = await render('A=1', true);
  latest.current.noteEditorText('A=2');
  expect(await render('A=2', true)).toBe(initial);
  latest.current.noteEditorText('A=23');
  expect(await render('A=23', true)).toBe(initial);
});

it('issues a new key when editing stops with text Pierre was not given', async () => {
  const initial = await render('A=1', true);
  latest.current.noteEditorText('A=2');
  await render('A=2', true);
  const settled = await render('A=2', false);
  expect(settled).not.toBe(initial);
  expect(await render('A=2', true)).toBe(settled);
  expect(await render('A=2', false)).toBe(settled);
});

it('keeps the key when editing stops without edits', async () => {
  const initial = await render('A=1', true);
  expect(await render('A=1', false)).toBe(initial);
});

it('issues a new key when the text is replaced from outside the editor', async () => {
  const initial = await render('A=1', true);
  const replaced = await render('A=external', true);
  expect(replaced).not.toBe(initial);
  latest.current.noteEditorText('A=external!');
  expect(await render('A=external!', true)).toBe(replaced);
});

it('never shares a key between mounts of the same path', async () => {
  const first = await render('A=1', true);
  await act(async () => root.unmount());
  root = createRoot(container);
  const second = await render('A=1', true);
  expect(second).not.toBe(first);
  expect(second.startsWith('src/.env')).toBe(true);
});
