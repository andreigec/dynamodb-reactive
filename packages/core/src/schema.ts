import { z } from 'zod';

import { DynamoTable } from './table.js';
import type { IndexDefinition } from './types.js';

/**
 * Helper function to define a schema with type inference
 * This provides a cleaner API for defining tables
 *
 * @example
 * ```ts
 * const TodoTable = defineSchema({
 *   tableName: 'prod-todo-table',
 *   schema: z.object({
 *     id: z.string(),
 *     taskListId: z.string(),
 *     text: z.string(),
 *     isDone: z.boolean(),
 *   }),
 *   pk: 'id',
 *   indexes: {
 *     byTaskId: { name: 'gsi_by_task_id', pk: 'taskListId' }
 *   }
 * });
 * ```
 */
export function defineSchema<
  TSchema extends z.ZodObject<z.ZodRawShape>,
  TPk extends keyof z.infer<TSchema> & string,
  TSk extends (keyof z.infer<TSchema> & string) | undefined = undefined,
  TIndexes extends Record<string, IndexDefinition> = Record<
    string,
    IndexDefinition
  >,
>(config: {
  tableName: string;
  schema: TSchema;
  pk: TPk;
  sk?: TSk;
  indexes?: TIndexes;
}): DynamoTable<TSchema, TPk, TSk, TIndexes> {
  return new DynamoTable(config);
}

/**
 * System table schemas for the reactive engine
 */
export const SystemSchemas = {
  /**
   * ReactiveConnections - Tracks active WebSocket connections
   */
  connections: z.object({
    connectionId: z.string(),
    context: z.record(z.unknown()).optional(),
    connectedAt: z.number(),
    ttl: z.number(),
  }),

  /**
   * ReactiveDependencies - The inverted index for O(1) lookups
   */
  dependencies: z.object({
    pk: z.string(), // Format: "TableName#FieldName#FieldValue"
    sk: z.string(), // ConnectionID#SubscriptionID
    connectionId: z.string(),
    subscriptionId: z.string(),
    tableName: z.string(),
    fieldName: z.string(),
    fieldValue: z.string(),
    ttl: z.number(),
  }),

  /**
   * ReactiveConnectionQueries - Stores subscription state for diffing
   */
  queries: z.object({
    pk: z.string(), // ConnectionID
    sk: z.string(), // SubscriptionID
    connectionId: z.string(),
    subscriptionId: z.string(),
    queryMetadata: z.object({
      tableName: z.string(),
      indexName: z.string().optional(),
      filterConditions: z.array(z.unknown()),
      sortField: z.string().optional(),
      sortOrder: z.enum(['asc', 'desc']).optional(),
      limit: z.number().optional(),
    }),
    lastResult: z.array(z.unknown()),
    dependencies: z.array(z.string()),
    createdAt: z.number(),
    updatedAt: z.number(),
    ttl: z.number(),
  }),
};

/**
 * System table names
 */
export const SystemTableNames = {
  connections: 'ReactiveConnections',
  dependencies: 'ReactiveDependencies',
  queries: 'ReactiveConnectionQueries',
} as const;
