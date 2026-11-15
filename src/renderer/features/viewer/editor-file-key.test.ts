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
/** The editor reports its text before it comes back as `value`. */
async function note(text: string) {
  await act(async () => latest.current.noteEditorText(text));
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
  await note('A=2');
  expect(await render('A=2', true)).toBe(initial);
  await note('A=23');
  expect(await render('A=23', true)).toBe(initial);
});

it('issues a new key when editing stops with text Pierre was not given', async () => {
  const initial = await render('A=1', true);
  await note('A=2');
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
  await note('A=external!');
  expect(await render('A=external!', true)).toBe(replaced);
});

it('gives the same text the same key on another mount, so its highlighting is found again', async () => {
  const first = await render('A=1', true);
  const replaced = await render('A=external', true);
  await act(async () => root.unmount());
  root = createRoot(container);
  expect(await render('A=1', true)).toBe(first);
  await act(async () => root.unmount());
  root = createRoot(container);
  expect(await render('A=external', false)).toBe(replaced);
});

it('never shares a key issued after the editor typed, even for the text another mount opens with', async () => {
  const opened = await render('A=1', true);
  await note('A=2');
  await render('A=2', true);
  // Typing back and stopping leaves Pierre holding other text under the first key.
  await note('A=1');
  await render('A=1', true);
  await note('A=2');
  const settled = await render('A=2', false);
  await act(async () => root.unmount());
  root = createRoot(container);
  const reopened = await render('A=2', false);
  expect(reopened).not.toBe(settled);
  expect(reopened).not.toBe(opened);
  expect(settled.startsWith('src/.env')).toBe(true);
});

it('does not hand Pierre the old key with new text for even one render', async () => {
  const keys: string[] = [];
  function Recorder({ value, editing }: { value: string; editing: boolean }) {
    keys.push(`${useEditorFileKey('src/.env', value, editing).key}=${value}`);
    return null;
  }
  await act(async () => root.render(createElement(Recorder, { value: 'A=1', editing: false })));
  const first = keys.at(-1)!.split('=A=')[0];
  await act(async () => root.render(createElement(Recorder, { value: 'A=external', editing: false })));
  expect(keys.filter((entry) => entry.startsWith(`${first}=`) && !entry.endsWith('=A=1'))).toEqual([]);
});
