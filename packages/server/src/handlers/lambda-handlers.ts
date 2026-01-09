/**
 * Lambda handler implementations for the reactive WebSocket system.
 *
 * These handlers process WebSocket events and DynamoDB stream events
 * WITHOUT requiring user router code at runtime.
 *
 * Stream processing uses stored query metadata to evaluate changes
 * directly, rather than re-executing queries through a router.
 */

import {
  ApiGatewayManagementApiClient,
  GoneException,
  PostToConnectionCommand,
} from '@aws-sdk/client-apigatewaymanagementapi';
import { type AttributeValue, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type {
  ConnectionEntry,
  JsonPatch,
  QueryEntry,
  QueryMetadata,
} from '@dynamodb-reactive/core';
import { SystemTableNames } from '@dynamodb-reactive/core';
import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  DynamoDBRecord,
  DynamoDBStreamEvent,
} from 'aws-lambda';

import { extractAffectedKeys } from '../dependency-extractor.js';
import { generatePatches, hasChanges } from '../patcher.js';

/**
 * Create all Lambda handlers.
 * No user code required - all configuration comes from environment variables.
 * The stream handler uses stored query metadata (PartiQL), not router code.
 */
export function createLambdaHandlers() {
  // Get table names from environment
  const connectionsTable =
    process.env.CONNECTIONS_TABLE ?? SystemTableNames.connections;
  const dependenciesTable =
    process.env.DEPENDENCIES_TABLE ?? SystemTableNames.dependencies;
  const queriesTable = process.env.QUERIES_TABLE ?? SystemTableNames.queries;
  const wsEndpoint = process.env.WEBSOCKET_ENDPOINT ?? '';

  // Create DynamoDB client
  const ddbClient = new DynamoDBClient({
    region: process.env.AWS_REGION,
  });
  const docClient = DynamoDBDocumentClient.from(ddbClient);

  // Create API Gateway Management client (lazy to avoid endpoint issues during init)
  const getApiClient = () =>
    new ApiGatewayManagementApiClient({
      endpoint: wsEndpoint,
    });

  /**
   * $connect handler - Register new WebSocket connections
   */
  async function connectHandler(
    event: APIGatewayProxyEvent,
  ): Promise<APIGatewayProxyResult> {
    const connectionId = event.requestContext.connectionId!;
    const now = Date.now();
    const ttl = Math.floor(now / 1000) + 3600; // 1 hour TTL

    try {
      const connectionEntry: ConnectionEntry = {
        connectionId,
        context: event.requestContext.authorizer as
          | Record<string, unknown>
          | undefined,
        connectedAt: now,
        ttl,
      };

      await docClient.send(
        new PutCommand({
          TableName: connectionsTable,
          Item: connectionEntry,
        }),
      );

      console.log('Connection established:', connectionId);
      return { statusCode: 200, body: 'Connected' };
    } catch (error) {
      console.error('Error creating connection:', error);
      return { statusCode: 500, body: 'Failed to connect' };
    }
  }

  /**
   * $disconnect handler - Clean up disconnected connections
   */
  async function disconnectHandler(
    event: APIGatewayProxyEvent,
  ): Promise<APIGatewayProxyResult> {
    const connectionId = event.requestContext.connectionId!;

    try {
      // Delete the connection entry
      await docClient.send(
        new DeleteCommand({
          TableName: connectionsTable,
          Key: { connectionId },
        }),
      );

      // TODO: Clean up queries and dependencies for this connection

      console.log('Connection removed:', connectionId);
      return { statusCode: 200, body: 'Disconnected' };
    } catch (error) {
      console.error('Error removing connection:', error);
      return { statusCode: 500, body: 'Failed to disconnect' };
    }
  }

  /**
   * $default handler - Handle WebSocket messages
   * NOTE: Subscribe still requires calling the router for initial data.
   * This is handled by the app's API route, not this Lambda.
   */
  async function messageHandler(
    event: APIGatewayProxyEvent,
  ): Promise<APIGatewayProxyResult> {
    const connectionId = event.requestContext.connectionId!;

    try {
      const body = JSON.parse(event.body ?? '{}');
      const { type, subscriptionId } = body;

      let response: unknown;

      switch (type) {
        case 'unsubscribe': {
          // Get the subscription to find its dependencies
          const subResponse = await docClient.send(
            new GetCommand({
              TableName: queriesTable,
              Key: { pk: connectionId, sk: subscriptionId },
            }),
          );

          if (subResponse.Item) {
            const queryEntry = subResponse.Item as QueryEntry;

            // Delete dependency entries
            for (const key of queryEntry.dependencies ?? []) {
              await docClient.send(
                new DeleteCommand({
                  TableName: dependenciesTable,
                  Key: { pk: key, sk: `${connectionId}#${subscriptionId}` },
                }),
              );
            }
          }

          // Delete the subscription
          await docClient.send(
            new DeleteCommand({
              TableName: queriesTable,
              Key: { pk: connectionId, sk: subscriptionId },
            }),
          );

          response = { type: 'result', data: { success: true } };
          break;
        }

        default:
          // Subscribe and call are handled by the app's API route
          // which has access to the router
          response = {
            type: 'error',
            message: `Message type '${type}' should be handled by the app API route`,
          };
      }

      // Send response back through WebSocket
      const apiClient = getApiClient();
      await apiClient.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(JSON.stringify(response)),
        }),
      );

      return { statusCode: 200, body: 'OK' };
    } catch (error) {
      console.error('Error handling message:', error);
      return { statusCode: 500, body: 'Internal server error' };
    }
  }

  /**
   * DynamoDB Stream handler - Process changes and push updates.
   * Uses stored query metadata to evaluate changes WITHOUT router code.
   */
  async function streamHandler(event: DynamoDBStreamEvent): Promise<void> {
    const affectedSubscriptions = new Map<
      string,
      Map<
        string,
        {
          oldImage: Record<string, unknown> | null;
          newImage: Record<string, unknown> | null;
        }
      >
    >();

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
            affectedSubscriptions.set(connId, new Map());
          }
          const connSubs = affectedSubscriptions.get(connId)!;

          // Store the record change for this subscription
          // If already tracked, merge (for batch updates to same record)
          if (!connSubs.has(subId)) {
            connSubs.set(subId, { oldImage, newImage });
          }
        }
      }
    }

    // Process each affected subscription
    const sendPromises: Promise<void>[] = [];
    for (const [connectionId, subscriptions] of affectedSubscriptions) {
      for (const [subscriptionId] of subscriptions) {
        sendPromises.push(processSubscription(connectionId, subscriptionId));
      }
    }

    await Promise.allSettled(sendPromises);
  }

  /**
   * Extract table name from a stream record
   */
  function extractTableName(record: DynamoDBRecord): string | null {
    const arn = record.eventSourceARN;
    if (!arn) return null;
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
   * Process a single subscription by re-querying and diffing.
   * For now, we still re-query because applying changes directly is complex.
   * But we don't need router code - we use stored PartiQL or query metadata.
   */
  async function processSubscription(
    connectionId: string,
    subscriptionId: string,
  ): Promise<void> {
    try {
      // Get the subscription state
      const response = await docClient.send(
        new GetCommand({
          TableName: queriesTable,
          Key: { pk: connectionId, sk: subscriptionId },
        }),
      );

      const queryState = response.Item as QueryEntry | undefined;
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
      await docClient.send(
        new PutCommand({
          TableName: queriesTable,
          Item: {
            ...queryState,
            lastResult: newResult,
            updatedAt: Date.now(),
          },
        }),
      );

      // Send the patch to the client
      await sendPatch(connectionId, subscriptionId, patches);
    } catch (error) {
      if (error instanceof GoneException) {
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
   * Execute a query using stored QueryMetadata.
   * Uses PartiQL to query DynamoDB directly without router code.
   */
  async function executeQueryFromMetadata(
    metadata: QueryMetadata,
  ): Promise<unknown[]> {
    // Build PartiQL query from metadata
    const { tableName, filterConditions, sortOrder, limit } = metadata;

    // Build WHERE clause from filter conditions
    const whereClause = buildWhereClause(filterConditions);
    const orderClause = sortOrder === 'desc' ? 'ORDER BY SK DESC' : '';
    const limitClause = limit ? `LIMIT ${limit}` : '';

    const statement =
      `SELECT * FROM "${tableName}" ${whereClause} ${orderClause} ${limitClause}`.trim();

    try {
      // Use PartiQL to execute the query
      const { ExecuteStatementCommand } =
        await import('@aws-sdk/client-dynamodb');
      const result = await ddbClient.send(
        new ExecuteStatementCommand({
          Statement: statement,
        }),
      );

      // Unmarshall results
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
  function buildWhereClause(
    conditions: QueryMetadata['filterConditions'],
  ): string {
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
  function buildConditionClause(
    condition: QueryMetadata['filterConditions'][0],
  ): string {
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
        case undefined:
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
        case undefined:
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
        case undefined:
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
      const apiClient = getApiClient();
      await apiClient.send(
        new PostToConnectionCommand({
          ConnectionId: connectionId,
          Data: Buffer.from(message),
        }),
      );
    } catch (error) {
      if (error instanceof GoneException) {
        throw error;
      }
      console.error(`Error sending patch to ${connectionId}:`, error);
    }
  }

  /**
   * Clean up a disconnected connection
   */
  async function cleanupConnection(connectionId: string): Promise<void> {
    console.log('Cleaning up disconnected connection:', connectionId);

    try {
      // Delete connection entry
      await docClient.send(
        new DeleteCommand({
          TableName: connectionsTable,
          Key: { connectionId },
        }),
      );

      // TODO: Delete all queries and dependencies for this connection
    } catch (error) {
      console.error('Error cleaning up connection:', error);
    }
  }

  return {
    connectHandler,
    disconnectHandler,
    messageHandler,
    streamHandler,
  };
}
