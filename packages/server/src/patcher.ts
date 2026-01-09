import type { JsonPatch } from '@dynamodb-reactive/core';
import jsonpatch, { type Operation } from 'fast-json-patch';

const { applyPatch, compare } = jsonpatch;

/**
 * Generate JSON patches between two objects
 * Uses RFC 6902 JSON Patch format
 */
export function generatePatches(
  oldValue: unknown,
  newValue: unknown,
): JsonPatch[] {
  const operations = compare(
    oldValue as Record<string, unknown>,
    newValue as Record<string, unknown>,
  );

  return operations.map((op) => ({
    op: op.op as JsonPatch['op'],
    path: op.path,
    value: 'value' in op ? op.value : undefined,
    from: 'from' in op ? op.from : undefined,
  }));
}

/**
 * Apply JSON patches to an object
 * Returns the patched result
 */
export function applyPatches<T>(document: T, patches: JsonPatch[]): T {
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

  const result = applyPatch(
    structuredClone(document),
    operations,
    true, // Validate operations
    false, // Don't mutate the original
  );

  return result.newDocument as T;
}

/**
 * Check if there are any changes between two values
 */
export function hasChanges(oldValue: unknown, newValue: unknown): boolean {
  const patches = generatePatches(oldValue, newValue);
  return patches.length > 0;
}

/**
 * Create a minimal patch that only includes necessary operations
 * Optimizes the patch by removing redundant operations
 */
export function optimizePatches(patches: JsonPatch[]): JsonPatch[] {
  // Filter out test operations and redundant operations
  const seen = new Set<string>();
  const optimized: JsonPatch[] = [];

  // Process patches in reverse to keep only the last operation for each path
  for (let i = patches.length - 1; i >= 0; i--) {
    const patch = patches[i];
    if (!seen.has(patch.path)) {
      seen.add(patch.path);
      optimized.unshift(patch);
    }
  }

  return optimized;
}

/**
 * Batch multiple patch sets into a single set
 */
export function batchPatches(patchSets: JsonPatch[][]): JsonPatch[] {
  const allPatches = patchSets.flat();
  return optimizePatches(allPatches);
}
