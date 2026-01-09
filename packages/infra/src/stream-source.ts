import * as cdk from 'aws-cdk-lib';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

/**
 * Props for DynamoDBStreamSource
 */
export interface DynamoDBStreamSourceProps {
  /**
   * The DynamoDB table to create a stream source for
   */
  table: dynamodb.ITable;

  /**
   * The Lambda function to receive stream events
   */
  target: lambda.IFunction;

  /**
   * Batch size for stream processing
   * @default 100
   */
  batchSize?: number;

  /**
   * Maximum batching window
   * @default Duration.seconds(5)
   */
  maxBatchingWindow?: cdk.Duration;

  /**
   * Starting position for reading the stream
   * @default TRIM_HORIZON
   */
  startingPosition?: lambda.StartingPosition;

  /**
   * Enable parallel processing with multiple batches
   * @default 1
   */
  parallelizationFactor?: number;

  /**
   * Maximum record age to process
   * @default Duration.days(1)
   */
  maxRecordAge?: cdk.Duration;

  /**
   * Number of retries on failure
   * @default 3
   */
  retryAttempts?: number;

  /**
   * Filter patterns for the event source
   */
  filters?: lambda.FilterCriteria[];
}

/**
 * Helper construct for setting up DynamoDB stream event sources
 */
export class DynamoDBStreamSource extends Construct {
  public readonly eventSourceMapping: lambda.EventSourceMapping;

  constructor(scope: Construct, id: string, props: DynamoDBStreamSourceProps) {
    super(scope, id);

    const {
      table,
      target,
      batchSize = 100,
      maxBatchingWindow = cdk.Duration.seconds(5),
      startingPosition = lambda.StartingPosition.TRIM_HORIZON,
      parallelizationFactor = 1,
      maxRecordAge = cdk.Duration.days(1),
      retryAttempts = 3,
      filters,
    } = props;

    if (!table.tableStreamArn) {
      throw new Error(
        `Table ${table.tableName} does not have DynamoDB Streams enabled. ` +
          'Enable streams with streamSpecification when creating the table.',
      );
    }

    // Grant stream read permissions
    table.grantStreamRead(target);

    // Create the event source mapping
    this.eventSourceMapping = new lambda.EventSourceMapping(
      this,
      'EventSource',
      {
        target,
        eventSourceArn: table.tableStreamArn,
        startingPosition,
        batchSize,
        maxBatchingWindow,
        parallelizationFactor,
        maxRecordAge,
        retryAttempts,
        bisectBatchOnError: true,
        reportBatchItemFailures: true,
        filters,
      },
    );
  }
}

/**
 * Create a filter criteria for DynamoDB streams
 */
export function createStreamFilter(options: {
  /**
   * Filter by event name (INSERT, MODIFY, REMOVE)
   */
  eventName?: ('INSERT' | 'MODIFY' | 'REMOVE')[];

  /**
   * Custom filter patterns
   */
  patterns?: Record<string, unknown>[];
}): lambda.FilterCriteria[] {
  const filters: Record<string, unknown>[] = [];

  if (options.eventName) {
    filters.push({
      eventName: options.eventName,
    });
  }

  if (options.patterns) {
    filters.push(...options.patterns);
  }

  if (filters.length === 0) {
    return [];
  }

  return [lambda.FilterCriteria.filter({ filters })];
}
