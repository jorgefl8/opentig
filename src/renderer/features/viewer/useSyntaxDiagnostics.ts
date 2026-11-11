import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor, Marker } from '@pierre/diffs/edit';
import { analyzeSyntax, syntaxDiagnosticsLanguage, type SyntaxDiagnostic, type SyntaxDiagnosticsResult } from './syntax-diagnostics';

/** Typing pauses this long before the draft is checked again. */
export const SYNTAX_DIAGNOSTICS_DELAY_MS = 300;

const NO_DIAGNOSTICS: SyntaxDiagnosticsResult = { diagnostics: [], omitted: 0, skipped: false };

interface CheckedDraft {
  path: string;
  result: SyntaxDiagnosticsResult;
}

function check(path: string, text: string, enabled: boolean): CheckedDraft {
  return { path, result: enabled ? analyzeSyntax(text, syntaxDiagnosticsLanguage(path)) : NO_DIAGNOSTICS };
}

/**
 * Checks the draft of a JSON, JSONC, or YAML file. A newly opened file is
 * checked at once; edits are checked after a short pause in typing.
 */
export function useSyntaxDiagnostics(path: string, text: string, enabled: boolean): SyntaxDiagnosticsResult {
  const [checked, setChecked] = useState(() => check(path, text, enabled));
  const lastInput = useRef({ path, text, enabled });

  useEffect(() => {
    const last = lastInput.current;
    if (last.path === path && last.text === text && last.enabled === enabled) return;
    const timer = setTimeout(() => {
      lastInput.current = { path, text, enabled };
      setChecked(check(path, text, enabled));
    }, last.path === path ? SYNTAX_DIAGNOSTICS_DELAY_MS : 0);
    return () => clearTimeout(timer);
  }, [enabled, path, text]);

  // Never show one file's problems on another while the new one is checked.
  return checked.path === path && enabled ? checked.result : NO_DIAGNOSTICS;
}

type MarkerEditor = Pick<Editor<'file'>, 'setMarkers' | 'focus'>;

function toMarker({ severity, message, start, end, source }: SyntaxDiagnostic): Marker {
  return { severity, message, source, start, end };
}

function applyMarkers(editor: MarkerEditor | null, diagnostics: readonly SyntaxDiagnostic[]) {
  try {
    editor?.setMarkers(diagnostics.map(toMarker));
  } catch {
    // The editor is between documents; its next attach applies the markers.
  }
}

/**
 * Underlines each problem's exact range through the editor's own markers, and
 * moves the caret to a line's end on request. The editor clears markers when it
 * detaches, so `onAttach` reapplies the current ones.
 */
export function useSyntaxMarkers(diagnostics: readonly SyntaxDiagnostic[]) {
  const editorRef = useRef<MarkerEditor | null>(null);
  const diagnosticsRef = useRef(diagnostics);

  useEffect(() => {
    diagnosticsRef.current = diagnostics;
    applyMarkers(editorRef.current, diagnostics);
  }, [diagnostics]);

  const onAttach = useCallback((editor: MarkerEditor) => {
    editorRef.current = editor;
    applyMarkers(editor, diagnosticsRef.current);
  }, []);

  const focusLineEnd = useCallback((line: number) => {
    editorRef.current?.focus({ lineNumber: line + 1, character: Number.MAX_SAFE_INTEGER });
  }, []);

  return { onAttach, focusLineEnd };
}
