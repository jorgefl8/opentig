import { createContext } from 'react';

/**
 * Opens History narrowed to one file. Null on a server that can't read a file's history, so
 * nothing offers it there.
 */
export const FileHistoryContext = createContext<((path: string) => void) | null>(null);
