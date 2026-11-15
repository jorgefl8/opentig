import { enableCompileCache } from '../../../src/main/process/compile-cache';

// The desktop's server process. The cache is on before the server's code is loaded,
// which is why it is loaded here rather than imported.
enableCompileCache();
await import('./utility-process');
