import { setCustomExtension } from '@pierre/diffs';

// Pierre does not infer XML for SVG files. Register this before creating the
// shared pool so both file editors and diffs pass the mapping to their workers.
setCustomExtension('svg', 'xml');
setCustomExtension('SVG', 'xml');
