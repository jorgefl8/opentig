import { randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat, writeFile as writeFsFile } from 'node:fs/promises';
import path from 'node:path';
import type { CreateEntryResult, FileHistoryPathChange, FileResult, ImageFileResult, MoveEntriesResult, MoveEntryResult, RenameEntryResult, WriteFileResult } from '../../shared/contracts';
import type { FileTreeEntry } from '../../shared/git-types';
import { GitOperationError } from '../../shared/errors';
import { detectRasterImageMime } from '../../shared/image-types';
import type { GitProcess } from '../git/GitProcess';
import type { RepositoryService } from '../git/RepositoryService';

const PREVIEW_LIMIT = 1024 * 1024;
const EDIT_LIMIT = 8 * PREVIEW_LIMIT;
const IMAGE_PREVIEW_LIMIT = 32 * 1024 * 1024;
const IMAGE_HEADER_SIZE = 256;
const CLIPBOARD_IMAGE_LIMIT = 64 * 1024 * 1024;

export interface FileSnapshot { path: string; bytes: Buffer; mode: number }

export class FileService {
  constructor(private readonly git: GitProcess, private readonly repositories: RepositoryService) {}

  async list(repositoryId: string): Promise<FileTreeEntry[]> {
    const repository = this.repositories.get(repositoryId);
    const [visible, ignored] = await Promise.all([
      this.git.run(repository.path, ['ls-files', '-co', '--exclude-standard', '-z'], { operation: 'list-files', readOnly: true, maxOutputBytes: 64 * 1024 * 1024 }),
      // `--directory` collapses a fully-ignored folder (node_modules/, .venv/…) to a
      // single entry so the tree carries them cheaply; stray ignored files (a file
      // ignored inside an otherwise-tracked folder) are still listed individually.
      this.git.run(repository.path, ['ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z'], { operation: 'list-ignored-files', readOnly: true, maxOutputBytes: 16 * 1024 * 1024 }),
    ]);
    const visiblePaths = visible.stdout.toString('utf8').split('\0').filter(Boolean).map(normalizeGitPath);
    const ignoredDirectories: string[] = [];
    const ignoredFilePaths: string[] = [];
    for (const entry of ignored.stdout.toString('utf8').split('\0').filter(Boolean)) {
      if (entry.endsWith('/')) ignoredDirectories.push(normalizeGitPath(entry.slice(0, -1)));
      else ignoredFilePaths.push(normalizeGitPath(entry));
    }
    const collapsedIgnoredDirectories = new Set(ignoredDirectories);
    const directoryPaths = await discoverPhysicalDirectories(repository.path, collapsedIgnoredDirectories);
    const matchedIgnoredDirectories = await this.findIgnoredDirectories(repository.path, directoryPaths);
    const directoriesWithVisibleFiles = directoryAncestors(visiblePaths);
    const directories: PhysicalDirectory[] = directoryPaths.map((directory) => ({
      path: directory,
      ignored: collapsedIgnoredDirectories.has(directory)
        || (matchedIgnoredDirectories.has(directory) && !directoriesWithVisibleFiles.has(directory)),
    }));
    const ignoredPaths = new Set(ignoredFilePaths);
    const paths = [...new Set([...visiblePaths, ...ignoredFilePaths])];
    const files: PhysicalFile[] = [];
    for (let offset = 0; offset < paths.length; offset += 64) {
      const chunk = paths.slice(offset, offset + 64);
      const settled = await Promise.all(chunk.map(async (filePath): Promise<PhysicalFile | null> => {
        try {
          const target = this.repositories.resolvePath(repositoryId, filePath);
          const metadata = await lstat(target);
          if (!metadata.isFile() && !metadata.isSymbolicLink()) return null;
          return {
            path: filePath,
            size: metadata.size,
            mtimeMs: metadata.mtimeMs,
            ignored: ignoredPaths.has(filePath),
          };
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (code === 'ENOENT' || code === 'ENOTDIR') return null;
          throw error;
        }
      }));
      files.push(...settled.filter((file): file is PhysicalFile => file !== null));
    }
    return buildTree(files, directories);
  }

