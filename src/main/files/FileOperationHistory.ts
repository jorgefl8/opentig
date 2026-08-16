import type { FileHistoryPathChange, FileHistoryResult, FileHistoryState } from '../../shared/contracts';
import type { FileService, FileSnapshot } from './FileService';

const MAX_STEPS = 50;
export const MAX_UNDO_FILE_SIZE = 5_000_000;
export const MAX_SNAPSHOT_BYTES = 50_000_000;

export interface TrashAdapter { trashItem(path: string): Promise<void> }
type MoveHistoryEntry = { type: 'rename' | 'move'; label: string; sequence: number; bytes: 0; pairs: FileHistoryPathChange[] };
type CreateHistoryEntry = { type: 'create'; label: string; sequence: number; bytes: 0; entries: { path: string; kind: 'file' | 'directory' }[] };
type PasteHistoryEntry = { type: 'paste' | 'paste-image'; label: string; sequence: number; bytes: number; created: string[]; sources?: { source: string; destination: string }[]; snapshots?: FileSnapshot[] };
type DeleteHistoryEntry = { type: 'delete'; label: string; sequence: number; bytes: number; snapshots: FileSnapshot[] };
type EditHistoryEntry = { type: 'edit'; label: string; sequence: number; bytes: number; before: FileSnapshot[]; after: FileSnapshot[] };
type RecycleHistoryEntry = { type: 'recycle-bin-only'; label: string; sequence: number; bytes: 0; paths: string[] };
type HistoryEntry = MoveHistoryEntry | CreateHistoryEntry | PasteHistoryEntry | DeleteHistoryEntry | EditHistoryEntry | RecycleHistoryEntry;
interface RepositoryHistory { undo: HistoryEntry[]; redo: HistoryEntry[] }

export type PreparedDelete =
  | { recovery: 'undo'; snapshots: FileSnapshot[] }
  | { recovery: 'recycle-bin'; paths: string[] };

export class FileOperationHistory {
  private readonly histories = new Map<string, RepositoryHistory>();
  private readonly queues = new Map<string, Promise<void>>();
  private sequence = 0;
  private snapshotBytes = 0;

  constructor(private readonly files: FileService, private readonly trash: TrashAdapter) {}

  state(repositoryId: string): FileHistoryState {
    const history = this.get(repositoryId);
    return { canUndo: history.undo.length > 0, undoLabel: history.undo.at(-1)?.label ?? null, canRedo: history.redo.length > 0, redoLabel: history.redo.at(-1)?.label ?? null };
  }

  async serialize<T>(repositoryId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(repositoryId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => current);
    this.queues.set(repositoryId, tail);
    await previous;
    try { return await task(); }
    finally {
      release();
      if (this.queues.get(repositoryId) === tail) this.queues.delete(repositoryId);
    }
  }

  recordMove(repositoryId: string, label: string, pairs: FileHistoryPathChange[], type: 'rename' | 'move' = 'move'): void {
    if (pairs.length) this.record(repositoryId, { type, label, pairs, sequence: ++this.sequence, bytes: 0 });
  }

  recordCreate(repositoryId: string, label: string, entries: { path: string; kind: 'file' | 'directory' }[]): void {
    if (entries.length) this.record(repositoryId, { type: 'create', label, entries, sequence: ++this.sequence, bytes: 0 });
  }

  recordPaste(repositoryId: string, input: { label: string; created: string[]; sources?: { source: string; destination: string }[]; snapshots?: FileSnapshot[]; image?: boolean }): void {
    if (!input.created.length) return;
    const bytes = input.snapshots?.reduce((total, item) => total + item.bytes.byteLength, 0) ?? 0;
    this.record(repositoryId, { type: input.image ? 'paste-image' : 'paste', label: input.label, created: input.created, sequence: ++this.sequence, bytes, ...(input.sources ? { sources: input.sources } : {}), ...(input.snapshots ? { snapshots: input.snapshots } : {}) });
  }

  async prepareDelete(repositoryId: string, paths: string[]): Promise<PreparedDelete> {
    const snapshots: FileSnapshot[] = [];
    let total = 0;
    for (const item of paths) {
      const snapshot = await this.files.snapshot(repositoryId, item, MAX_UNDO_FILE_SIZE);
      if (!snapshot) return { recovery: 'recycle-bin', paths };
      total += snapshot.bytes.byteLength;
      if (total > MAX_SNAPSHOT_BYTES) return { recovery: 'recycle-bin', paths };
      snapshots.push(snapshot);
    }
    this.evictFor(total);
    if (this.snapshotBytes + total > MAX_SNAPSHOT_BYTES) return { recovery: 'recycle-bin', paths };
    return { recovery: 'undo', snapshots };
  }

  recordDelete(repositoryId: string, prepared: PreparedDelete, deletedPaths: string[]): 'undo' | 'recycle-bin' {
    if (prepared.recovery === 'undo') {
      const selected = prepared.snapshots.filter((item) => deletedPaths.includes(item.path));
      const bytes = selected.reduce((total, item) => total + item.bytes.byteLength, 0);
      this.record(repositoryId, { type: 'delete', label: deletedPaths.length === 1 ? 'Delete item' : `Delete ${deletedPaths.length} items`, snapshots: selected, bytes, sequence: ++this.sequence });
      return 'undo';
    }
    this.record(repositoryId, { type: 'recycle-bin-only', label: deletedPaths.length === 1 ? 'Delete item' : `Delete ${deletedPaths.length} items`, paths: deletedPaths, bytes: 0, sequence: ++this.sequence });
    return 'recycle-bin';
  }

