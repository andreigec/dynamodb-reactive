import jsonpatch, { type Operation } from 'fast-json-patch';

import type { JsonPatch } from './types.js';

const { applyPatch } = jsonpatch;

/**
 * Apply JSON patches to a document
 */
export function applyPatches<T>(document: T, patches: JsonPatch[]): T {
  if (patches.length === 0) {
    return document;
  }

  const operations: Operation[] = patches.map((patch) => {
    const op: Operation = {
      op: patch.op,
      path: patch.path,
    } as Operation;

    if ('value' in patch && patch.value !== undefined) {
      (op as { value: unknown }).value = patch.value;
    }
    if ('from' in patch && patch.from !== undefined) {
      (op as { from: string }).from = patch.from;
    }

    return op;
  });

  try {
    const result = applyPatch(
      structuredClone(document),
      operations,
      true, // Validate operations
      false, // Don't mutate the original
    );

    return result.newDocument as T;
  } catch (error) {
    console.error('Failed to apply patches:', error);
    throw error;
  }
}
