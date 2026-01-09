/**
 * Filter evaluator for evaluating FilterCondition against DynamoDB records.
 * Used by the stream handler to determine if a record matches a subscription's query.
 */

import type { FilterCondition } from '@dynamodb-reactive/core';

/**
 * Evaluate a filter condition against a record.
 * Returns true if the record matches the filter.
 */
export function evaluateFilter(
  filter: FilterCondition,
  record: Record<string, unknown>,
): boolean {
  switch (filter.type) {
    case 'comparison':
      return evaluateComparison(filter, record);
    case 'logical':
      return evaluateLogical(filter, record);
    case 'function':
      return evaluateFunction(filter, record);
    default:
      console.warn(`Unknown filter type: ${filter.type}`);
      return false;
  }
}

/**
 * Evaluate multiple filter conditions (all must match - AND logic).
 */
export function evaluateFilters(
  filters: FilterCondition[],
  record: Record<string, unknown>,
): boolean {
  if (filters.length === 0) return true;
  return filters.every((filter) => evaluateFilter(filter, record));
}

/**
 * Evaluate a comparison filter (eq, ne, gt, gte, lt, lte, between).
 */
function evaluateComparison(
  filter: FilterCondition,
  record: Record<string, unknown>,
): boolean {
  const { operator, field, value, value2 } = filter;
  if (!field || !operator) return false;

  const fieldValue = getFieldValue(record, field);

  switch (operator) {
    case 'eq':
      return fieldValue === value;
    case 'ne':
      return fieldValue !== value;
    case 'gt':
      return compareValues(fieldValue, value) > 0;
    case 'gte':
      return compareValues(fieldValue, value) >= 0;
    case 'lt':
      return compareValues(fieldValue, value) < 0;
    case 'lte':
      return compareValues(fieldValue, value) <= 0;
    case 'between':
      return (
        compareValues(fieldValue, value) >= 0 &&
        compareValues(fieldValue, value2) <= 0
      );
    default:
      console.warn(`Unknown comparison operator: ${operator}`);
      return false;
  }
}

/**
 * Evaluate a logical filter (and, or, not).
 */
function evaluateLogical(
  filter: FilterCondition,
  record: Record<string, unknown>,
): boolean {
  const { operator, conditions } = filter;
  if (!operator || !conditions) return false;

  switch (operator) {
    case 'and':
      return conditions.every((c) => evaluateFilter(c, record));
    case 'or':
      return conditions.some((c) => evaluateFilter(c, record));
    case 'not':
      return conditions.length > 0 && !evaluateFilter(conditions[0], record);
    default:
      console.warn(`Unknown logical operator: ${operator}`);
      return false;
  }
}

/**
 * Evaluate a function filter (beginsWith, contains).
 */
function evaluateFunction(
  filter: FilterCondition,
  record: Record<string, unknown>,
): boolean {
  const { operator, field, value } = filter;
  if (!field || !operator) return false;

  const fieldValue = getFieldValue(record, field);

  switch (operator) {
    case 'beginsWith':
      return (
        typeof fieldValue === 'string' &&
        typeof value === 'string' &&
        fieldValue.startsWith(value)
      );
    case 'contains':
      return (
        typeof fieldValue === 'string' &&
        typeof value === 'string' &&
        fieldValue.includes(value)
      );
    default:
      console.warn(`Unknown function operator: ${operator}`);
      return false;
  }
}

/**
 * Get a field value from a record, supporting nested paths (e.g., "user.name").
 */
function getFieldValue(
  record: Record<string, unknown>,
  field: string,
): unknown {
  const parts = field.split('.');
  let value: unknown = record;

  for (const part of parts) {
    if (value === null || value === undefined) return undefined;
    if (typeof value !== 'object') return undefined;
    value = (value as Record<string, unknown>)[part];
  }

  return value;
}

/**
 * Compare two values for ordering.
 * Returns negative if a < b, positive if a > b, zero if equal.
 */
function compareValues(a: unknown, b: unknown): number {
  // Handle null/undefined
  if (a === null || a === undefined) {
    return b === null || b === undefined ? 0 : -1;
  }
  if (b === null || b === undefined) {
    return 1;
  }

  // Numbers
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  // Strings
  if (typeof a === 'string' && typeof b === 'string') {
    return a.localeCompare(b);
  }

  // Booleans
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return a === b ? 0 : a ? 1 : -1;
  }

  // Fallback: convert to string
  return String(a).localeCompare(String(b));
}

/**
 * Sort records by a field.
 */
export function sortRecords(
  records: Record<string, unknown>[],
  sortField?: string,
  sortOrder: 'asc' | 'desc' = 'asc',
): Record<string, unknown>[] {
  if (!sortField) return records;

  return [...records].sort((a, b) => {
    const aValue = getFieldValue(a, sortField);
    const bValue = getFieldValue(b, sortField);
    const comparison = compareValues(aValue, bValue);
    return sortOrder === 'desc' ? -comparison : comparison;
  });
}

/**
 * Find the primary key value(s) from a record.
 * Used to identify records for update/removal.
 */
export function getRecordKey(
  record: Record<string, unknown>,
  pkField: string,
  skField?: string,
): string {
  const pk = record[pkField];
  const sk = skField ? record[skField] : undefined;
  return sk !== undefined ? `${pk}#${sk}` : String(pk);
}
