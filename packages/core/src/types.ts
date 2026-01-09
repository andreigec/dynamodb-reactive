import type { z } from 'zod';

/**
 * GSI (Global Secondary Index) definition
 */
export interface IndexDefinition {
  name: string;
  pk: string;
  sk?: string;
}

/**
 * Base interface for any DynamoTable - used for generic constraints
 * Defines the minimal shape that all DynamoTable instances satisfy
 */
export interface AnyDynamoTable {
  readonly tableName: string;
  readonly schema: z.ZodTypeAny;
  readonly pk: string;
  readonly sk: string | undefined;
  readonly indexes: Record<string, IndexDefinition>;
  readonly field: Record<string, { fieldName: string; _type: unknown }>;
  validate(item: unknown): unknown;
  safeParse(item: unknown): z.SafeParseReturnType<unknown, unknown>;
  getPk(item: unknown): unknown;
  getSk(item: unknown): unknown;
  getFieldNames(): string[];
  hasField(fieldName: string): boolean;
}

/**
 * Configuration for DynamoTable
 */
export interface DynamoTableConfig<
  TSchema extends z.ZodObject<z.ZodRawShape>,
  TPk extends keyof z.infer<TSchema>,
  TSk extends keyof z.infer<TSchema> | undefined = undefined,
  TIndexes extends Record<string, IndexDefinition> = Record<
    string,
    IndexDefinition
  >,
> {
  tableName: string;
  schema: TSchema;
  pk: TPk;
  sk?: TSk;
  indexes?: TIndexes;
}

/**
 * Field reference for building queries
 */
export interface FieldRef<TName extends string, TType> {
  fieldName: TName;
  _type: TType;
}

/**
 * Subscription message types for WebSocket communication
 */
export interface SubscriptionMessage {
  type: 'subscribe' | 'unsubscribe' | 'patch' | 'snapshot' | 'error';
  subscriptionId: string;
  path?: string;
  input?: unknown;
  data?: unknown;
  patches?: JsonPatch[];
}

/**
 * JSON Patch operation (RFC 6902)
 */
export interface JsonPatch {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

/**
 * Dependency entry for the inverted index
 */
export interface DependencyEntry {
  pk: string; // Format: "TableName#FieldName#FieldValue"
  sk: string; // ConnectionID#SubscriptionID
  connectionId: string;
  subscriptionId: string;
  tableName: string;
  fieldName: string;
  fieldValue: string;
  ttl: number;
}

/**
 * Connection entry for tracking WebSocket connections
 */
export interface ConnectionEntry {
  connectionId: string;
  context?: Record<string, unknown>;
  connectedAt: number;
  ttl: number;
}

/**
 * Filter condition for query subscriptions (serializable)
 * Used to evaluate whether a record matches the subscription's query
 */
export interface FilterCondition {
  type: 'comparison' | 'logical' | 'function';
  operator: string;
  field?: string;
  value?: unknown;
  value2?: unknown;
  conditions?: FilterCondition[];
}

/**
 * Query metadata for subscription state (serializable, no router code needed)
 * Contains all information needed to evaluate stream changes
 */
export interface QueryMetadata {
  /** Table name being queried */
  tableName: string;
  /** Index name if using a GSI */
  indexName?: string;
  /** Filter conditions to evaluate against records */
  filterConditions: FilterCondition[];
  /** Field to sort by */
  sortField?: string;
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
  /** Maximum number of results */
  limit?: number;
}

/**
 * Query entry for storing subscription state
 * Stores all metadata needed to evaluate stream changes without router code
 */
export interface QueryEntry {
  pk: string; // ConnectionID
  sk: string; // SubscriptionID
  connectionId: string;
  subscriptionId: string;
  /** Query metadata for evaluating stream changes */
  queryMetadata: QueryMetadata;
  /** Last query result (raw items from DB) */
  lastResult: unknown[];
  /** Dependency keys for the inverted index */
  dependencies: string[];
  createdAt: number;
  updatedAt: number;
  ttl: number;
}