  // One level of a folder that `list` deliberately left collapsed. Ignored trees
  // (node_modules/, .venv/…) are never walked up front, so expanding one in the
  // UI pulls its children through here instead of paying for them at startup.
  async listDirectory(repositoryId: string, relativePath: string): Promise<FileTreeEntry[]> {
    const repository = this.repositories.get(repositoryId);
    const directory = this.repositories.resolvePath(repositoryId, relativePath);
    const parent = normalizeGitPath(relativePath).replace(/\/+$/, '');
    let dirents;
    try {
      dirents = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' || code === 'ENOTDIR') return [];
      throw error;
    }
    // Everything under an ignored folder is ignored too, so the whole level
    // inherits the parent's state instead of being checked entry by entry.
    const ignored = (await this.findIgnoredDirectories(repository.path, [parent])).has(parent);
    const entries: FileTreeEntry[] = [];
    for (const dirent of dirents) {
      if (dirent.name === '.git') continue;
      const entryPath = parent ? `${parent}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory() && !dirent.isSymbolicLink()) {
        entries.push({ path: entryPath, name: dirent.name, type: 'directory', ...(ignored ? { ignored: true } : {}), children: [] });
        continue;
      }
      if (!dirent.isFile() && !dirent.isSymbolicLink()) continue;
      try {
        const metadata = await lstat(path.join(directory, dirent.name));
        entries.push({
          path: entryPath,
          name: dirent.name,
          type: 'file',
          size: metadata.size,
          mtimeMs: metadata.mtimeMs,
          ...(ignored ? { ignored: true } : {}),
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      }
    }
    return entries.sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1);
  }

  private async findIgnoredDirectories(repositoryPath: string, directories: string[]): Promise<Set<string>> {
    const ignored = new Set<string>();
    for (let offset = 0; offset < directories.length; offset += 512) {
      const chunk = directories.slice(offset, offset + 512);
      try {
        const result = await this.git.run(repositoryPath, ['check-ignore', '--stdin', '-z'], {
          operation: 'check-ignored-directories',
          readOnly: true,
          maxOutputBytes: 16 * 1024 * 1024,
          stdin: `${chunk.join('\0')}\0`,
        });
        for (const entry of result.stdout.toString('utf8').split('\0').filter(Boolean)) {
          ignored.add(normalizeGitPath(entry).replace(/\/$/, ''));
        }
      } catch (error) {
        if (error instanceof GitOperationError && error.detail.exitCode === 1) continue;
        throw error;
      }
    }
    return ignored;
  }

  async read(repositoryId: string, relativePath: string, allowLarge = false): Promise<FileResult> {
    const repository = this.repositories.get(repositoryId);
    const target = this.repositories.resolvePath(repositoryId, relativePath);
    const resolved = await realpath(target);
    const relative = path.relative(repository.path, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'read-file', message: 'The linked file is outside the worktree.' });
    }
    const metadata = await stat(resolved);
    if (!metadata.isFile()) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'read-file', message: 'The path is not a file.' });
    if (metadata.size > PREVIEW_LIMIT && !allowLarge) {
      return { path: relativePath, content: '', binary: false, tooLarge: true, size: metadata.size, mtimeMs: metadata.mtimeMs };
    }
    const handle = await open(resolved, 'r');
    try {
      const length = Math.min(metadata.size, allowLarge ? 8 * PREVIEW_LIMIT : PREVIEW_LIMIT);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, 0);
      const binary = buffer.subarray(0, Math.min(buffer.length, 8_000)).includes(0);
      return {
        path: relativePath,
        content: binary ? '' : buffer.toString('utf8'),
        binary,
        tooLarge: metadata.size > length,
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
      };
    } finally {
      await handle.close();
    }
  }

  async readImage(repositoryId: string, relativePath: string): Promise<ImageFileResult> {
    const repository = this.repositories.get(repositoryId);
    const target = this.repositories.resolvePath(repositoryId, relativePath);
    const resolved = await realpath(target);
    const relative = path.relative(repository.path, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'read-image', message: 'The linked file is outside the worktree.' });
    }

    const metadata = await stat(resolved);
    if (!metadata.isFile()) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'read-image', message: 'The path is not a file.' });
    }

    if (metadata.size > IMAGE_PREVIEW_LIMIT) {
      const header = await readImageHeader(resolved, IMAGE_HEADER_SIZE);
      const detected = detectRasterImageMime(header);
      if (!detected) {
        return { status: 'unsupported', path: relativePath, size: metadata.size, mtimeMs: metadata.mtimeMs };
      }
      return {
        status: 'too-large',
        path: relativePath,
        mimeType: mimeForPath(relativePath, detected),
        size: metadata.size,
        mtimeMs: metadata.mtimeMs,
        limit: IMAGE_PREVIEW_LIMIT,
      };
    }

    const buffer = await readFile(resolved);
    const latest = await stat(resolved);
    const detected = detectRasterImageMime(buffer.subarray(0, IMAGE_HEADER_SIZE));
    if (!detected) {
      return { status: 'unsupported', path: relativePath, size: latest.size, mtimeMs: latest.mtimeMs };
    }
    if (buffer.byteLength > IMAGE_PREVIEW_LIMIT) {
      return {
        status: 'too-large',
        path: relativePath,
        mimeType: mimeForPath(relativePath, detected),
        size: buffer.byteLength,
        mtimeMs: latest.mtimeMs,
        limit: IMAGE_PREVIEW_LIMIT,
      };
    }

    return {
      status: 'ready',
      path: relativePath,
      mimeType: mimeForPath(relativePath, detected),
      data: Uint8Array.from(buffer),
      size: buffer.byteLength,
      mtimeMs: latest.mtimeMs,
    };
  }

  async write(repositoryId: string, relativePath: string, content: string, expectedContent: string): Promise<WriteFileResult> {
    if (Buffer.byteLength(content, 'utf8') > EDIT_LIMIT || Buffer.byteLength(expectedContent, 'utf8') > EDIT_LIMIT) {
      throw new GitOperationError({ code: 'OUTPUT_LIMIT', operation: 'write-file', message: 'The file is too large to save in the built-in editor.' });
    }

    const repository = this.repositories.get(repositoryId);
    const target = this.repositories.resolvePath(repositoryId, relativePath);
    const resolved = await realpath(target);
    const relative = path.relative(repository.path, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'write-file', message: 'The linked file is outside the worktree.' });
    }

    const metadata = await stat(resolved);
    if (!metadata.isFile()) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'write-file', message: 'The path is not a file.' });
    }
    const currentContent = await readFile(resolved, 'utf8');
    if (currentContent !== expectedContent) return { status: 'conflict' };

    const writable = await open(resolved, 'r+');
    await writable.close();
    const temporary = path.join(path.dirname(resolved), `.${path.basename(resolved)}.justgit-${process.pid}-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, 'wx', metadata.mode);
      try {
        await handle.writeFile(content, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }

      // Re-check immediately before replacement so a concurrent Explorer/editor
      // write never gets silently overwritten by an older JustGit draft.
      if (await readFile(resolved, 'utf8') !== expectedContent) return { status: 'conflict' };
      await rename(temporary, resolved);
      const saved = await stat(resolved);
      return { status: 'saved', path: relativePath, size: saved.size, mtimeMs: saved.mtimeMs };
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async pastePaths(repositoryId: string, sourcePaths: string[], targetDirectory: string): Promise<string[]> {
    if (!Array.isArray(sourcePaths) || sourcePaths.length === 0 || sourcePaths.length > 1_000) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'paste-files', message: 'The clipboard file selection is invalid.' });
    }
    const repository = this.repositories.get(repositoryId);
    const target = await this.resolveDirectory(repositoryId, targetDirectory, 'paste-files');
    const planned: { source: string; destination: string; directory: boolean }[] = [];
    const reserved = new Set<string>();
    for (const sourcePath of sourcePaths) {
      if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) || sourcePath.includes('\0')) {
        throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'paste-files', message: 'The clipboard contains an invalid file path.' });
      }
      const source = path.resolve(sourcePath);
      const metadata = await lstat(source);
      if (metadata.isDirectory() && isSameOrInside(source, target)) {
        throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'paste-files', message: 'A folder cannot be copied into itself.' });
      }
      const destination = await uniqueDestination(target, path.basename(source), metadata.isDirectory(), reserved);
      reserved.add(pathKey(destination));
      planned.push({ source, destination, directory: metadata.isDirectory() });
    }
    const completed: typeof planned = [];
    try {
      for (const item of planned) {
        await cp(item.source, item.destination, { recursive: item.directory, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true });
        completed.push(item);
      }
    } catch (error) {
      const failures: string[] = [];
      for (const item of completed.reverse()) { try { await rm(item.destination, { recursive: item.directory, force: true }); } catch { failures.push(normalizeGitPath(path.relative(repository.path, item.destination))); } }
      if (failures.length) throw new GitOperationError({ code: 'UNKNOWN', operation: 'paste-files', message: `Copy rollback failed for: ${failures.join(', ')}` });
      throw error;
    }
    return planned.map((item) => normalizeGitPath(path.relative(repository.path, item.destination)));
  }

  async movePaths(repositoryId: string, sourcePaths: string[], targetDirectory: string): Promise<string[]> {
    if (!Array.isArray(sourcePaths) || sourcePaths.length === 0 || sourcePaths.length > 1_000) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'paste-cut-files', message: 'The cut file selection is invalid.' });
    }
    const repository = this.repositories.get(repositoryId);
    const target = await this.resolveDirectory(repositoryId, targetDirectory, 'paste-cut-files');
    const planned: { source: string; destination: string; directory: boolean; relative: string }[] = [];
    const destinations = new Set<string>();
    for (const sourcePath of sourcePaths) {
      if (typeof sourcePath !== 'string' || !path.isAbsolute(sourcePath) || sourcePath.includes('\0')) {
        throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'paste-cut-files', message: 'The clipboard contains an invalid file path.' });
      }
      const source = path.resolve(sourcePath);
      const metadata = await lstat(source);
      if (metadata.isDirectory() && isSameOrInside(source, target)) {
        throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'paste-cut-files', message: 'A folder cannot be moved into itself.' });
      }
      const destination = path.join(target, path.basename(source));
      if (samePath(source, destination)) {
        planned.push({ source, destination, directory: metadata.isDirectory(), relative: normalizeGitPath(path.relative(repository.path, source)) });
        continue;
      }
      if (destinations.has(pathKey(destination)) || await pathExists(destination)) {
        throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'paste-cut-files', message: `An item named "${path.basename(source)}" already exists in the destination.` });
      }
      destinations.add(pathKey(destination));
      planned.push({ source, destination, directory: metadata.isDirectory(), relative: normalizeGitPath(path.relative(repository.path, destination)) });
    }
    const completed: typeof planned = [];
    try {
      for (const item of planned) {
        if (samePath(item.source, item.destination)) continue;
        await movePhysical(item.source, item.destination, item.directory);
        completed.push(item);
      }
    } catch (error) {
      const failures: string[] = [];
      for (const item of completed.reverse()) { try { await movePhysical(item.destination, item.source, item.directory); } catch { failures.push(item.relative); } }
      if (failures.length) throw new GitOperationError({ code: 'UNKNOWN', operation: 'paste-cut-files', message: `Move rollback failed for: ${failures.join(', ')}` });
      throw error;
    }
    return planned.map((item) => item.relative);
  }

  async pasteImage(repositoryId: string, targetDirectory: string, png: Uint8Array): Promise<string> {
    if (!(png instanceof Uint8Array) || png.byteLength === 0 || png.byteLength > CLIPBOARD_IMAGE_LIMIT) {
      throw new GitOperationError({ code: 'OUTPUT_LIMIT', operation: 'paste-image', message: 'The clipboard image is empty or too large.' });
    }
    const repository = this.repositories.get(repositoryId);
    const target = await this.resolveDirectory(repositoryId, targetDirectory, 'paste-image');
    const destination = await uniqueDestination(target, 'pasted-image.png', false);
    await writeFsFile(destination, png, { flag: 'wx' });
    return normalizeGitPath(path.relative(repository.path, destination));
  }

  async move(repositoryId: string, relativePath: string, targetDirectory: string): Promise<MoveEntryResult> {
    const repository = this.repositories.get(repositoryId);
    const source = this.repositories.resolvePath(repositoryId, relativePath);
    const metadata = await lstat(source);
    const target = await this.resolveDirectory(repositoryId, targetDirectory, 'move-entry');
    const destination = path.join(target, path.basename(source));
    const from = normalizeGitPath(path.relative(repository.path, source));
    const to = normalizeGitPath(path.relative(repository.path, destination));

    if (samePath(source, destination)) return { status: 'noop', path: from };
    if (metadata.isDirectory() && isSameOrInside(source, target)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'move-entry', message: 'A folder cannot be moved into itself.' });
    }
    if (await pathExists(destination)) return { status: 'conflict', path: to };
    await rename(source, destination);
    return { status: 'moved', from, to };
  }

  async moveEntries(repositoryId: string, relativePaths: string[], targetDirectory: string): Promise<MoveEntriesResult> {
    const valid = this.repositories.validatePaths(repositoryId, relativePaths);
    const selected = valid.filter((candidate) => !valid.some((parent) => parent !== candidate && isRelativeInside(parent, candidate)));
    const repository = this.repositories.get(repositoryId);
    const target = await this.resolveDirectory(repositoryId, targetDirectory, 'move-entries');
    const pairs: FileHistoryPathChange[] = [];
    const conflicts: string[] = [];
    const destinations = new Set<string>();
    for (const relativePath of selected) {
      const source = this.repositories.resolvePath(repositoryId, relativePath);
      const metadata = await lstat(source);
      const destination = path.join(target, path.basename(source));
      const from = normalizeGitPath(path.relative(repository.path, source));
      const to = normalizeGitPath(path.relative(repository.path, destination));
      if (samePath(source, destination)) continue;
      if (metadata.isDirectory() && isSameOrInside(source, target)) {
        throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'move-entries', message: 'A folder cannot be moved into itself.' });
      }
      const key = process.platform === 'win32' ? destination.toLocaleLowerCase() : destination;
      if (destinations.has(key) || await pathExists(destination)) conflicts.push(to);
      destinations.add(key);
      pairs.push({ from, to });
    }
    if (conflicts.length) return { moved: [], conflicts };
    await this.moveExact(repositoryId, pairs);
    return { moved: pairs, conflicts: [] };
  }

  async pathsExist(repositoryId: string, relativePaths: string[]): Promise<boolean> {
    return (await Promise.all(relativePaths.map((item) => pathExists(this.repositories.resolvePath(repositoryId, item))))).every(Boolean);
  }

  async pathsAbsent(repositoryId: string, relativePaths: string[]): Promise<boolean> {
    return (await Promise.all(relativePaths.map((item) => pathExists(this.repositories.resolvePath(repositoryId, item))))).every((exists) => !exists);
  }

  async moveExact(repositoryId: string, pairs: FileHistoryPathChange[]): Promise<void> {
    const resolved = pairs.map(({ from, to }) => ({ from, to, source: this.repositories.resolvePath(repositoryId, from), destination: this.repositories.resolvePath(repositoryId, to) }));
    if (!(await Promise.all(resolved.map((item) => pathExists(item.source)))).every(Boolean)
      || (await Promise.all(resolved.map(async (item) => !samePath(item.source, item.destination) && await pathExists(item.destination)))).some(Boolean)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'move-exact', message: 'An item was changed outside JustGit.' });
    }
    const completed: typeof resolved = [];
    try {
      for (const item of resolved) { await rename(item.source, item.destination); completed.push(item); }
    } catch (error) {
      const failed: string[] = [];
      for (const item of completed.reverse()) { try { await rename(item.destination, item.source); } catch { failed.push(item.from); } }
      if (failed.length) throw new GitOperationError({ code: 'UNKNOWN', operation: 'move-exact', message: `Move rollback failed for: ${failed.join(', ')}` });
      throw error;
    }
  }

  async copyExact(repositoryId: string, sourcePath: string, relativeDestination: string): Promise<void> {
    if (!path.isAbsolute(sourcePath)) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'copy-exact', message: 'The copy source is invalid.' });
    const destination = this.repositories.resolvePath(repositoryId, relativeDestination);
    if (await pathExists(destination)) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'copy-exact', message: 'The destination already exists.' });
    const metadata = await lstat(sourcePath);
    await cp(sourcePath, destination, { recursive: metadata.isDirectory(), errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true });
  }

  async copyExactBatch(repositoryId: string, pairs: { source: string; destination: string }[]): Promise<void> {
    if (!(await this.pathsAbsent(repositoryId, pairs.map((item) => item.destination)))) throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'copy-exact', message: 'A destination already exists.' });
    const completed: { path: string; directory: boolean }[] = [];
    try {
      for (const item of pairs) {
        const metadata = await lstat(item.source);
        await this.copyExact(repositoryId, item.source, item.destination);
        completed.push({ path: this.repositories.resolvePath(repositoryId, item.destination), directory: metadata.isDirectory() });
      }
    } catch (error) {
      for (const item of completed.reverse()) await rm(item.path, { recursive: item.directory, force: true });
      throw error;
    }
  }

  async snapshot(repositoryId: string, relativePath: string, limit: number): Promise<FileSnapshot | null> {
    const target = this.repositories.resolvePath(repositoryId, relativePath);
    const metadata = await lstat(target);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > limit) return null;
    const resolved = await realpath(target);
    const root = this.repositories.get(repositoryId).path;
    if (!isSameOrInside(root, resolved)) return null;
    return { path: relativePath, bytes: await readFile(resolved), mode: metadata.mode };
  }

  async restoreSnapshots(repositoryId: string, snapshots: FileSnapshot[]): Promise<void> {
    if ((await Promise.all(snapshots.map((item) => pathExists(this.repositories.resolvePath(repositoryId, item.path))))).some(Boolean)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'restore-files', message: 'A restore destination already exists.' });
    }
    const restored: string[] = [];
    try {
      for (const snapshot of snapshots) {
        const target = this.repositories.resolvePath(repositoryId, snapshot.path);
        const handle = await open(target, 'wx', snapshot.mode);
        try { await handle.writeFile(snapshot.bytes); await handle.sync(); } finally { await handle.close(); }
        restored.push(target);
      }
    } catch (error) {
      await Promise.all(restored.map((target) => rm(target, { force: true })));
      throw error;
    }
  }

  async createExact(repositoryId: string, entries: { path: string; kind: 'file' | 'directory' }[]): Promise<void> {
    if ((await Promise.all(entries.map((item) => pathExists(this.repositories.resolvePath(repositoryId, item.path))))).some(Boolean)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'create-exact', message: 'A destination already exists.' });
    }
    const created: { target: string; directory: boolean }[] = [];
    try {
      for (const entry of entries) {
        const target = this.repositories.resolvePath(repositoryId, entry.path);
        if (entry.kind === 'directory') await mkdir(target);
        else await writeFsFile(target, '', { flag: 'wx' });
        created.push({ target, directory: entry.kind === 'directory' });
      }
    } catch (error) {
      for (const item of created.reverse()) await rm(item.target, { recursive: item.directory, force: true });
      throw error;
    }
  }

  async snapshotsMatch(repositoryId: string, snapshots: FileSnapshot[]): Promise<boolean> {
    for (const snapshot of snapshots) {
      try {
        const current = await readFile(this.repositories.resolvePath(repositoryId, snapshot.path));
        if (!current.equals(snapshot.bytes)) return false;
      } catch { return false; }
    }
    return true;
  }

  absolutePath(repositoryId: string, relativePath: string): string { return this.repositories.resolvePath(repositoryId, relativePath); }

  async rename(repositoryId: string, relativePath: string, newName: string): Promise<RenameEntryResult> {
    if (!isValidEntryName(newName)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'rename-entry', message: 'The name is invalid.' });
    }
    const repository = this.repositories.get(repositoryId);
    const source = this.repositories.resolvePath(repositoryId, relativePath);
    await lstat(source);
    const destination = path.join(path.dirname(source), newName);
    const from = normalizeGitPath(path.relative(repository.path, source));
    const to = normalizeGitPath(path.relative(repository.path, destination));

    if (path.basename(source) === newName) return { status: 'noop', path: from };
    // A case-only rename resolves to the same file on case-insensitive volumes,
    // so the conflict check would falsely trip; allow it through to `rename`.
    const caseOnlyRename = samePath(source, destination);
    if (!caseOnlyRename && await pathExists(destination)) return { status: 'conflict', path: to };
    await rename(source, destination);
    return { status: 'renamed', from, to };
  }

  async create(repositoryId: string, targetDirectory: string, name: string, kind: 'file' | 'directory'): Promise<CreateEntryResult> {
    if (!isValidEntryName(name)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'create-entry', message: 'The name is invalid.' });
    }
    if (kind !== 'file' && kind !== 'directory') {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'create-entry', message: 'Invalid entry type.' });
    }
    const repository = this.repositories.get(repositoryId);
    const target = await this.resolveDirectory(repositoryId, targetDirectory, 'create-entry');
    const destination = path.join(target, name);
    const relative = normalizeGitPath(path.relative(repository.path, destination));
    if (await pathExists(destination)) return { status: 'conflict', path: relative };
    if (kind === 'directory') await mkdir(destination);
    else await writeFsFile(destination, '', { flag: 'wx' });
    return { status: 'created', path: relative, kind };
  }

  private async resolveDirectory(repositoryId: string, relativePath: string, operation: string): Promise<string> {
    if (typeof relativePath !== 'string' || relativePath.includes('\0') || path.isAbsolute(relativePath)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'The destination folder is invalid.' });
    }
    const repository = this.repositories.get(repositoryId);
    const candidate = relativePath === '' ? repository.path : this.repositories.resolvePath(repositoryId, relativePath);
    const resolved = await realpath(candidate);
    const relative = path.relative(repository.path, resolved);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'The destination folder is outside the worktree.' });
    }
    const metadata = await stat(resolved);
    if (!metadata.isDirectory()) {
      throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation, message: 'The paste destination is not a folder.' });
    }
    return resolved;
  }
}

