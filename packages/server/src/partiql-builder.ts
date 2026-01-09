import type { FilterCondition, TrackedQueryOperation } from './types.js';

/**
 * PartiQL statement with parameters
 */
export interface PartiQLStatement {
  statement: string;
  parameters: unknown[];
}

/**
 * Converts a filter condition to PartiQL WHERE clause
 */
function conditionToPartiQL(
  condition: FilterCondition,
  parameters: unknown[],
): string {
  switch (condition.type) {
    case 'comparison': {
      parameters.push(condition.value);
      return `"${condition.field}" ${condition.operator} ?`;
    }

    case 'function': {
      if (condition.operator === 'BETWEEN') {
        parameters.push(condition.value);
        parameters.push(condition.value2);
        return `"${condition.field}" BETWEEN ? AND ?`;
      }

      if (condition.operator === 'begins_with') {
        parameters.push(condition.value);
        return `begins_with("${condition.field}", ?)`;
      }

      if (condition.operator === 'contains') {
        parameters.push(condition.value);
        return `contains("${condition.field}", ?)`;
      }

      throw new Error(`Unknown function operator: ${condition.operator}`);
    }

    case 'logical': {
      if (!condition.conditions || condition.conditions.length === 0) {
        throw new Error(
          'Logical condition requires at least one sub-condition',
        );
      }

      if (condition.operator === 'NOT') {
        const subClause = conditionToPartiQL(
          condition.conditions[0],
          parameters,
        );
        return `NOT (${subClause})`;
      }

      const subClauses = condition.conditions.map((c) =>
        conditionToPartiQL(c, parameters),
      );
      return `(${subClauses.join(` ${condition.operator} `)})`;
    }

    default:
      throw new Error(`Unknown condition type: ${condition.type}`);
  }
}

/**
 * Build a PartiQL SELECT statement from a query operation
 */
export function buildSelectStatement(
  operation: TrackedQueryOperation,
): PartiQLStatement {
  const parameters: unknown[] = [];
  let statement = `SELECT * FROM "${operation.tableName}"`;

  // Add index hint if using a GSI
  if (operation.indexName) {
    statement += `."${operation.indexName}"`;
  }

  // Add WHERE clause if there are filters
  if (operation.filters.length > 0) {
    const whereClauses = operation.filters.map((f) =>
      conditionToPartiQL(f, parameters),
    );
    statement += ` WHERE ${whereClauses.join(' AND ')}`;
  }

  return { statement, parameters };
}

/**
 * Build a PartiQL INSERT statement
 */
export function buildInsertStatement(
  tableName: string,
  item: Record<string, unknown>,
): PartiQLStatement {
  const parameters: unknown[] = [item];
  const statement = `INSERT INTO "${tableName}" VALUE ?`;
  return { statement, parameters };
}

/**
 * Build a PartiQL UPDATE statement
 */
export function buildUpdateStatement(
  tableName: string,
  key: Record<string, unknown>,
  updates: Record<string, unknown>,
): PartiQLStatement {
  const parameters: unknown[] = [];
  const setClauses: string[] = [];

  for (const [field, value] of Object.entries(updates)) {
    // Skip key fields
    if (field in key) continue;
    setClauses.push(`"${field}" = ?`);
    parameters.push(value);
  }

  if (setClauses.length === 0) {
    throw new Error('No fields to update');
  }

  let statement = `UPDATE "${tableName}" SET ${setClauses.join(', ')}`;

  // Add WHERE clause for the key
  const whereClauses = Object.entries(key).map(([field, value]) => {
    parameters.push(value);
    return `"${field}" = ?`;
  });
  statement += ` WHERE ${whereClauses.join(' AND ')}`;

  return { statement, parameters };
}

/**
 * Build a PartiQL DELETE statement
 */
export function buildDeleteStatement(
  tableName: string,
  key: Record<string, unknown>,
): PartiQLStatement {
  const parameters: unknown[] = [];
  const whereClauses = Object.entries(key).map(([field, value]) => {
    parameters.push(value);
    return `"${field}" = ?`;
  });

  const statement = `DELETE FROM "${tableName}" WHERE ${whereClauses.join(' AND ')}`;
  return { statement, parameters };
}

/**
 * Build a PartiQL GET statement (for single item by key)
 */
export function buildGetStatement(
  tableName: string,
  key: Record<string, unknown>,
): PartiQLStatement {
  const parameters: unknown[] = [];
  const whereClauses = Object.entries(key).map(([field, value]) => {
    parameters.push(value);
    return `"${field}" = ?`;
  });

  const statement = `SELECT * FROM "${tableName}" WHERE ${whereClauses.join(' AND ')}`;
  return { statement, parameters };
}
