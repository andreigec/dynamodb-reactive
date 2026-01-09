import {
  type AttributeValue,
  DynamoDBClient,
  ExecuteStatementCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';

import type { DependencyTracker } from './dependency-extractor.js';
import {
  buildSelectStatement,
  type PartiQLStatement,
} from './partiql-builder.js';
import { QueryBuilderImpl } from './query-builder.js';
import type {
  AnyDynamoTable,
  DatabaseContext,
  TableItem,
  TableKeyInput,
  TrackedQueryOperation,
} from './types.js';

/**
 * Configuration for creating a database context
 */
export interface DbContextConfig {
  client?: DynamoDBClient;
  region?: string;
  endpoint?: string;
}

/**
 * Create a DynamoDB Document client
 */
function createDocClient(config: DbContextConfig): DynamoDBDocumentClient {
  const client =
    config.client ??
    new DynamoDBClient({
      region: config.region ?? process.env.AWS_REGION ?? 'us-east-1',
      endpoint: config.endpoint,
    });

  return DynamoDBDocumentClient.from(client, {
    marshallOptions: {
      removeUndefinedValues: true,
      convertEmptyValues: false,
    },
    unmarshallOptions: {
      wrapNumbers: false,
    },
  });
}

/**
 * Convert a JavaScript value to a DynamoDB AttributeValue
 */
function toAttributeValue(value: unknown): AttributeValue {
  if (typeof value === 'string') return { S: value };
  if (typeof value === 'number') return { N: String(value) };
  if (typeof value === 'boolean') return { BOOL: value };
  if (value === null || value === undefined) return { NULL: true };
  if (Array.isArray(value)) {
    return { L: value.map(toAttributeValue) };
  }
  if (typeof value === 'object') {
    const m: Record<string, AttributeValue> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      m[k] = toAttributeValue(v);
    }
    return { M: m };
  }
  return { S: String(value) };
}

/**
 * Execute a PartiQL statement
 */
async function executePartiQL(
  docClient: DynamoDBDocumentClient,
  statement: PartiQLStatement,
): Promise<Record<string, unknown>[]> {
  const command = new ExecuteStatementCommand({
    Statement: statement.statement,
    Parameters: statement.parameters.map(toAttributeValue),
  });

  const response = await docClient.send(command);
  // Unmarshall the DynamoDB AttributeValue format to plain JavaScript objects
  return (response.Items ?? []).map((item) =>
    unmarshall(item as Record<string, AttributeValue>),
  );
}

/**
 * Creates a database context for procedure execution
 */
export function createDbContext(
  config: DbContextConfig,
  dependencyTracker?: DependencyTracker,
): DatabaseContext {
  const docClient = createDocClient(config);

  /**
   * Execute a query operation
   */
  async function executeQuery<TTable extends AnyDynamoTable>(
    operation: TrackedQueryOperation,
    options: {
      limit?: number;
      startKey?: Record<string, unknown>;
      ascending: boolean;
    },
  ): Promise<TableItem<TTable>[]> {
    const statement = buildSelectStatement(operation);

    const items = await executePartiQL(docClient, statement);

    // Apply limit client-side if needed (PartiQL doesn't support LIMIT directly)
    if (options.limit && items.length > options.limit) {
      return items.slice(0, options.limit) as TableItem<TTable>[];
    }

    return items as TableItem<TTable>[];
  }

  return {
    query<TTable extends AnyDynamoTable>(table: TTable) {
      return new QueryBuilderImpl<TTable>(
        table,
        executeQuery,
        dependencyTracker?.track.bind(dependencyTracker),
      );
    },

    async get<TTable extends AnyDynamoTable>(
      table: TTable,
      key: TableKeyInput<TTable>,
    ): Promise<TableItem<TTable> | null> {
      const command = new GetCommand({
        TableName: table.tableName,
        Key: key as Record<string, unknown>,
      });

      const response = await docClient.send(command);
      return (response.Item as TableItem<TTable>) ?? null;
    },

    async put<TTable extends AnyDynamoTable>(
      table: TTable,
      item: TableItem<TTable>,
    ): Promise<void> {
      // Validate the item against the schema
      table.validate(item);

      const command = new PutCommand({
        TableName: table.tableName,
        Item: item as Record<string, unknown>,
      });

      await docClient.send(command);
    },

    async delete<TTable extends AnyDynamoTable>(
      table: TTable,
      key: TableKeyInput<TTable>,
    ): Promise<void> {
      const command = new DeleteCommand({
        TableName: table.tableName,
        Key: key as Record<string, unknown>,
      });

      await docClient.send(command);
    },

    async update<TTable extends AnyDynamoTable>(
      table: TTable,
      key: TableKeyInput<TTable>,
      updates: Partial<TableItem<TTable>>,
    ): Promise<TableItem<TTable>> {
      const updateExpressions: string[] = [];
      const expressionAttributeNames: Record<string, string> = {};
      const expressionAttributeValues: Record<string, unknown> = {};

      let i = 0;
      for (const [field, value] of Object.entries(updates)) {
        if (field in (key as Record<string, unknown>)) continue;

        const nameKey = `#f${i}`;
        const valueKey = `:v${i}`;

        updateExpressions.push(`${nameKey} = ${valueKey}`);
        expressionAttributeNames[nameKey] = field;
        expressionAttributeValues[valueKey] = value;
        i++;
      }

      if (updateExpressions.length === 0) {
        // No updates, just return the current item
        const current = await this.get(table, key);
        if (!current) {
          throw new Error('Item not found');
        }
        return current;
      }

      const command = new UpdateCommand({
        TableName: table.tableName,
        Key: key as Record<string, unknown>,
        UpdateExpression: `SET ${updateExpressions.join(', ')}`,
        ExpressionAttributeNames: expressionAttributeNames,
        ExpressionAttributeValues: expressionAttributeValues,
        ReturnValues: 'ALL_NEW',
      });

      const response = await docClient.send(command);
      return response.Attributes as TableItem<TTable>;
    },
  };
}
