import * as fs from 'node:fs';
import * as path from 'node:path';

import type { AnyDynamoTable } from '@dynamodb-reactive/core';
import * as cdk from 'aws-cdk-lib';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as apigatewayv2Integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

import { generateEntryPointCode } from './handlers/lambda-handlers.js';
import {
  ReactiveSystemTables,
  type ReactiveSystemTablesProps,
} from './tables.js';

/**
 * Props for ReactiveEngine construct
 */
export interface ReactiveEngineProps {
  /**
   * User-defined DynamoDB tables to enable reactive updates on
   */
  tables: AnyDynamoTable[];

  /**
   * Prefix for all resource names
   * @default - no prefix
   */
  resourcePrefix?: string;

  /**
   * System tables configuration
   */
  systemTablesProps?: ReactiveSystemTablesProps;

  /**
   * Lambda function memory size in MB
   * @default 256
   */
  memorySize?: number;

  /**
   * Lambda function timeout
   * @default Duration.seconds(30)
   */
  timeout?: cdk.Duration;

  /**
   * Log retention period
   * @default logs.RetentionDays.ONE_WEEK
   */
  logRetention?: logs.RetentionDays;

  /**
   * Environment variables for Lambda functions
   */
  environment?: Record<string, string>;

  /**
   * Enable tracing with X-Ray
   * @default false
   */
  tracing?: boolean;
}

/**
 * ReactiveEngine - Main CDK construct for the reactive DynamoDB system
 */
export class ReactiveEngine extends Construct {
  public readonly systemTables: ReactiveSystemTables;
  public readonly webSocketApi: apigatewayv2.WebSocketApi;
  public readonly webSocketStage: apigatewayv2.WebSocketStage;
  public readonly connectHandler: lambda.Function;
  public readonly disconnectHandler: lambda.Function;
  public readonly messageHandler: lambda.Function;
  public readonly streamHandler: lambda.Function;
  public readonly webSocketUrl: string;
  public readonly callbackUrl: string;

