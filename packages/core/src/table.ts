import type { z } from 'zod';

import type { DynamoTableConfig, FieldRef, IndexDefinition } from './types.js';

/**
 * Creates field references for type-safe query building
 */
type FieldRefs<TSchema extends z.ZodObject<z.ZodRawShape>> = {
  [K in keyof z.infer<TSchema>]: FieldRef<K & string, z.infer<TSchema>[K]>;
};

/**
 * DynamoTable - Defines a DynamoDB table with type-safe schema
 *
 * @example
 * ```ts
 * const TodoTable = new DynamoTable({
 *   tableName: 'prod-todo-table',
 *   schema: z.object({
 *     id: z.string(),
 *     taskListId: z.string(),
 *     text: z.string(),
 *     isDone: z.boolean(),
 *   }),
 *   pk: 'id',
 *   indexes: {
 *     byTaskId: { name: 'gsi_by_task_id', pk: 'taskListId' }
 *   }
 * });
 * ```
 */
export class DynamoTable<
  TSchema extends z.ZodObject<z.ZodRawShape>,
  TPk extends keyof z.infer<TSchema>,
  TSk extends keyof z.infer<TSchema> | undefined = undefined,
  TIndexes extends Record<string, IndexDefinition> = Record<
    string,
    IndexDefinition
  >,
> {
  public readonly tableName: string;
  public readonly schema: TSchema;
  public readonly pk: TPk;
  public readonly sk: TSk;
  public readonly indexes: TIndexes;
  public readonly field: FieldRefs<TSchema>;

  constructor(config: DynamoTableConfig<TSchema, TPk, TSk, TIndexes>) {
    this.tableName = config.tableName;
    this.schema = config.schema;
    this.pk = config.pk;
    this.sk = config.sk as TSk;
    this.indexes = (config.indexes ?? {}) as TIndexes;

    // Create field references for query building
    this.field = this.createFieldRefs();
  }

  private createFieldRefs(): FieldRefs<TSchema> {
    const shape = this.schema.shape;
    const refs: Record<string, FieldRef<string, unknown>> = {};

    for (const key of Object.keys(shape)) {
      refs[key] = {
        fieldName: key,
        _type: undefined as unknown,
      };
    }

    return refs as FieldRefs<TSchema>;
  }

  /**
   * Validate an item against the schema
   */
  validate(item: unknown): z.infer<TSchema> {
    return this.schema.parse(item);
  }

  /**
   * Safely validate an item, returning a result object
   */
  safeParse(item: unknown): z.SafeParseReturnType<unknown, z.infer<TSchema>> {
    return this.schema.safeParse(item);
  }

  /**
   * Get the partition key value from an item
   */
  getPk(item: z.infer<TSchema>): z.infer<TSchema>[TPk] {
    return item[this.pk];
  }

  /**
   * Get the sort key value from an item (if defined)
   */
  getSk(
    item: z.infer<TSchema>,
  ): TSk extends keyof z.infer<TSchema> ? z.infer<TSchema>[TSk] : undefined {
    if (this.sk === undefined) {
      return undefined as TSk extends keyof z.infer<TSchema>
        ? z.infer<TSchema>[TSk]
        : undefined;
    }
    return item[
      this.sk as keyof z.infer<TSchema>
    ] as TSk extends keyof z.infer<TSchema> ? z.infer<TSchema>[TSk] : undefined;
  }

  /**
   * Get the list of field names in the schema
   */
  getFieldNames(): (keyof z.infer<TSchema>)[] {
    return Object.keys(this.schema.shape) as (keyof z.infer<TSchema>)[];
  }

  /**
   * Check if a field exists in the schema
   */
  hasField(fieldName: string): fieldName is keyof z.infer<TSchema> & string {
    return fieldName in this.schema.shape;
  }
}

/**
 * Helper type to extract the shape from a Zod schema
 */
export type InferSchema<T> =
  T extends DynamoTable<infer TSchema, any, any, any>
    ? z.infer<TSchema>
    : never;

/**
 * Helper type to extract field names from a table
 */
export type TableFields<T> =
  T extends DynamoTable<infer TSchema, any, any, any>
    ? keyof z.infer<TSchema>
    : never;

/**
 * Helper type to get the pk field name
 */
export type TablePk<T> =
  T extends DynamoTable<any, infer TPk, any, any> ? TPk : never;

/**
 * Helper type to get the sk field name
 */
export type TableSk<T> =
  T extends DynamoTable<any, any, infer TSk, any> ? TSk : never;

/**
 * Helper type to get indexes
 */
export type TableIndexes<T> =
  T extends DynamoTable<any, any, any, infer TIndexes> ? TIndexes : never;
