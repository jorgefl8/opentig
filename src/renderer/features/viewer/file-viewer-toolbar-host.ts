import { createContext } from 'react';

/** Where the open-files bar takes a viewer's toolbar. Null while that bar isn't showing. */
export const FileViewerToolbarHostContext = createContext<HTMLElement | null>(null);
