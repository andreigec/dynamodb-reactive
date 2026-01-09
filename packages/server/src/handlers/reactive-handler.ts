import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';
import type { ConnectionEntry, QueryEntry } from '@dynamodb-reactive/core';
import { SystemTableNames } from '@dynamodb-reactive/core';

import { createDbContext, type DbContextConfig } from '../db-context.js';
import { DependencyTracker } from '../dependency-extractor.js';
import type { Router } from '../router.js';
import type { DatabaseContext } from '../types.js';

/**
 * Request types for the reactive handler
 */
export interface SubscribeRequest {
  type: 'subscribe';
  subscriptionId: string;
  path: string;
  input: unknown;
}

export interface UnsubscribeRequest {
  type: 'unsubscribe';
  subscriptionId: string;
}

export interface CallRequest {
  type: 'call';
  path: string;
  input: unknown;
}

export type ReactiveRequest =
  | SubscribeRequest
  | UnsubscribeRequest
  | CallRequest;

/**
 * Response types for the reactive handler
 */
export interface SnapshotResponse {
  type: 'snapshot';
  subscriptionId: string;
  data: unknown;
}

export interface PatchResponse {
  type: 'patch';
  subscriptionId: string;
  patches: unknown[];
}

export interface ResultResponse {
  type: 'result';
  data: unknown;
}

export interface ErrorResponse {
  type: 'error';
  message: string;
  subscriptionId?: string;
}

export type ReactiveResponse =
  | SnapshotResponse
  | PatchResponse
  | ResultResponse
  | ErrorResponse;

/**
 * Configuration for the reactive handler
 */
export interface ReactiveHandlerConfig<TContext> {
  router: Router<TContext, any>;
  dbConfig?: DbContextConfig;
  getContext: (connectionId: string) => Promise<TContext>;
  ttlSeconds?: number;
  /** Table names (uses defaults if not provided) */
  connectionsTableName?: string;
  dependenciesTableName?: string;
  queriesTableName?: string;
}

/**
 * Create a reactive handler for Next.js API routes or other HTTP servers.
 * This handler is used for subscribe/call requests and stores queryMetadata
 * for the stream handler to use later.
 */
