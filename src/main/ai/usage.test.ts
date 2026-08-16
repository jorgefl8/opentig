import { describe, expect, it } from 'vitest';
import { claudeUsage, codexUsage, openCodeUsage } from './usage';

// The payloads below were captured from the installed CLIs, not invented, so a
// change in any harness's reporting shape fails here instead of silently
// turning every recorded run into "no tokens reported".

describe('claudeUsage', () => {
  const envelope = {
    is_error: false,
    total_cost_usd: 0.09653880000000001,
    usage: {
      input_tokens: 2,
      cache_creation_input_tokens: 15147,
      cache_read_input_tokens: 18136,
      output_tokens: 14,
      output_tokens_details: { thinking_tokens: 0 },
      service_tier: 'standard',
    },
    result: 'Hola.',
  };

  it('reads tokens and the reported dollar cost', () => {
    expect(claudeUsage(envelope)).toEqual({
      inputTokens: 2,
      outputTokens: 14,
      reasoningTokens: 0,
      cacheReadTokens: 18136,
      cacheWriteTokens: 15147,
      costUsd: 0.09653880000000001,
    });
  });

  it('reports nothing rather than zero when the envelope is unusable', () => {
    for (const value of [null, undefined, 'text', {}, { usage: 'nope' }]) {
      expect(claudeUsage(value)).toMatchObject({ inputTokens: null, outputTokens: null, costUsd: null });
    }
  });
});

describe('codexUsage', () => {
  const stream = [
    '{"type":"thread.started","thread_id":"019f4e74"}',
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Hola."}}',
    '{"type":"turn.completed","usage":{"input_tokens":38617,"cached_input_tokens":28160,"cache_write_input_tokens":0,"output_tokens":111,"reasoning_output_tokens":35}}',
  ].join('\n');

  it('takes usage from the final turn.completed event', () => {
    expect(codexUsage(stream)).toEqual({
      inputTokens: 38617,
      outputTokens: 111,
      reasoningTokens: 35,
      cacheReadTokens: 28160,
      cacheWriteTokens: 0,
      // Codex reports no cost, and guessing one from a price table would drift.
      costUsd: null,
    });
  });

  it('keeps the last turn when a run reports several', () => {
    const twoTurns = `{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}\n${stream}`;
    expect(codexUsage(twoTurns).inputTokens).toBe(38617);
  });

  it('survives interleaved noise, partial lines, and a failed turn', () => {
    expect(codexUsage('')).toEqual({ ...codexUsage('not json at all') });
    expect(codexUsage('{"type":"turn.completed"')).toMatchObject({ inputTokens: null });
    expect(codexUsage('{"type":"turn.failed","error":{"message":"stream ended"}}')).toMatchObject({ inputTokens: null });
  });
});

describe('openCodeUsage', () => {
  const info = {
    role: 'assistant',
    cost: 0.01248075,
    tokens: { input: 16616, output: 5, reasoning: 0, cache: { read: 0, write: 0 } },
  };

  it('reads the typed assistant message from the local server', () => {
    expect(openCodeUsage(info)).toEqual({
      inputTokens: 16616,
      outputTokens: 5,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.01248075,
    });
  });

  it('reports nothing when the message carries no accounting', () => {
    expect(openCodeUsage({ role: 'assistant' })).toMatchObject({ inputTokens: null, costUsd: null });
    expect(openCodeUsage(null)).toMatchObject({ inputTokens: null });
  });
});
