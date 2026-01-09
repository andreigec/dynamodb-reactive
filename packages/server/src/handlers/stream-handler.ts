import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import {
  type AttributeValue,
  DynamoDBClient,
  ExecuteStatementCommand,
} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type {
  FilterCondition,
  JsonPatch,
  QueryEntry,
  QueryMetadata,
} from '@dynamodb-reactive/core';
import { SystemTableNames } from '@dynamodb-reactive/core';
import type { DynamoDBRecord, DynamoDBStreamEvent } from 'aws-lambda';

import type { DbContextConfig } from '../db-context.js';
import { extractAffectedKeys } from '../dependency-extractor.js';
import { generatePatches, hasChanges } from '../patcher.js';

/**
 * Configuration for the stream handler.
 * NOTE: Router is no longer required - stream processing uses stored query metadata.
 */
export interface StreamHandlerConfig {
  dbConfig?: DbContextConfig;
  apiGatewayEndpoint: string;
  connectionsTableName?: string;
  dependenciesTableName?: string;
  queriesTableName?: string;
}

/**
 * Create a DynamoDB stream handler for AWS Lambda.
 * Uses stored query metadata to re-execute queries WITHOUT router code.
 */
export function createStreamHandler(config: StreamHandlerConfig) {
  const dependenciesTable =
    config.dependenciesTableName ?? SystemTableNames.dependencies;
  const queriesTable = config.queriesTableName ?? SystemTableNames.queries;

  // Create DynamoDB client
  const ddbClient = new DynamoDBClient({
    region: config.dbConfig?.region ?? process.env.AWS_REGION,
  });
  const docClient = DynamoDBDocumentClient.from(ddbClient);

  // Create API Gateway Management client
  const apiClient = new ApiGatewayManagementApiClient({
    endpoint: config.apiGatewayEndpoint,
  });

  /**
   * Main Lambda handler
   */
  async function handler(event: DynamoDBStreamEvent): Promise<void> {
    const affectedSubscriptions = new Map<string, Set<string>>();

    // Process each record in the stream
    for (const record of event.Records) {
      if (!record.dynamodb) continue;

      const tableName = extractTableName(record);
      if (!tableName) continue;

      // Get the new and old images
      const newImage = record.dynamodb.NewImage
        ? unmarshall(record.dynamodb.NewImage as Record<string, AttributeValue>)
        : null;
      const oldImage = record.dynamodb.OldImage
        ? unmarshall(record.dynamodb.OldImage as Record<string, AttributeValue>)
        : null;

      // Extract affected dependency keys
      const affectedKeys = new Set<string>();
      if (newImage) {
        for (const key of extractAffectedKeys(tableName, newImage)) {
          affectedKeys.add(key);
        }
      }
      if (oldImage) {
        for (const key of extractAffectedKeys(tableName, oldImage)) {
          affectedKeys.add(key);
        }
      }

      // Find subscriptions affected by these keys
      for (const key of affectedKeys) {
        const subscriptions = await findAffectedSubscriptions(key);
        for (const sub of subscriptions) {
          const connId = sub.connectionId;
          const subId = sub.subscriptionId;
          if (!affectedSubscriptions.has(connId)) {
            affectedSubscriptions.set(connId, new Set());
          }
          affectedSubscriptions.get(connId)!.add(subId);
        }
      }
    }

    // Process each affected subscription
    const sendPromises: Promise<void>[] = [];
    for (const [connectionId, subscriptionIds] of affectedSubscriptions) {
      for (const subscriptionId of subscriptionIds) {
        sendPromises.push(processSubscription(connectionId, subscriptionId));
      }
    }

    await Promise.allSettled(sendPromises);
  }

  /**
   * Extract table name from a stream record
   */
  function extractTableName(record: DynamoDBRecord): string | null {
    // The table name is in the eventSourceARN
    const arn = record.eventSourceARN;
    if (!arn) return null;

    // ARN format: arn:aws:dynamodb:region:account:table/table-name/stream/...
    const match = arn.match(/table\/([^/]+)/);
    return match ? match[1] : null;
  }

  /**
   * Find subscriptions affected by a dependency key
   */
  async function findAffectedSubscriptions(
    dependencyKey: string,
  ): Promise<{ connectionId: string; subscriptionId: string }[]> {
    try {
      const response = await docClient.send(
        new QueryCommand({
          TableName: dependenciesTable,
          KeyConditionExpression: 'pk = :pk',
          ExpressionAttributeValues: {
            ':pk': dependencyKey,
          },
        }),
      );

      return (response.Items ?? []).map((item) => ({
        connectionId: item.connectionId as string,
        subscriptionId: item.subscriptionId as string,
      }));
    } catch (error) {
      console.error('Error finding affected subscriptions:', error);
      return [];
    }
  }

  /**
   * Process a single subscription: re-execute query using metadata, diff, and send patch
   */
  async function processSubscription(
    connectionId: string,
    subscriptionId: string,
  ): Promise<void> {
    try {
      // Get the subscription state
      const queryState = await getQueryState(connectionId, subscriptionId);
      if (!queryState) {
        console.warn(
          `Subscription not found: ${connectionId}/${subscriptionId}`,
        );
        return;
      }

      // Re-execute the query using stored metadata
      const newResult = await executeQueryFromMetadata(
        queryState.queryMetadata,
      );

      // Check if there are changes
      if (!hasChanges(queryState.lastResult, newResult)) {
        return;
      }

      // Generate patches
      const patches = generatePatches(queryState.lastResult, newResult);

      // Update the stored state
      await updateQueryState(connectionId, subscriptionId, newResult);

      // Send the patch to the client
      await sendPatch(connectionId, subscriptionId, patches);
    } catch (error) {
      if (error instanceof GoneException) {
        // Connection is gone, clean up
        await cleanupConnection(connectionId);
      } else {
        console.error(
          `Error processing subscription ${connectionId}/${subscriptionId}:`,
          error,
        );
      }
    }
  }

  /**
   * Get the stored query state
   */
  async function getQueryState(
    connectionId: string,
    subscriptionId: string,
  ): Promise<QueryEntry | null> {
    try {
      const response = await docClient.send(
        new GetCommand({
          TableName: queriesTable,
          Key: {
            pk: connectionId,
            sk: subscriptionId,
          },
        }),
      );

      return (response.Item as QueryEntry) ?? null;
    } catch (error) {
      console.error('Error getting query state:', error);
      return null;
    }
  }

  /**
   * Execute a query using stored QueryMetadata.
   * Uses PartiQL to query DynamoDB directly without router code.
   */
  async function executeQueryFromMetadata(
    metadata: QueryMetadata,
  ): Promise<unknown[]> {
    const { tableName, filterConditions, sortOrder, limit } = metadata;

    // Build WHERE clause from filter conditions
    const whereClause = buildWhereClause(filterConditions);
    const orderClause = sortOrder === 'desc' ? 'ORDER BY SK DESC' : '';
    const limitClause = limit ? `LIMIT ${limit}` : '';

    const statement =
      `SELECT * FROM "${tableName}" ${whereClause} ${orderClause} ${limitClause}`.trim();

    try {
      const result = await ddbClient.send(
        new ExecuteStatementCommand({
          Statement: statement,
        }),
      );

      return (result.Items ?? []).map((item) =>
        unmarshall(item as Record<string, AttributeValue>),
      );
    } catch (error) {
      console.error('Error executing query from metadata:', error);
      console.error('Statement:', statement);
      return [];
    }
  }

  /**
   * Build WHERE clause from filter conditions.
   */
  function buildWhereClause(conditions: FilterCondition[]): string {
    if (conditions.length === 0) return '';

    const clauses = conditions
      .map((c) => buildConditionClause(c))
      .filter(Boolean);
    if (clauses.length === 0) return '';

    return `WHERE ${clauses.join(' AND ')}`;
  }

  /**
   * Build a single condition clause for PartiQL.
   */
  function buildConditionClause(condition: FilterCondition): string {
    const { type, operator, field, value, value2, conditions } = condition;

    if (type === 'comparison' && field) {
      const escapedValue = escapeValue(value);
      switch (operator) {
        case 'eq':
          return `"${field}" = ${escapedValue}`;
        case 'ne':
          return `"${field}" <> ${escapedValue}`;
        case 'gt':
          return `"${field}" > ${escapedValue}`;
        case 'gte':
          return `"${field}" >= ${escapedValue}`;
        case 'lt':
          return `"${field}" < ${escapedValue}`;
        case 'lte':
          return `"${field}" <= ${escapedValue}`;
        case 'between':
          return `"${field}" BETWEEN ${escapedValue} AND ${escapeValue(value2)}`;
        default:
          return '';
      }
    }

    if (type === 'function' && field) {
      const escapedValue = escapeValue(value);
      switch (operator) {
        case 'beginsWith':
          return `begins_with("${field}", ${escapedValue})`;
        case 'contains':
          return `contains("${field}", ${escapedValue})`;
        default:
          return '';
      }
    }

    if (type === 'logical' && conditions) {
      const subclauses = conditions
        .map((c) => buildConditionClause(c))
        .filter(Boolean);
      if (subclauses.length === 0) return '';

      switch (operator) {
        case 'and':
          return `(${subclauses.join(' AND ')})`;
        case 'or':
          return `(${subclauses.join(' OR ')})`;
        case 'not':
          return subclauses.length > 0 ? `NOT (${subclauses[0]})` : '';
        default:
          return '';
      }
    }

    return '';
  }

  /**
   * Escape a value for PartiQL.
   */
  function escapeValue(value: unknown): string {
    if (value === null || value === undefined) return 'NULL';
    if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    return `'${String(value).replace(/'/g, "''")}'`;
  }

  /**
   * Update the stored query state
   */
  async function updateQueryState(
    connectionId: string,
    subscriptionId: string,
    newResult: unknown[],
  ): Promise<void> {
    try {
      const existing = await getQueryState(connectionId, subscriptionId);
      if (!existing) return;

      await docClient.send(
        new GetCommand({
          TableName: queriesTable,
          Key: { pk: connectionId, sk: subscriptionId },
        }),
      );

      // Update with new result
      const { PutCommand } = await import('@aws-sdk/lib-dynamodb');
      await docClient.send(
        new PutCommand({
          TableName: queriesTable,
          Item: {
            ...existing,
            lastResult: newResult,
            updatedAt: Date.now(),
          },
        }),
      );
    } catch (error) {
      console.error('Error updating query state:', error);
    }
  }

  /**
   * Send a patch to the client via WebSocket
   */
  async function sendPatch(
    connectionId: string,
    subscriptionId: string,
    patches: JsonPatch[],
  ): Promise<void> {
    const message = JSON.stringify({
      type: 'patch',
      subscriptionId,
      patches,
    });

    try {
      await apiClient.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(message),
        }),
      );
    } catch (error) {
      if (error instanceof GoneException) {
        throw error; // Propagate to trigger cleanup
      }
      console.error(`Error sending patch to ${connectionId}:`, error);
    }
  }

  /**
   * Clean up a disconnected connection
   */
  async function cleanupConnection(connectionId: string): Promise<void> {
    console.log('Cleaning up disconnected connection:', connectionId);

    // TODO: Full cleanup implementation
    // 1. Delete from ReactiveConnections
    // 2. Delete all queries for this connection from ReactiveConnectionQueries
    // 3. Delete all dependencies for this connection from ReactiveDependencies
  }

  return { handler };
}