export function createReactiveHandler<TContext>(
  config: ReactiveHandlerConfig<TContext>,
) {
  const ttlSeconds = config.ttlSeconds ?? 3600; // 1 hour default
  const connectionsTable =
    config.connectionsTableName ?? SystemTableNames.connections;
  const dependenciesTable =
    config.dependenciesTableName ?? SystemTableNames.dependencies;
  const queriesTable = config.queriesTableName ?? SystemTableNames.queries;

  // Create DynamoDB client
  const ddbClient = new DynamoDBClient({
    region: config.dbConfig?.region ?? process.env.AWS_REGION,
  });
  const docClient = DynamoDBDocumentClient.from(ddbClient);

  /**
   * Handle an incoming request
   */
  async function handleRequest(
    connectionId: string,
    request: ReactiveRequest,
  ): Promise<ReactiveResponse> {
    try {
      const ctx = await config.getContext(connectionId);
      const dependencyTracker = new DependencyTracker();
      const db = createDbContext(config.dbConfig ?? {}, dependencyTracker);
      const fullCtx = { ...ctx, db } as TContext & { db: DatabaseContext };

      switch (request.type) {
        case 'subscribe':
          return handleSubscribe(
            connectionId,
            request,
            fullCtx,
            dependencyTracker,
          );

        case 'unsubscribe':
          return handleUnsubscribe(connectionId, request);

        case 'call':
          return handleCall(request, fullCtx);

        default:
          return {
            type: 'error',
            message: `Unknown request type: ${(request as { type: string }).type}`,
          };
      }
    } catch (error) {
      return {
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        subscriptionId:
          'subscriptionId' in request ? request.subscriptionId : undefined,
      };
    }
  }

  /**
   * Handle a subscribe request.
   * Executes the query, stores queryMetadata for stream handler, returns initial data.
   */
  async function handleSubscribe(
    connectionId: string,
    request: SubscribeRequest,
    ctx: TContext & { db: DatabaseContext },
    dependencyTracker: DependencyTracker,
  ): Promise<ReactiveResponse> {
    // Execute the query to get initial data
    const result = await config.router.execute(
      request.path,
      ctx,
      request.input,
    );

    // Get query metadata and dependencies
    const queryMetadata = dependencyTracker.getQueryMetadata();
    const dependencyKeys = dependencyTracker.getDependencyKeys();

    if (!queryMetadata) {
      console.warn('No query metadata captured for subscription');
    }

    const now = Date.now();
    const ttl = Math.floor(now / 1000) + ttlSeconds;

    // Store the subscription with queryMetadata
    const queryEntry: QueryEntry = {
      pk: connectionId,
      sk: request.subscriptionId,
      connectionId,
      subscriptionId: request.subscriptionId,
      queryMetadata: queryMetadata ?? {
        tableName: '',
        filterConditions: [],
      },
      lastResult: Array.isArray(result) ? result : [result],
      dependencies: dependencyKeys,
      createdAt: now,
      updatedAt: now,
      ttl,
    };

    await docClient.send(
      new PutCommand({
        TableName: queriesTable,
        Item: queryEntry,
      }),
    );

    // Store dependency entries (inverted index)
    for (const key of dependencyKeys) {
      await docClient.send(
        new PutCommand({
          TableName: dependenciesTable,
          Item: {
            pk: key,
            sk: `${connectionId}#${request.subscriptionId}`,
            connectionId,
            subscriptionId: request.subscriptionId,
            ttl,
          },
        }),
      );
    }

    console.log('Subscription created:', {
      connectionId,
      subscriptionId: request.subscriptionId,
      queryMetadata: queryMetadata?.tableName,
      dependencies: dependencyKeys,
    });

    return {
      type: 'snapshot',
      subscriptionId: request.subscriptionId,
      data: result,
    };
  }

  /**
   * Handle an unsubscribe request
   */
  async function handleUnsubscribe(
    connectionId: string,
    request: UnsubscribeRequest,
  ): Promise<ReactiveResponse> {
    // Get the subscription to find its dependencies
    const subResponse = await docClient.send(
      new GetCommand({
        TableName: queriesTable,
        Key: { pk: connectionId, sk: request.subscriptionId },
      }),
    );

    if (subResponse.Item) {
      const queryEntry = subResponse.Item as QueryEntry;

      // Delete dependency entries
      for (const key of queryEntry.dependencies ?? []) {
        await docClient.send(
          new DeleteCommand({
            TableName: dependenciesTable,
            Key: { pk: key, sk: `${connectionId}#${request.subscriptionId}` },
          }),
        );
      }
    }

    // Delete the subscription
    await docClient.send(
      new DeleteCommand({
        TableName: queriesTable,
        Key: { pk: connectionId, sk: request.subscriptionId },
      }),
    );

    console.log('Subscription removed:', {
      connectionId,
      subscriptionId: request.subscriptionId,
    });

    return {
      type: 'result',
      data: { success: true },
    };
  }

  /**
   * Handle a call (mutation) request
   */
  async function handleCall(
    request: CallRequest,
    ctx: TContext & { db: DatabaseContext },
  ): Promise<ReactiveResponse> {
    const result = await config.router.execute(
      request.path,
      ctx,
      request.input,
    );

    return {
      type: 'result',
      data: result,
    };
  }

  /**
   * Register a new connection
   */
  async function registerConnection(
    connectionId: string,
    context?: Record<string, unknown>,
  ): Promise<void> {
    const now = Date.now();
    const ttl = Math.floor(now / 1000) + ttlSeconds;

    const connectionEntry: ConnectionEntry = {
      connectionId,
      context,
      connectedAt: now,
      ttl,
    };

    await docClient.send(
      new PutCommand({
        TableName: connectionsTable,
        Item: connectionEntry,
      }),
    );

    console.log('Connection registered:', connectionEntry);
  }

  /**
   * Unregister a connection and clean up subscriptions
   */
  async function unregisterConnection(connectionId: string): Promise<void> {
    // Delete the connection
    await docClient.send(
      new DeleteCommand({
        TableName: connectionsTable,
        Key: { connectionId },
      }),
    );

    // TODO: Clean up all subscriptions for this connection

    console.log('Connection unregistered:', connectionId);
  }

  return {
    handleRequest,
    registerConnection,
    unregisterConnection,
  };
}
