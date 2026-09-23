import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isOpenCodeV2, openCodeCliName, openCodeLoginCommand, parseOpenCodeAuthList, parseOpenCodeModels, parseOpenCodeV2GenerateText, parseOpenCodeV2ModelRef, parseOpenCodeV2SessionId } from './open-code-cli';

describe('openCodeCliName', () => {
  it('treats opencode2 shims as OpenCode 2', () => {
    expect(openCodeCliName(path.join('C:\\npm', 'opencode2.cmd'))).toBe('opencode2');
    expect(openCodeCliName('/usr/bin/opencode2')).toBe('opencode2');
    expect(isOpenCodeV2(path.join('C:\\npm', 'opencode2.exe'))).toBe(true);
  });

  it('treats the OpenCode 1 binary as v1', () => {
    expect(openCodeCliName(path.join('C:\\npm', 'opencode.cmd'))).toBe('opencode');
    expect(isOpenCodeV2('/usr/local/bin/opencode')).toBe(false);
    expect(openCodeLoginCommand('opencode2')).toBe('opencode2 auth login');
    expect(openCodeLoginCommand('opencode')).toBe('opencode auth login');
  });
});

describe('parseOpenCodeAuthList', () => {
  it('reads OpenCode 2 empty auth as unauthenticated', () => {
    expect(parseOpenCodeAuthList('No authenticated integrations\n', 0)).toBe('unauthenticated');
  });

  it('reads OpenCode 1 credential listings as authenticated', () => {
    expect(parseOpenCodeAuthList('Credentials\nanthropic  api\n', 0)).toBe('authenticated');
  });

  it('stays unknown when the listing is empty or failed', () => {
    expect(parseOpenCodeAuthList('', 0)).toBe('unknown');
    expect(parseOpenCodeAuthList('No authenticated integrations', 1)).toBe('unknown');
  });
});

describe('parseOpenCodeModels', () => {
  it('keeps Default and provider/model catalog lines', () => {
    const models = parseOpenCodeModels('opencode/big-pickle\nopencode/hy3-free\nnot-a-model\n');
    expect(models[0]).toMatchObject({ id: 'default' });
    expect(models.slice(1).map((model) => model.id)).toEqual(['opencode/big-pickle', 'opencode/hy3-free']);
  });
});

describe('parseOpenCodeV2ModelRef', () => {
  it('splits provider, model, and optional variant', () => {
    expect(parseOpenCodeV2ModelRef('opencode/big-pickle')).toEqual({ providerID: 'opencode', id: 'big-pickle' });
    expect(parseOpenCodeV2ModelRef('openai/gpt-5.2#high')).toEqual({ providerID: 'openai', id: 'gpt-5.2', variant: 'high' });
  });
});

describe('parseOpenCodeV2GenerateText', () => {
  it('reads data.text from the v2 generate payload', () => {
    expect(parseOpenCodeV2GenerateText({ data: { text: '{"subject":"Add AI","body":""}' } })).toBe('{"subject":"Add AI","body":""}');
  });
});

describe('parseOpenCodeV2SessionId', () => {
  it('reads the session id from a create response', () => {
    expect(parseOpenCodeV2SessionId({ data: { id: 'ses_fc6fd40caffeaKd2vp3iuc8w9G' } })).toBe('ses_fc6fd40caffeaKd2vp3iuc8w9G');
  });
});
