import { SystemTableNames } from '@dynamodb-reactive/core';
import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

/**
 * Props for ReactiveSystemTables
 */
export interface ReactiveSystemTablesProps {
  /**
   * Prefix for table names
   * @default - no prefix
   */
  tablePrefix?: string;

  /**
   * Removal policy for tables
   * @default - cdk.RemovalPolicy.RETAIN
   */
  removalPolicy?: cdk.RemovalPolicy;

  /**
   * Enable point-in-time recovery
   * @default false
   */
  pointInTimeRecovery?: boolean;
}

/**
 * Creates the three system tables for the reactive engine
 */
export class ReactiveSystemTables extends Construct {
  /**
   * ReactiveConnections table - tracks WebSocket connections
   */
  public readonly connectionsTable: dynamodb.Table;

  /**
   * ReactiveDependencies table - the inverted index
   */
  public readonly dependenciesTable: dynamodb.Table;

  /**
   * ReactiveConnectionQueries table - stores subscription state
   */
  public readonly queriesTable: dynamodb.Table;

  constructor(
    scope: Construct,
    id: string,
    props: ReactiveSystemTablesProps = {},
  ) {
    super(scope, id);

    const prefix = props.tablePrefix ? `${props.tablePrefix}-` : '';
    const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.RETAIN;
    const pointInTimeRecovery = props.pointInTimeRecovery ?? false;

    // ReactiveConnections Table
    // Tracks active WebSocket connections and user context
    this.connectionsTable = new dynamodb.Table(this, 'ConnectionsTable', {
      tableName: `${prefix}${SystemTableNames.connections}`,
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      pointInTimeRecovery,
      timeToLiveAttribute: 'ttl',
    });

    // ReactiveDependencies Table (The Inverted Index)
    // Maps Field#Value -> ConnectionID for O(1) lookups
    this.dependenciesTable = new dynamodb.Table(this, 'DependenciesTable', {
      tableName: `${prefix}${SystemTableNames.dependencies}`,
      partitionKey: {
        name: 'pk', // Format: "TableName#FieldName#FieldValue"
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // Format: "ConnectionID#SubscriptionID"
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      pointInTimeRecovery,
      timeToLiveAttribute: 'ttl',
    });

    // Add GSI for querying by connectionId (for cleanup)
    this.dependenciesTable.addGlobalSecondaryIndex({
      indexName: 'byConnectionId',
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.KEYS_ONLY,
    });

    // ReactiveConnectionQueries Table
    // Stores subscription state for diffing
    this.queriesTable = new dynamodb.Table(this, 'QueriesTable', {
      tableName: `${prefix}${SystemTableNames.queries}`,
      partitionKey: {
        name: 'pk', // ConnectionID
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'sk', // SubscriptionID
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      pointInTimeRecovery,
      timeToLiveAttribute: 'ttl',
    });
  }
}
