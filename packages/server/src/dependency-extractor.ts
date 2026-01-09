import type { QueryMetadata } from '@dynamodb-reactive/core';

import type {
  FilterCondition,
  QueryDependency,
  TrackedQueryOperation,
} from './types.js';

/**
 * Extracts dependencies from a filter condition
 */
function extractFromCondition(
  tableName: string,
  condition: FilterCondition,
  indexName?: string,
): QueryDependency[] {
  const dependencies: QueryDependency[] = [];

  switch (condition.type) {
    case 'comparison': {
      // Only extract equality conditions as dependencies
      // These are the ones we can efficiently track
      if (
        condition.operator === '=' &&
        condition.field &&
        condition.value !== undefined
      ) {
        dependencies.push({
          tableName,
          fieldName: condition.field,
          fieldValue: String(condition.value),
          indexName,
        });
      }
      break;
    }

    case 'function': {
      // For begins_with, we can track the prefix as a dependency
      if (
        condition.operator === 'begins_with' &&
        condition.field &&
        condition.value
      ) {
        dependencies.push({
          tableName,
          fieldName: condition.field,
          fieldValue: `prefix:${String(condition.value)}`,
          indexName,
        });
      }
      break;
    }

    case 'logical': {
      // Recursively extract from logical conditions
      if (condition.conditions) {
        for (const subCondition of condition.conditions) {
          dependencies.push(
            ...extractFromCondition(tableName, subCondition, indexName),
          );
        }
      }
      break;
    }
  }

  return dependencies;
}

/**
 * Extract dependencies from a tracked query operation
 */
export function extractDependencies(
  operation: TrackedQueryOperation,
): QueryDependency[] {
  const dependencies: QueryDependency[] = [];

  for (const filter of operation.filters) {
    dependencies.push(
      ...extractFromCondition(operation.tableName, filter, operation.indexName),
    );
  }

  return dependencies;
}

/**
 * Create a dependency key for the inverted index
 * Format: "TableName#FieldName#FieldValue"
 */
export function createDependencyKey(dependency: QueryDependency): string {
  return `${dependency.tableName}#${dependency.fieldName}#${dependency.fieldValue}`;
}

/**
 * Parse a dependency key back into its components
 */
export function parseDependencyKey(key: string): QueryDependency | null {
  const parts = key.split('#');
  if (parts.length < 3) return null;

  return {
    tableName: parts[0],
    fieldName: parts[1],
    fieldValue: parts.slice(2).join('#'), // Handle values that contain #
  };
}

/**
 * Extract affected dependency keys from a DynamoDB stream record
 * This finds all keys that might be affected by a change
 */
export function extractAffectedKeys(
  tableName: string,
  item: Record<string, unknown>,
): string[] {
  const keys: string[] = [];

  for (const [fieldName, fieldValue] of Object.entries(item)) {
    if (fieldValue !== null && fieldValue !== undefined) {
      // Add exact match key
      keys.push(`${tableName}#${fieldName}#${String(fieldValue)}`);

      // Add prefix keys for string values (for begins_with queries)
      if (typeof fieldValue === 'string') {
        for (let i = 1; i <= fieldValue.length; i++) {
          keys.push(
            `${tableName}#${fieldName}#prefix:${fieldValue.substring(0, i)}`,
          );
        }
      }
    }
  }

  return keys;
}

/**
 * Convert a TrackedQueryOperation to QueryMetadata for storage.
 * Normalizes filter operators for evaluation.
 */
export function operationToQueryMetadata(
  operation: TrackedQueryOperation,
): QueryMetadata {
  // Normalize operators to what the filter evaluator expects
  const normalizeFilters = (filters: FilterCondition[]): FilterCondition[] => {
    return filters.map((f) => normalizeFilter(f));
  };

  const normalizeFilter = (filter: FilterCondition): FilterCondition => {
    if (filter.type === 'comparison') {
      // Normalize operators: '=' -> 'eq', '<>' -> 'ne', etc.
      const operatorMap: Record<string, string> = {
        '=': 'eq',
        '<>': 'ne',
        '>': 'gt',
        '>=': 'gte',
        '<': 'lt',
        '<=': 'lte',
      };
      return {
        ...filter,
        operator: operatorMap[filter.operator ?? ''] ?? filter.operator,
      };
    }
    if (filter.type === 'function') {
      // Normalize function names
      const operatorMap: Record<string, string> = {
        begins_with: 'beginsWith',
        BETWEEN: 'between',
      };
      return {
        ...filter,
        operator: operatorMap[filter.operator ?? ''] ?? filter.operator,
      };
    }
    if (filter.type === 'logical' && filter.conditions) {
      // Normalize operators: 'AND' -> 'and', etc.
      const operatorMap: Record<string, string> = {
        AND: 'and',
        OR: 'or',
        NOT: 'not',
      };
      return {
        ...filter,
        operator: operatorMap[filter.operator ?? ''] ?? filter.operator,
        conditions: normalizeFilters(filter.conditions),
      };
    }
    return filter;
  };

  return {
    tableName: operation.tableName,
    indexName: operation.indexName,
    filterConditions: normalizeFilters(operation.filters),
    sortField: operation.sortField,
    sortOrder: operation.sortOrder,
    limit: operation.limit,
  };
}

/**
 * DependencyTracker - Tracks query operations during procedure execution
 */
export class DependencyTracker {
  private operations: TrackedQueryOperation[] = [];

  /**
   * Track a query operation
   */
  track(operation: TrackedQueryOperation): void {
    this.operations.push(operation);
  }

  /**
   * Get all tracked operations
   */
  getOperations(): TrackedQueryOperation[] {
    return [...this.operations];
  }

  /**
   * Extract all dependencies from tracked operations
   */
  extractAll(): QueryDependency[] {
    const dependencies: QueryDependency[] = [];

    for (const operation of this.operations) {
      dependencies.push(...extractDependencies(operation));
    }

    return dependencies;
  }

  /**
   * Get all dependency keys for the inverted index
   */
  getDependencyKeys(): string[] {
    return this.extractAll().map(createDependencyKey);
  }

  /**
   * Get query metadata for the first tracked operation.
   * Used for storing subscription state.
   */
  getQueryMetadata(): QueryMetadata | null {
    if (this.operations.length === 0) return null;
    // For now, we only support single-query subscriptions
    return operationToQueryMetadata(this.operations[0]);
  }

  /**
   * Get the primary key field from the first operation
   */
  getPkField(): string | null {
    if (this.operations.length === 0) return null;
    return this.operations[0].pkField;
  }

  /**
   * Get the sort key field from the first operation
   */
  getSkField(): string | undefined {
    if (this.operations.length === 0) return undefined;
    return this.operations[0].skField;
  }

  /**
   * Clear tracked operations
   */
  clear(): void {
    this.operations = [];
  }
}
