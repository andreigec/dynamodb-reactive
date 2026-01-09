import type {
  AnyDynamoTable,
  DynamoTable,
  FieldRef,
  FilterCondition,
} from '@dynamodb-reactive/core';
import type { z } from 'zod';

// Re-export types from core for convenience
export type { AnyDynamoTable, FilterCondition };

/**
 * Context type for procedures
 */
export interface ProcedureContext<TContext = unknown> {
  ctx: TContext & { db: DatabaseContext };
  input: unknown;
}

/**
 * Database context provided to procedures
 */
export interface DatabaseContext {
  query<TTable extends AnyDynamoTable>(table: TTable): QueryBuilder<TTable>;

  get<TTable extends AnyDynamoTable>(
    table: TTable,
    key: TableKeyInput<TTable>,
  ): Promise<TableItem<TTable> | null>;

  put<TTable extends AnyDynamoTable>(
    table: TTable,
    item: TableItem<TTable>,
  ): Promise<void>;

  delete<TTable extends AnyDynamoTable>(
    table: TTable,
    key: TableKeyInput<TTable>,
  ): Promise<void>;

  update<TTable extends AnyDynamoTable>(
    table: TTable,
    key: TableKeyInput<TTable>,
    updates: Partial<TableItem<TTable>>,
  ): Promise<TableItem<TTable>>;
}

/**
 * Extract the item type from a DynamoTable
 * Works with both the DynamoTable class and AnyDynamoTable interface
 */
export type TableItem<T extends AnyDynamoTable> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends DynamoTable<infer TSchema, any, any, any>
    ? z.infer<TSchema>
    : T extends { schema: infer TSchema extends z.ZodTypeAny }
      ? z.infer<TSchema>
      : never;

/**
 * Extract key input type from a DynamoTable
 * Works with both the DynamoTable class and AnyDynamoTable interface
 */
export type TableKeyInput<T extends AnyDynamoTable> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends DynamoTable<infer TSchema, infer TPk, infer TSk, any>
    ? TSk extends keyof z.infer<TSchema>
      ? Pick<z.infer<TSchema>, TPk | TSk>
      : Pick<z.infer<TSchema>, TPk>
    : T extends {
          schema: infer TSchema extends z.ZodTypeAny;
          pk: infer TPk;
          sk: infer TSk;
        }
      ? TSk extends keyof z.infer<TSchema>
        ? Pick<z.infer<TSchema>, (TPk & keyof z.infer<TSchema>) | TSk>
        : Pick<z.infer<TSchema>, TPk & keyof z.infer<TSchema>>
      : never;

/**
 * Query builder for type-safe DynamoDB queries
 */
export interface QueryBuilder<TTable extends AnyDynamoTable> {
  filter(
    fn: (q: FilterBuilder<TTable>) => FilterCondition,
  ): QueryBuilder<TTable>;
  useIndex(indexName: keyof TableIndexes<TTable>): QueryBuilder<TTable>;
  take(limit: number): QueryBuilder<TTable>;
  startFrom(key: TableKeyInput<TTable>): QueryBuilder<TTable>;
  sortAscending(): QueryBuilder<TTable>;
  sortDescending(): QueryBuilder<TTable>;
  execute(): Promise<TableItem<TTable>[]>;
}

/**
 * Filter builder for query conditions
 */
export interface FilterBuilder<TTable extends AnyDynamoTable> {
  eq<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    value: TableItem<TTable>[K],
  ): FilterCondition;

  ne<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    value: TableItem<TTable>[K],
  ): FilterCondition;

  gt<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    value: TableItem<TTable>[K],
  ): FilterCondition;

  gte<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    value: TableItem<TTable>[K],
  ): FilterCondition;

  lt<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    value: TableItem<TTable>[K],
  ): FilterCondition;

  lte<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    value: TableItem<TTable>[K],
  ): FilterCondition;

  between<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    lower: TableItem<TTable>[K],
    upper: TableItem<TTable>[K],
  ): FilterCondition;

  beginsWith<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, string>,
    prefix: string,
  ): FilterCondition;

  contains<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, string>,
    substring: string,
  ): FilterCondition;

  and(...conditions: FilterCondition[]): FilterCondition;
  or(...conditions: FilterCondition[]): FilterCondition;
  not(condition: FilterCondition): FilterCondition;
}

/**
 * Extract indexes from a DynamoTable
 */
type TableIndexes<T extends AnyDynamoTable> =
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  T extends DynamoTable<any, any, any, infer TIndexes>
    ? TIndexes
    : T extends { indexes: infer TIndexes }
      ? TIndexes
      : never;

/**
 * Procedure types
 */
export type ProcedureType = 'query' | 'mutation';

/**
 * Procedure definition
 */
export interface ProcedureDefinition<
  TContext,
  TInput extends z.ZodTypeAny = z.ZodUndefined,
  TOutput = unknown,
> {
  type: ProcedureType;
  inputSchema?: TInput;
  resolver: (opts: {
    ctx: TContext & { db: DatabaseContext };
    input: z.infer<TInput>;
  }) => Promise<TOutput> | TOutput;
}

/**
 * Any procedure definition - used for generic constraints
 * Uses 'any' for input/output to allow covariant assignment
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyProcedureDefinition<TContext> = ProcedureDefinition<
  TContext,
  any,
  any
>;

/**
 * Router definition
 */
export type RouterDefinition<TContext> = {
  [key: string]: AnyProcedureDefinition<TContext> | RouterDefinition<TContext>;
};

/**
 * Dependency information extracted from a query
 */
export interface QueryDependency {
  tableName: string;
  fieldName: string;
  fieldValue: string;
  indexName?: string;
}

/**
 * Tracked query operation (for dependency extraction and stream processing)
 */
export interface TrackedQueryOperation {
  tableName: string;
  filters: FilterCondition[];
  indexName?: string;
  /** Primary key field name for the table */
  pkField: string;
  /** Sort key field name for the table (if any) */
  skField?: string;
  /** Sort field for ordering results */
  sortField?: string;
  /** Sort direction */
  sortOrder?: 'asc' | 'desc';
  /** Maximum number of results */
  limit?: number;
}
