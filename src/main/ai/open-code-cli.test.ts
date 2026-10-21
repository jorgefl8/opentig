import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isOpenCodeV2Version, openCodeCliName, parseOpenCodeAuthList, parseOpenCodeModels, parseOpenCodeV2ModelRef } from './open-code-cli';

describe('openCodeCliName', () => {
  it('distinguishes the alternate command name from the current one without inferring a version', () => {
    expect(openCodeCliName(path.join('C:\\npm', 'opencode2.cmd'))).toBe('opencode2');
    expect(openCodeCliName('/usr/bin/opencode2')).toBe('opencode2');
    expect(openCodeCliName(path.join('C:\\npm', 'opencode.cmd'))).toBe('opencode');
  });
});

describe('isOpenCodeV2Version', () => {
  it('accepts v2 under either name and rejects v1, legacy betas, and unknown versions', () => {
    for (const version of ['2.0.22', 'opencode v2.1.0', 'opencode2 2.0.22', 'v2.2.0-beta.1']) expect(isOpenCodeV2Version(version)).toBe(true);
    for (const version of ['1.15.13', 'opencode2 v0.0.0-beta-18155', '', '3.0.0', 'error: 2.0.22']) expect(isOpenCodeV2Version(version)).toBe(false);
  });
});

describe('parseOpenCodeAuthList', () => {
  it('reads credential metadata without fetching secret values', () => {
    expect(parseOpenCodeAuthList('[{"id":"anthropic","connections":[{"type":"credential","label":"account"}]}]', 0)).toBe('authenticated');
    expect(parseOpenCodeAuthList('[]', 0)).toBe('unauthenticated');
  });
  it('does not treat malformed or failed output as authenticated', () => {
    for (const text of ['', 'Credentials', '{}', '[{}]']) expect(parseOpenCodeAuthList(text, 0)).toBe('unknown');
    expect(parseOpenCodeAuthList('[]', 1)).toBe('unknown');
  });
});

describe('parseOpenCodeModels', () => {
  it('keeps Default and provider/model catalog lines', () => {
    const models = parseOpenCodeModels('opencode/big-pickle\nopencode/hy3-free\nopenai/gpt-5.2#high\nopenai/gpt-5.2#high\nnot-a-model\n');
    expect(models[0]).toMatchObject({ id: 'default' });
    expect(models.slice(1).map((model) => model.id)).toEqual(['opencode/big-pickle', 'opencode/hy3-free', 'openai/gpt-5.2#high']);
  });
});

describe('parseOpenCodeV2ModelRef', () => {
  it('splits provider, model, and optional variant', () => {
    expect(parseOpenCodeV2ModelRef('opencode/big-pickle')).toEqual({ providerID: 'opencode', id: 'big-pickle' });
    expect(parseOpenCodeV2ModelRef('openai/gpt-5.2#high')).toEqual({ providerID: 'openai', id: 'gpt-5.2', variant: 'high' });
  });
});

describe('invalid model references', () => {
  it('rejects incomplete providers, models, and variants', () => {
    for (const id of ['foo', '/bar', 'foo/', 'foo/bar#', 'foo/bar#a#b', 'foo/bar baz']) expect(() => parseOpenCodeV2ModelRef(id)).toThrow();
  });
});
