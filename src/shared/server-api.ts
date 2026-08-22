import type { OpenTigApi } from './contracts';

/** Domain operations owned by the server boundary. */
export interface OpenTigServerApi {
  app: Pick<OpenTigApi['app'],
    | 'bootstrap'
    | 'capabilities'
    | 'setPreferences'
    | 'setFilesTreeExpandedPaths'
    | 'setOpenFilesState'>;
  projects: OpenTigApi['projects'];
  repository: Omit<OpenTigApi['repository'], 'select' | 'revealEntry'>;
  diff: OpenTigApi['diff'];
  index: OpenTigApi['index'];
  commits: OpenTigApi['commits'];
  refs: OpenTigApi['refs'];
  ai: OpenTigApi['ai'];
  github: OpenTigApi['github'];
  events: OpenTigApi['events'];
}
