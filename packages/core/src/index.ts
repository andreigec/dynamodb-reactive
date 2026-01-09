// Main exports
export { defineSchema, SystemSchemas, SystemTableNames } from './schema.js';
export { DynamoTable } from './table.js';

// Type exports from types.ts
export type {
  AnyDynamoTable,
  ConnectionEntry,
  DependencyEntry,
  DynamoTableConfig,
  FieldRef,
  FilterCondition,
  IndexDefinition,
  JsonPatch,
  QueryEntry,
  QueryMetadata,
  SubscriptionMessage,
} from './types.js';

// Type exports from table.ts (DynamoTable helper types)
export type {
  InferSchema,
  TableFields,
  TableIndexes,
  TablePk,
  TableSk,
} from './table.js';
