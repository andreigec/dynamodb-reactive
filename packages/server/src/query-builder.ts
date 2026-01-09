import type { FieldRef } from '@dynamodb-reactive/core';

import type {
  AnyDynamoTable,
  FilterBuilder,
  FilterCondition,
  QueryBuilder,
  TableItem,
  TableKeyInput,
  TrackedQueryOperation,
} from './types.js';

/**
 * Creates a filter condition
 */
function createCondition(
  type: FilterCondition['type'],
  operator: string,
  field?: string,
  value?: unknown,
  value2?: unknown,
): FilterCondition {
  return { type, operator, field, value, value2 };
}

/**
 * Implementation of FilterBuilder
 */
class FilterBuilderImpl<
  TTable extends AnyDynamoTable,
> implements FilterBuilder<TTable> {
  eq<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    value: TableItem<TTable>[K],
  ): FilterCondition {
    return createCondition('comparison', '=', field.fieldName, value);
  }

  ne<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    value: TableItem<TTable>[K],
  ): FilterCondition {
    return createCondition('comparison', '<>', field.fieldName, value);
  }

  gt<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    value: TableItem<TTable>[K],
  ): FilterCondition {
    return createCondition('comparison', '>', field.fieldName, value);
  }

  gte<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    value: TableItem<TTable>[K],
  ): FilterCondition {
    return createCondition('comparison', '>=', field.fieldName, value);
  }

  lt<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    value: TableItem<TTable>[K],
  ): FilterCondition {
    return createCondition('comparison', '<', field.fieldName, value);
  }

  lte<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    value: TableItem<TTable>[K],
  ): FilterCondition {
    return createCondition('comparison', '<=', field.fieldName, value);
  }

  between<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, TableItem<TTable>[K]>,
    lower: TableItem<TTable>[K],
    upper: TableItem<TTable>[K],
  ): FilterCondition {
    return createCondition(
      'function',
      'BETWEEN',
      field.fieldName,
      lower,
      upper,
    );
  }

  beginsWith<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, string>,
    prefix: string,
  ): FilterCondition {
    return createCondition('function', 'begins_with', field.fieldName, prefix);
  }

  contains<K extends keyof TableItem<TTable>>(
    field: FieldRef<K & string, string>,
    substring: string,
  ): FilterCondition {
    return createCondition('function', 'contains', field.fieldName, substring);
  }

  and(...conditions: FilterCondition[]): FilterCondition {
    return { type: 'logical', operator: 'AND', conditions };
  }

  or(...conditions: FilterCondition[]): FilterCondition {
    return { type: 'logical', operator: 'OR', conditions };
  }

  not(condition: FilterCondition): FilterCondition {
    return { type: 'logical', operator: 'NOT', conditions: [condition] };
  }
}

/**
 * Query execution function type
 */
type QueryExecutor<TTable extends AnyDynamoTable> = (
  operation: TrackedQueryOperation,
  options: QueryOptions,
) => Promise<TableItem<TTable>[]>;

/**
 * Query options
 */
interface QueryOptions {
  limit?: number;
  startKey?: Record<string, unknown>;
  ascending: boolean;
}

/**
 * Implementation of QueryBuilder
 */
export class QueryBuilderImpl<
  TTable extends AnyDynamoTable,
> implements QueryBuilder<TTable> {
  private table: TTable;
  private filters: FilterCondition[] = [];
  private indexName?: string;
  private limit?: number;
  private startKey?: TableKeyInput<TTable>;
  private ascending: boolean = true;
  private executor: QueryExecutor<TTable>;
  private operationTracker?: (op: TrackedQueryOperation) => void;

  constructor(
    table: TTable,
    executor: QueryExecutor<TTable>,
    operationTracker?: (op: TrackedQueryOperation) => void,
  ) {
    this.table = table;
    this.executor = executor;
    this.operationTracker = operationTracker;
  }

  filter(
    fn: (q: FilterBuilder<TTable>) => FilterCondition,
  ): QueryBuilder<TTable> {
    const builder = new FilterBuilderImpl<TTable>();
    const condition = fn(builder);
    this.filters.push(condition);
    return this;
  }

  useIndex(indexName: string): QueryBuilder<TTable> {
    this.indexName = indexName;
    return this;
  }

  take(limit: number): QueryBuilder<TTable> {
    this.limit = limit;
    return this;
  }

  startFrom(key: TableKeyInput<TTable>): QueryBuilder<TTable> {
    this.startKey = key;
    return this;
  }

  sortAscending(): QueryBuilder<TTable> {
    this.ascending = true;
    return this;
  }

  sortDescending(): QueryBuilder<TTable> {
    this.ascending = false;
    return this;
  }

  async execute(): Promise<TableItem<TTable>[]> {
    const operation: TrackedQueryOperation = {
      tableName: this.table.tableName,
      filters: this.filters,
      indexName: this.indexName,
      pkField: this.table.pk,
      skField: this.table.sk,
      sortField: this.table.sk, // Default sort by SK if available
      sortOrder: this.ascending ? 'asc' : 'desc',
      limit: this.limit,
    };

    // Track the operation for dependency extraction
    if (this.operationTracker) {
      this.operationTracker(operation);
    }

    const options: QueryOptions = {
      limit: this.limit,
      startKey: this.startKey as Record<string, unknown>,
      ascending: this.ascending,
    };

    return this.executor(operation, options);
  }

  /**
   * Get the current operation without executing
   * Used for dependency extraction
   */
  getOperation(): TrackedQueryOperation {
    return {
      tableName: this.table.tableName,
      filters: this.filters,
      indexName: this.indexName,
      pkField: this.table.pk,
      skField: this.table.sk,
      sortField: this.table.sk,
      sortOrder: this.ascending ? 'asc' : 'desc',
      limit: this.limit,
    };
  }
}

/**
 * Create a filter builder instance
 */
export function createFilterBuilder<
  TTable extends AnyDynamoTable,
>(): FilterBuilder<TTable> {
  return new FilterBuilderImpl<TTable>();
}
