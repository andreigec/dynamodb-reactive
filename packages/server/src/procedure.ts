import type { z } from 'zod';

import type { DatabaseContext, ProcedureDefinition } from './types.js';

/**
 * Procedure builder for creating type-safe procedures
 */
export class ProcedureBuilder<
  TContext,
  TInput extends z.ZodType = z.ZodUndefined,
> {
  private inputSchema?: TInput;

  constructor(inputSchema?: TInput) {
    this.inputSchema = inputSchema;
  }

  /**
   * Define the input schema for the procedure
   */
  input<TNewInput extends z.ZodType>(
    schema: TNewInput,
  ): ProcedureBuilder<TContext, TNewInput> {
    return new ProcedureBuilder<TContext, TNewInput>(schema);
  }

  /**
   * Define a query procedure (read-only operation)
   */
  query<TOutput>(
    resolver: (opts: {
      ctx: TContext & { db: DatabaseContext };
      input: z.infer<TInput>;
    }) => Promise<TOutput> | TOutput,
  ): ProcedureDefinition<TContext, TInput, TOutput> {
    return {
      type: 'query',
      inputSchema: this.inputSchema,
      resolver,
    };
  }

  /**
   * Define a mutation procedure (write operation)
   */
  mutation<TOutput>(
    resolver: (opts: {
      ctx: TContext & { db: DatabaseContext };
      input: z.infer<TInput>;
    }) => Promise<TOutput> | TOutput,
  ): ProcedureDefinition<TContext, TInput, TOutput> {
    return {
      type: 'mutation',
      inputSchema: this.inputSchema,
      resolver,
    };
  }
}

/**
 * Check if a value is a procedure definition
 */
export function isProcedure(
  value: unknown,
): value is ProcedureDefinition<any, any, any> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'resolver' in value &&
    (value.type === 'query' || value.type === 'mutation')
  );
}

/**
 * Execute a procedure with the given context and input
 */
export async function executeProcedure<
  TContext,
  TInput extends z.ZodType,
  TOutput,
>(
  procedure: ProcedureDefinition<TContext, TInput, TOutput>,
  ctx: TContext & { db: DatabaseContext },
  rawInput: unknown,
): Promise<TOutput> {
  // Validate input if schema is defined
  let input: z.infer<TInput>;
  if (procedure.inputSchema) {
    const parseResult = procedure.inputSchema.safeParse(rawInput);
    if (!parseResult.success) {
      throw new Error(`Invalid input: ${parseResult.error.message}`);
    }
    input = parseResult.data;
  } else {
    input = rawInput as z.infer<TInput>;
  }

  // Execute the resolver
  return procedure.resolver({ ctx, input });
}