  recordEdit(repositoryId: string, label: string, before: FileSnapshot[], after: FileSnapshot[]): void {
    if (!before.length) return;
    const bytes = [...before, ...after].reduce((total, item) => total + item.bytes.byteLength, 0);
    this.record(repositoryId, { type: 'edit', label, before, after, bytes, sequence: ++this.sequence });
  }

  undo(repositoryId: string): Promise<FileHistoryResult> { return this.serialize(repositoryId, () => this.apply(repositoryId, 'undo')); }
  redo(repositoryId: string): Promise<FileHistoryResult> { return this.serialize(repositoryId, () => this.apply(repositoryId, 'redo')); }

  clear(): void { this.histories.clear(); this.queues.clear(); this.snapshotBytes = 0; }

  private async apply(repositoryId: string, direction: 'undo' | 'redo'): Promise<FileHistoryResult> {
    const history = this.get(repositoryId);
    const source = direction === 'undo' ? history.undo : history.redo;
    const destination = direction === 'undo' ? history.redo : history.undo;
    const entry = source.at(-1);
    if (!entry) return { status: 'empty', state: this.state(repositoryId) };
    if (entry.type === 'recycle-bin-only') {
      source.pop();
      return { status: 'recycle-bin', label: entry.label, paths: entry.paths, state: this.state(repositoryId) };
    }
    try {
      const changes: FileHistoryPathChange[] = [];
      const removed: string[] = [];
      const restored: string[] = [];
      let keepForOppositeDirection = true;
      if (entry.type === 'rename' || entry.type === 'move') {
        const pairs = direction === 'undo' ? entry.pairs.map(({ from, to }) => ({ from: to, to: from })) : entry.pairs;
        await this.files.moveExact(repositoryId, pairs);
        changes.push(...pairs);
      } else if (entry.type === 'create') {
        if (direction === 'undo') { await this.trashPaths(repositoryId, entry.entries.map((item) => item.path)); removed.push(...entry.entries.map((item) => item.path)); }
        else { await this.files.createExact(repositoryId, entry.entries); restored.push(...entry.entries.map((item) => item.path)); }
      } else if (entry.type === 'paste' || entry.type === 'paste-image') {
        if (direction === 'undo') {
          await this.trashPaths(repositoryId, entry.created); removed.push(...entry.created);
          if (entry.type === 'paste-image' && !entry.snapshots) keepForOppositeDirection = false;
        }
        else if (entry.snapshots) { await this.files.restoreSnapshots(repositoryId, entry.snapshots); restored.push(...entry.created); }
        else if (entry.sources) {
          if (!(await this.files.pathsAbsent(repositoryId, entry.created))) throw new Error('A destination already exists.');
          await this.files.copyExactBatch(repositoryId, entry.sources);
          restored.push(...entry.created);
        } else throw new Error('This operation cannot be redone.');
      } else if (entry.type === 'delete') {
        if (direction === 'undo') { await this.files.restoreSnapshots(repositoryId, entry.snapshots); restored.push(...entry.snapshots.map((item) => item.path)); }
        else {
          if (!await this.files.snapshotsMatch(repositoryId, entry.snapshots)) throw new Error('A restored file was changed.');
          await this.trashPaths(repositoryId, entry.snapshots.map((item) => item.path)); removed.push(...entry.snapshots.map((item) => item.path));
        }
      } else if (entry.type === 'edit') {
        const expected = direction === 'undo' ? entry.after : entry.before;
        const replacements = direction === 'undo' ? entry.before : entry.after;
        await this.files.replaceSnapshots(repositoryId, expected, replacements);
      }
      source.pop();
      if (keepForOppositeDirection) destination.push(entry);
      else this.release([entry]);
      return { status: 'applied', direction, label: entry.label, pathChanges: changes, removedPaths: removed, restoredPaths: restored, state: this.state(repositoryId) };
    } catch (error) {
      return { status: 'conflict', label: entry.label, message: error instanceof Error ? error.message : 'The operation conflicts with the current files.', state: this.state(repositoryId) };
    }
  }

  private async trashPaths(repositoryId: string, paths: string[]): Promise<void> {
    if (!(await this.files.pathsExist(repositoryId, paths))) throw new Error('An item no longer exists.');
    for (const item of paths) await this.trash.trashItem(this.files.absolutePath(repositoryId, item));
  }

  private record(repositoryId: string, entry: HistoryEntry): void {
    const history = this.get(repositoryId);
    this.release(history.redo); history.redo = [];
    this.evictFor(entry.bytes);
    history.undo.push(entry); this.snapshotBytes += entry.bytes;
    while (history.undo.length > MAX_STEPS) this.release([history.undo.shift()!]);
  }

  private evictFor(incoming: number): void {
    while (this.snapshotBytes + incoming > MAX_SNAPSHOT_BYTES) {
      let oldest: { stack: HistoryEntry[]; index: number; entry: HistoryEntry } | null = null;
      for (const history of this.histories.values()) for (const stack of [history.undo, history.redo]) stack.forEach((entry, index) => {
        if (entry.bytes > 0 && (!oldest || entry.sequence < oldest.entry.sequence)) oldest = { stack, index, entry };
      });
      if (!oldest) break;
      const victim = oldest as { stack: HistoryEntry[]; index: number; entry: HistoryEntry };
      victim.stack.splice(victim.index, 1); this.snapshotBytes -= victim.entry.bytes;
    }
  }

  private release(entries: HistoryEntry[]): void { for (const entry of entries) this.snapshotBytes -= entry.bytes; }
  private get(repositoryId: string): RepositoryHistory {
    let value = this.histories.get(repositoryId);
    if (!value) { value = { undo: [], redo: [] }; this.histories.set(repositoryId, value); }
    return value;
  }
}