/**
 * WebSocket connection handler for $connect
 */
export function createConnectHandler(
  config: Pick<StreamHandlerConfig, 'dbConfig' | 'connectionsTableName'>,
) {
  const connectionsTable =
    config.connectionsTableName ?? SystemTableNames.connections;
  const ddbClient = new DynamoDBClient({
    region: config.dbConfig?.region ?? process.env.AWS_REGION,
  });
  const docClient = DynamoDBDocumentClient.from(ddbClient);

  return async function handler(event: {
    requestContext: {
      connectionId: string;
      authorizer?: Record<string, unknown>;
    };
  }): Promise<{ statusCode: number }> {
    const connectionId = event.requestContext.connectionId;

    try {
      await docClient.send(
        new QueryCommand({
          TableName: connectionsTable,
          KeyConditionExpression: 'connectionId = :cid',
          ExpressionAttributeValues: {
            ':cid': connectionId,
          },
        }),
      );

      console.log('Connection established:', connectionId);
      return { statusCode: 200 };
    } catch (error) {
      console.error('Error creating connection:', error);
      return { statusCode: 500 };
    }
  };
}

/**
 * WebSocket disconnection handler for $disconnect
 */
export function createDisconnectHandler(
  config: Pick<
    StreamHandlerConfig,
    | 'dbConfig'
    | 'connectionsTableName'
    | 'queriesTableName'
    | 'dependenciesTableName'
  >,
) {
  const connectionsTable =
    config.connectionsTableName ?? SystemTableNames.connections;
  const ddbClient = new DynamoDBClient({
    region: config.dbConfig?.region ?? process.env.AWS_REGION,
  });
  const docClient = DynamoDBDocumentClient.from(ddbClient);

  return async function handler(event: {
    requestContext: { connectionId: string };
  }): Promise<{ statusCode: number }> {
    const connectionId = event.requestContext.connectionId;

    try {
      await docClient.send(
        new DeleteCommand({
          TableName: connectionsTable,
          Key: { connectionId },
        }),
      );

      console.log('Connection removed:', connectionId);
      return { statusCode: 200 };
    } catch (error) {
      console.error('Error removing connection:', error);
      return { statusCode: 500 };
    }
  };
}