async function readImageHeader(filePath: string, length: number): Promise<Uint8Array> {
  const handle = await open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function mimeForPath(relativePath: string, detected: Exclude<ReturnType<typeof detectRasterImageMime>, null>) {
  return detected === 'image/png' && /\.apng$/i.test(relativePath) ? 'image/apng' as const : detected;
}

async function uniqueDestination(directory: string, name: string, directorySource: boolean, reserved: ReadonlySet<string> = new Set()): Promise<string> {
  const original = path.join(directory, name);
  if (!reserved.has(pathKey(original)) && !await pathExists(original)) return original;
  const parsed = directorySource ? { name, ext: '' } : path.parse(name);
  for (let index = 1; index <= 10_000; index += 1) {
    const suffix = index === 1 ? ' copy' : ` copy ${index}`;
    const candidate = path.join(directory, `${parsed.name}${suffix}${parsed.ext}`);
    if (!reserved.has(pathKey(candidate)) && !await pathExists(candidate)) return candidate;
  }
  throw new GitOperationError({ code: 'INVALID_ARGUMENT', operation: 'paste-files', message: 'Could not find an available destination name.' });
}

async function movePhysical(source: string, destination: string, directory: boolean): Promise<void> {
  try { await rename(source, destination); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
    await cp(source, destination, { recursive: directory, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true });
    try { await rm(source, { recursive: directory, force: false }); }
    catch (removeError) { await rm(destination, { recursive: directory, force: true }); throw removeError; }
  }
}

function pathKey(value: string): string { return process.platform === 'win32' ? path.resolve(value).toLocaleLowerCase() : path.resolve(value); }

async function pathExists(target: string): Promise<boolean> {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

function isSameOrInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function isRelativeInside(parent: string, child: string): boolean {
  const normalizedParent = normalizeGitPath(parent).replace(/\/+$/, '');
  const normalizedChild = normalizeGitPath(child);
  return normalizedChild.startsWith(`${normalizedParent}/`);
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? path.resolve(left).toLocaleLowerCase() === path.resolve(right).toLocaleLowerCase()
    : path.resolve(left) === path.resolve(right);
}

function isValidEntryName(name: string): boolean {
  return typeof name === 'string'
    && name.length > 0
    && name.length <= 255
    && name !== '.'
    && name !== '..'
    && !/[\\/\0]/.test(name);
}

interface PhysicalFile {
  path: string;
  size: number;
  mtimeMs: number;
  ignored: boolean;
}

interface PhysicalDirectory {
  path: string;
  ignored: boolean;
}

interface MutableNode {
  path: string;
  name: string;
  type: 'file' | 'directory';
  ignored: boolean;
  size: number;
  mtimeMs: number;
  children: Map<string, MutableNode>;
}

function buildTree(files: PhysicalFile[], directories: PhysicalDirectory[] = []): FileTreeEntry[] {
  const root = new Map<string, MutableNode>();
  for (const directory of directories) {
    const parts = directory.path.split('/').filter(Boolean);
    let level = root;
    let accumulated = '';
    parts.forEach((part, index) => {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      let node = level.get(part);
      if (!node) {
        node = { path: accumulated, name: part, type: 'directory', ignored: false, size: 0, mtimeMs: 0, children: new Map() };
        level.set(part, node);
      }
      if (index === parts.length - 1 && node.type === 'directory') node.ignored = directory.ignored;
      level = node.children;
    });
  }
  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let level = root;
    let accumulated = '';
    parts.forEach((part, index) => {
      accumulated = accumulated ? `${accumulated}/${part}` : part;
      const type = index === parts.length - 1 ? 'file' : 'directory';
      let node = level.get(part);
      if (!node) {
        node = {
          path: accumulated,
          name: part,
          type,
          ignored: type === 'file' && file.ignored,
          size: type === 'file' ? file.size : 0,
          mtimeMs: type === 'file' ? file.mtimeMs : 0,
          children: new Map(),
        };
        level.set(part, node);
      }
      level = node.children;
    });
  }
  const serialize = (nodes: Map<string, MutableNode>): FileTreeEntry[] => [...nodes.values()]
    .sort((a, b) => a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)
    .map((node) => node.type === 'directory'
      ? { path: node.path, name: node.name, type: node.type, ...(node.ignored ? { ignored: true } : {}), children: serialize(node.children) }
      : {
        path: node.path,
        name: node.name,
        type: node.type,
        size: node.size,
        mtimeMs: node.mtimeMs,
        ...(node.ignored ? { ignored: true } : {}),
      });
  return serialize(root);
}

async function discoverPhysicalDirectories(repositoryPath: string, collapsedIgnoredDirectories: ReadonlySet<string>): Promise<string[]> {
  const directories: string[] = [];
  const pending: { absolute: string; relative: string }[] = [{ absolute: repositoryPath, relative: '' }];
  while (pending.length > 0) {
    const batch = pending.splice(0, 64);
    const settled = await Promise.all(batch.map(async (current) => {
      try {
        return { current, entries: await readdir(current.absolute, { withFileTypes: true }) };
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT' || code === 'ENOTDIR') return { current, entries: [] };
        throw error;
      }
    }));
    for (const { current, entries } of settled) {
      for (const entry of entries) {
        if (entry.name === '.git' || entry.isSymbolicLink() || !entry.isDirectory()) continue;
        const relative = normalizeGitPath(current.relative ? `${current.relative}/${entry.name}` : entry.name);
        directories.push(relative);
        if (!collapsedIgnoredDirectories.has(relative)) {
          pending.push({ absolute: path.join(current.absolute, entry.name), relative });
        }
      }
    }
  }
  return directories;
}

function directoryAncestors(filePaths: string[]): Set<string> {
  const ancestors = new Set<string>();
  for (const filePath of filePaths) {
    const parts = filePath.split('/').filter(Boolean);
    let accumulated = '';
    for (let index = 0; index < parts.length - 1; index += 1) {
      accumulated = accumulated ? `${accumulated}/${parts[index]}` : parts[index]!;
      ancestors.add(accumulated);
    }
  }
  return ancestors;
}

function normalizeGitPath(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
