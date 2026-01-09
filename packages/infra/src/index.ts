// Main construct
export { ReactiveEngine, type ReactiveEngineProps } from './engine.js';

// System tables
export {
  ReactiveSystemTables,
  type ReactiveSystemTablesProps,
} from './tables.js';

// Stream source helpers
export {
  createStreamFilter,
  DynamoDBStreamSource,
  type DynamoDBStreamSourceProps,
} from './stream-source.js';

// Entry point generator (used internally by ReactiveEngine)
export { generateEntryPointCode } from './handlers/lambda-handlers.js';
