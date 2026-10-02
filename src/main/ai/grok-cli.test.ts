import { describe, expect, it } from 'vitest';
import { isSupportedGrokVersion, parseGrokModels, parseGrokOutput } from './grok-cli';

describe('Grok CLI protocol', () => {
  it('requires a tested version family', () => {
    expect(isSupportedGrokVersion('grok 1.0.46 (revision) [stable]')).toBe(true);
    expect(isSupportedGrokVersion('grok 1.1.0')).toBe(true);
    for (const value of ['grok 1.0.40', 'grok 2.0.0', 'unknown']) expect(isSupportedGrokVersion(value)).toBe(false);
  });
  it('does not mistake an unauthenticated catalog for a valid login', () => {
    const result = parseGrokModels('You are not authenticated.\n\nDefault model: grok-test\nAvailable models:\n  * grok-test (default)\n  - grok-other\n  - grok-other\n');
    expect(result.authStatus).toBe('unauthenticated');
    expect(result.models.map((model) => model.id)).toEqual(['default', 'grok-test', 'grok-other']);
    expect(parseGrokModels('You are using XAI_API_KEY.\n').authStatus).toBe('authenticated');
    expect(parseGrokModels('unexpected output').authStatus).toBe('unknown');
  });
  it('prefers validated structured output and accepts the JSON text envelope', () => {
    expect(parseGrokOutput(JSON.stringify({ stopReason: 'end_turn', structuredOutput: { subject: 'Add feature' } })).output).toEqual({ subject: 'Add feature' });
    expect(parseGrokOutput(JSON.stringify({ stopReason: 'end_turn', text: '{"title":"Add feature","body":"Description"}' })).output).toEqual({ title: 'Add feature', body: 'Description' });
  });
  it('rejects incomplete turns, schema failures, and malformed output', () => {
    for (const value of ['not JSON', '{}', '{"stopReason":"max_tokens","text":"{}"}', '{"stopReason":"end_turn","structuredOutput":null}', '{"stopReason":"end_turn","structuredOutput":[],"text":"{}"}', '{"stopReason":"end_turn","structuredOutputError":"invalid","text":"{}"}']) {
      expect(() => parseGrokOutput(value)).toThrow();
    }
  });
});
