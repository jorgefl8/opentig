import { buildDiffFileEntries } from './patch-utils';
import type { DiffParseRequest, DiffParseResponse } from './diff-parser';

// A request owns this worker. Terminating it interrupts even a single large
// getSingularPatch call; no partial file models are exposed to the renderer.
self.onmessage = ({ data }: MessageEvent<DiffParseRequest>) => {
  let response: DiffParseResponse;
  try {
    response = { revision: data.revision, files: buildDiffFileEntries(data.patch) };
  } catch (reason) {
    response = { revision: data.revision, error: reason instanceof Error ? reason.message : 'Could not parse the diff.' };
  }
  self.postMessage(response);
};