  constructor(scope: Construct, id: string, props: ReactiveEngineProps) {
    super(scope, id);

    const prefix = props.resourcePrefix ?? '';
    const memorySize = props.memorySize ?? 256;
    const timeout = props.timeout ?? cdk.Duration.seconds(30);
    const logRetention = props.logRetention ?? logs.RetentionDays.ONE_WEEK;

    // Create system tables
    this.systemTables = new ReactiveSystemTables(this, 'SystemTables', {
      tablePrefix: prefix,
      ...props.systemTablesProps,
    });

    // Create WebSocket API
    this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: `${prefix}ReactiveWebSocket`,
    });

    this.webSocketStage = new apigatewayv2.WebSocketStage(
      this,
      'WebSocketStage',
      {
        webSocketApi: this.webSocketApi,
        stageName: 'prod',
        autoDeploy: true,
      },
    );

    this.webSocketUrl = this.webSocketStage.url;
    this.callbackUrl = this.webSocketStage.callbackUrl;

    // Generate the entry point file (no user code required)
    // Write to cdk.out directory to avoid path resolution issues with temp directories
    const entryPointCode = generateEntryPointCode();
    const cdkOutDir = path.join(process.cwd(), 'cdk.out', '.generated');
    fs.mkdirSync(cdkOutDir, { recursive: true });
    const entryPointPath = path.join(
      cdkOutDir,
      `reactive-entry-${id}-${Date.now()}.ts`,
    );
    fs.writeFileSync(entryPointPath, entryPointCode);

    // Common environment variables
    const environment: Record<string, string> = {
      CONNECTIONS_TABLE: this.systemTables.connectionsTable.tableName,
      DEPENDENCIES_TABLE: this.systemTables.dependenciesTable.tableName,
      QUERIES_TABLE: this.systemTables.queriesTable.tableName,
      WEBSOCKET_ENDPOINT: this.callbackUrl,
      ...props.environment,
    };

    // Create handlers using NodejsFunction with the generated entry point
    this.connectHandler = new nodejs.NodejsFunction(this, 'ConnectHandler', {
      functionName: `${prefix}ReactiveConnect`,
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'connectHandler',
      entry: entryPointPath,
      environment,
      memorySize,
      timeout,
      logRetention,
      tracing: props.tracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
    });

    this.disconnectHandler = new nodejs.NodejsFunction(
      this,
      'DisconnectHandler',
      {
        functionName: `${prefix}ReactiveDisconnect`,
        runtime: lambda.Runtime.NODEJS_LATEST,
        handler: 'disconnectHandler',
        entry: entryPointPath,
        environment,
        memorySize,
        timeout,
        logRetention,
        tracing: props.tracing
          ? lambda.Tracing.ACTIVE
          : lambda.Tracing.DISABLED,
      },
    );

    this.messageHandler = new nodejs.NodejsFunction(this, 'MessageHandler', {
      functionName: `${prefix}ReactiveMessage`,
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'messageHandler',
      entry: entryPointPath,
      environment,
      memorySize,
      timeout,
      logRetention,
      tracing: props.tracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
    });

    this.streamHandler = new nodejs.NodejsFunction(this, 'StreamHandler', {
      functionName: `${prefix}ReactiveStream`,
      runtime: lambda.Runtime.NODEJS_LATEST,
      handler: 'streamHandler',
      entry: entryPointPath,
      environment: {
        ...environment,
        USER_TABLES: props.tables.map((t) => t.tableName).join(','),
      },
      memorySize,
      timeout,
      logRetention,
      tracing: props.tracing ? lambda.Tracing.ACTIVE : lambda.Tracing.DISABLED,
    });

    // Grant permissions for system tables
    this.systemTables.connectionsTable.grantReadWriteData(this.connectHandler);
    this.systemTables.connectionsTable.grantReadWriteData(
      this.disconnectHandler,
    );
    this.systemTables.connectionsTable.grantReadWriteData(this.messageHandler);
    this.systemTables.connectionsTable.grantReadData(this.streamHandler);

    this.systemTables.dependenciesTable.grantReadWriteData(this.messageHandler);
    this.systemTables.dependenciesTable.grantReadWriteData(this.streamHandler);

    this.systemTables.queriesTable.grantReadWriteData(this.messageHandler);
    this.systemTables.queriesTable.grantReadWriteData(this.streamHandler);

    // Grant WebSocket management permissions
    const managementPolicy = new iam.PolicyStatement({
      actions: ['execute-api:ManageConnections'],
      resources: [
        `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${this.webSocketApi.apiId}/${this.webSocketStage.stageName}/POST/@connections/*`,
      ],
    });

    this.messageHandler.addToRolePolicy(managementPolicy);
    this.streamHandler.addToRolePolicy(managementPolicy);

    // Set up WebSocket routes
    this.webSocketApi.addRoute('$connect', {
      integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
        'ConnectIntegration',
        this.connectHandler,
      ),
    });

    this.webSocketApi.addRoute('$disconnect', {
      integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
        'DisconnectIntegration',
        this.disconnectHandler,
      ),
    });

    this.webSocketApi.addRoute('$default', {
      integration: new apigatewayv2Integrations.WebSocketLambdaIntegration(
        'DefaultIntegration',
        this.messageHandler,
      ),
    });

    // Set up DynamoDB stream processing for user tables
    for (const table of props.tables) {
      this.setupStreamProcessing(table);
    }

    // Output the WebSocket URL
    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: this.webSocketUrl,
      description: 'WebSocket URL for reactive connections',
    });
  }

  private setupStreamProcessing(table: AnyDynamoTable): void {
    const tableArn = `arn:aws:dynamodb:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:table/${table.tableName}`;
    const streamArn = `${tableArn}/stream/*`;

    // Stream handler needs stream access
    this.streamHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:GetRecords',
          'dynamodb:GetShardIterator',
          'dynamodb:DescribeStream',
          'dynamodb:ListStreams',
        ],
        resources: [streamArn],
      }),
    );

    // Both handlers need read access to user tables (including PartiQL for queries)
    const tableReadPolicy = new iam.PolicyStatement({
      actions: [
        'dynamodb:Query',
        'dynamodb:Scan',
        'dynamodb:GetItem',
        'dynamodb:BatchGetItem',
        'dynamodb:PartiQLSelect',
      ],
      resources: [tableArn, `${tableArn}/index/*`],
    });

    this.streamHandler.addToRolePolicy(tableReadPolicy);
    this.messageHandler.addToRolePolicy(tableReadPolicy);

    // Message handler also needs write access for mutations
    this.messageHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:PutItem',
          'dynamodb:UpdateItem',
          'dynamodb:DeleteItem',
          'dynamodb:BatchWriteItem',
          'dynamodb:PartiQLInsert',
          'dynamodb:PartiQLUpdate',
          'dynamodb:PartiQLDelete',
        ],
        resources: [tableArn, `${tableArn}/index/*`],
      }),
    );
  }

  public addTable(table: dynamodb.ITable): void {
    if (!table.tableStreamArn) {
      throw new Error(`Table ${table.tableName} does not have streams enabled`);
    }

    table.grantStreamRead(this.streamHandler);
    table.grantReadData(this.streamHandler);

    new lambda.EventSourceMapping(this, `Stream-${table.tableName}`, {
      target: this.streamHandler,
      eventSourceArn: table.tableStreamArn,
      startingPosition: lambda.StartingPosition.TRIM_HORIZON,
      batchSize: 100,
      maxBatchingWindow: cdk.Duration.seconds(5),
    });
  }
}
