import { z } from 'zod';

export const requestRecordSchema = z.looseObject({});

export function boundedStringSchema(maxLength: number, options: { empty?: boolean; controls?: boolean } = {}) {
  let schema = z.string().max(maxLength).refine((value) => !value.includes('\0'));
  if (options.empty !== true) schema = schema.min(1);
  if (options.controls === false) return schema;
  return schema.refine((value) => ![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127));
}

export const booleanWithDefaultSchema = (fallback: boolean) => z.boolean().optional().default(fallback);

export function parseRecord(value: unknown): Record<string, unknown> | null {
  const parsed = requestRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
