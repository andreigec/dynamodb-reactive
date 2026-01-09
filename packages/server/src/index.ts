// Main API
export {
  type InferProcedureInput,
  type InferProcedureOutput,
  type InferRouterType,
  initReactive,
  type ReactiveBuilder,
} from './reactive.js';

// Router and Procedure
export {
  executeProcedure,
  isProcedure,
  ProcedureBuilder,
} from './procedure.js';
export { createRouter, mergeRouters, Router } from './router.js';

// Database context
export { createDbContext, type DbContextConfig } from './db-context.js';

// Query building
export { createFilterBuilder, QueryBuilderImpl } from './query-builder.js';

// Dependency extraction
export {
  createDependencyKey,
  DependencyTracker,
  extractAffectedKeys,
  extractDependencies,
  operationToQueryMetadata,
  parseDependencyKey,
} from './dependency-extractor.js';

// PartiQL building
export {
  buildDeleteStatement,
  buildGetStatement,
  buildInsertStatement,
  buildSelectStatement,
  buildUpdateStatement,
  type PartiQLStatement,
} from './partiql-builder.js';

// JSON patching
export {
  applyPatches,
  batchPatches,
  generatePatches,
  hasChanges,
  optimizePatches,
} from './patcher.js';

// Handlers
export {
  type CallRequest,
  createReactiveHandler,
  type ErrorResponse,
  type PatchResponse,
  type ReactiveHandlerConfig,
  type ReactiveRequest,
  type ReactiveResponse,
  type ResultResponse,
  type SnapshotResponse,
  type SubscribeRequest,
  type UnsubscribeRequest,
} from './handlers/reactive-handler.js';
export {
  createConnectHandler,
  createDisconnectHandler,
  createStreamHandler,
  type StreamHandlerConfig,
} from './handlers/stream-handler.js';

// Harness
export {
  createReactiveHarness,
  type ReactiveHarness,
  type ReactiveHarnessConfig,
} from './harness.js';

// Lambda handlers (for use by the generated entry point)
export { createLambdaHandlers } from './handlers/lambda-handlers.js';

// Filter evaluation (for stream processing without router code)
export {
  evaluateFilter,
  evaluateFilters,
  getRecordKey,
  sortRecords,
} from './filter-evaluator.js';

// Type exports
export type {
  AnyDynamoTable,
  AnyProcedureDefinition,
  DatabaseContext,
  FilterBuilder,
  FilterCondition,
  ProcedureContext,
  ProcedureDefinition,
  ProcedureType,
  QueryBuilder,
  QueryDependency,
  RouterDefinition,
  TableItem,
  TableKeyInput,
  TrackedQueryOperation,
} from './types.js';
