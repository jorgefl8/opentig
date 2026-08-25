import { describe, expect, it } from 'vitest';
import {
  extractIconHref,
  faviconMimeFromPath,
  localIconHrefCandidates,
  repositoryRootFromCommonDir,
} from './repository-favicon';

describe('repository favicon discovery', () => {
  it('strips the git common dir to the repository root', () => {
    expect(repositoryRootFromCommonDir('C:\\repos\\app\\.git')).toBe('C:\\repos\\app');
    expect(repositoryRootFromCommonDir('/home/dev/app/.git/')).toBe('/home/dev/app');
    expect(repositoryRootFromCommonDir('/home/dev/app/.git')).toBe('/home/dev/app');
  });

  it('reads icon hrefs from HTML and object-literal metadata', () => {
    expect(extractIconHref('<link rel="icon" href="/brand/logo.svg">')).toBe('/brand/logo.svg');
    expect(extractIconHref('<link href="/favicon.ico" rel="shortcut icon">')).toBe('/favicon.ico');
    expect(extractIconHref('const links = [{ href: "/brand/logo.svg", rel: "icon" }];')).toBe('/brand/logo.svg');
    expect(extractIconHref('<p>no icon here</p>')).toBeNull();
  });

  it('turns local hrefs into workspace-relative candidates and rejects remote URLs', () => {
    expect(localIconHrefCandidates('/brand/logo.svg')).toEqual(['public/brand/logo.svg', 'brand/logo.svg']);
    expect(localIconHrefCandidates('favicon.ico')).toEqual(['public/favicon.ico', 'favicon.ico']);
    expect(localIconHrefCandidates('https://cdn.example/favicon.png')).toEqual([]);
    expect(localIconHrefCandidates('../secret.svg')).toEqual([]);
    expect(localIconHrefCandidates('data:image/svg+xml,<svg/>')).toEqual([]);
  });

  it('maps common favicon extensions to image MIME types', () => {
    expect(faviconMimeFromPath('public/favicon.svg')).toBe('image/svg+xml');
    expect(faviconMimeFromPath('app/icon.ICO')).toBe('image/x-icon');
    expect(faviconMimeFromPath('assets/logo.png')).toBe('image/png');
    expect(faviconMimeFromPath('readme.md')).toBeNull();
  });
});
