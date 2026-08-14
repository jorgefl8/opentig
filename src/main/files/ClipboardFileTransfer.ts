import { lstat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Clipboard } from 'electron';

const FILE_FORMAT_PATTERN = /filenamew|filename|cf_hdrop|text\/uri-list/i;

export async function readClipboardFilePaths(systemClipboard: Clipboard): Promise<string[]> {
  const candidates: string[] = [];
  for (const format of systemClipboard.availableFormats()) {
    if (!FILE_FORMAT_PATTERN.test(format)) continue;
    try {
      candidates.push(...parseFileClipboardBuffer(format, systemClipboard.readBuffer(format)));
    } catch {
      // Some native formats can only be exposed as strings by Chromium.
    }
    try {
      candidates.push(...parseClipboardPathText(systemClipboard.read(format)));
    } catch {
      // Ignore a representation that cannot be decoded.
    }
  }
  candidates.push(...parseClipboardPathText(systemClipboard.readText()));

  const unique = new Map<string, string>();
  for (const candidate of candidates) {
    if (!path.isAbsolute(candidate)) continue;
    const resolved = path.resolve(candidate);
    const key = process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
    if (unique.has(key)) continue;
    try {
      await lstat(resolved);
      unique.set(key, resolved);
    } catch {
      // Text that merely resembles a path must not become a paste source.
    }
  }
  return [...unique.values()];
}

export function parseFileClipboardBuffer(format: string, buffer: Uint8Array): string[] {
  if (buffer.byteLength === 0) return [];
  const value = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  if (/cf_hdrop/i.test(format) && value.byteLength >= 20) {
    const offset = value.readUInt32LE(0);
    if (offset >= 20 && offset < value.byteLength) {
      const wide = value.readUInt32LE(16) !== 0;
      return parseClipboardPathText(value.subarray(offset).toString(wide ? 'utf16le' : 'latin1'));
    }
  }
  return parseClipboardPathText(value.toString(/filenamew/i.test(format) ? 'utf16le' : 'utf8'));
}

export function parseClipboardPathText(value: string): string[] {
  const paths: string[] = [];
  for (const raw of value.split(/\0|\r?\n/)) {
    let candidate = raw.trim();
    if (!candidate || candidate.startsWith('#')) continue;
    if (candidate.length >= 2 && candidate.startsWith('"') && candidate.endsWith('"')) {
      candidate = candidate.slice(1, -1);
    }
    if (/^file:\/\//i.test(candidate)) {
      try {
        candidate = fileURLToPath(candidate);
      } catch {
        continue;
      }
    }
    if (path.isAbsolute(candidate)) paths.push(candidate);
  }
  return paths;
}
