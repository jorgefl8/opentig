import { describe, expect, it } from 'vitest';
import { COMMIT_MESSAGE_SCHEMA } from '../CommitMessagePrompt';
import { cliDiagnostic, requireSuccess, toCodexOutputSchema } from './provider-utils';

describe('requireSuccess', () => {
  it('keeps a successful run silent', () => {
    expect(() => requireSuccess({ exitCode: 0, stdout: '', stderr: 'noise' }, 'codex', 'codex-generate')).not.toThrow();
  });

  it('surfaces a nested Codex JSONL schema error', () => {
    const stdout = [
      '{"type":"thread.started","thread_id":"x"}',
      '{"type":"turn.started"}',
      '{"type":"error","message":"{\\n  \\"type\\": \\"error\\",\\n  \\"error\\": {\\n    \\"type\\": \\"invalid_request_error\\",\\n    \\"code\\": \\"invalid_json_schema\\",\\n    \\"message\\": \\"Invalid schema for response_format \'codex_output_schema\': Missing \'rationale\'.\\",\\n    \\"param\\": \\"text.format.schema\\"\\n  },\\n  \\"status\\": 400\\n}"}',
      '{"type":"turn.failed","error":{"message":"{\\n  \\"type\\": \\"error\\",\\n  \\"error\\": {\\n    \\"type\\": \\"invalid_request_error\\",\\n    \\"code\\": \\"invalid_json_schema\\",\\n    \\"message\\": \\"Invalid schema for response_format \'codex_output_schema\': Missing \'rationale\'.\\",\\n    \\"param\\": \\"text.format.schema\\"\\n  },\\n  \\"status\\": 400\\n}"}}',
    ].join('\n');
    expect(() => requireSuccess({ exitCode: 1, stdout, stderr: '' }, 'codex', 'codex-generate')).toThrow(
      /Codex could not generate the message\. Invalid schema.*Missing 'rationale'/,
    );
  });

  it('classifies a nested model-not-supported error', () => {
    const stdout = '{"type":"error","message":"{\\"type\\":\\"error\\",\\"status\\":400,\\"error\\":{\\"type\\":\\"invalid_request_error\\",\\"message\\":\\"The \'totally-fake-model\' model is not supported when using Codex with a ChatGPT account.\\"}}"}';
    try {
      requireSuccess({ exitCode: 1, stdout, stderr: '' }, 'codex', 'codex-generate');
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toMatchObject({
        detail: {
          code: 'AI_MODEL_UNAVAILABLE',
          message: expect.stringContaining("model is not supported"),
        },
      });
    }
  });
});

describe('cliDiagnostic', () => {
  it('prefers turn.failed over an earlier item warning', () => {
    const stdout = [
      '{"type":"item.completed","item":{"id":"item_0","type":"error","message":"Model metadata missing"}}',
      '{"type":"turn.failed","error":{"message":"stream ended"}}',
    ].join('\n');
    expect(cliDiagnostic({ exitCode: 1, stdout, stderr: 'ignored' })).toBe('stream ended');
  });

  it('falls back to stderr when the JSONL stream has no error event', () => {
    expect(cliDiagnostic({ exitCode: 1, stdout: '{"type":"thread.started"}', stderr: 'codex: crashed\n' })).toBe('codex: crashed');
  });
});

describe('toCodexOutputSchema', () => {
  it('makes every property required without mutating the original schema', () => {
    const schema = {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        subject: { type: 'string' },
        body: { type: 'string' },
        rationale: { type: 'string' },
        commits: {
          type: 'array',
          items: {
            type: 'object',
            properties: { subject: { type: 'string' }, paths: { type: 'array' } },
            required: ['subject'],
          },
        },
      },
      required: ['subject', 'body'],
      additionalProperties: false,
    };

    const strict = toCodexOutputSchema(schema);
    expect(strict.$schema).toBeUndefined();
    expect(strict.required).toEqual(['subject', 'body', 'rationale', 'commits']);
    expect((strict.properties as { commits: { items: { required: string[] } } }).commits.items.required).toEqual(['subject', 'paths']);
    expect(schema.required).toEqual(['subject', 'body']);
    expect(schema.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
  });

  it('strictifies the real commit-message schema without changing the shared copy', () => {
    const strict = toCodexOutputSchema(COMMIT_MESSAGE_SCHEMA);
    expect(strict.required).toEqual(['subject', 'body', 'rationale', 'commits']);
    expect(COMMIT_MESSAGE_SCHEMA.required).toEqual(['subject', 'body']);
  });
});
