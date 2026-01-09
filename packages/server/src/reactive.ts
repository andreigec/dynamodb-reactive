import type { z } from 'zod';

import { ProcedureBuilder } from './procedure.js';
import type { Router } from './router.js';
import { createRouter } from './router.js';
import type { RouterDefinition } from './types.js';

/**
 * ReactiveBuilder - The main builder returned by initReactive
 */
export interface ReactiveBuilder<TContext> {
  /**
   * Create a new procedure builder
   */
  procedure: ProcedureBuilder<TContext>;

  /**
   * Create a router from procedure definitions
   */
  router<TRouter extends RouterDefinition<TContext>>(
    definition: TRouter,
  ): Router<TContext, TRouter>;
}

/**
 * Initialize the reactive system with a context type
 *
 * @example
 * ```ts
 * const t = initReactive<{ userId: string }>();
 *
 * export const appRouter = t.router({
 *   todos: {
 *     list: t.procedure
 *       .input(z.object({ taskListId: z.string() }))
 *       .query(({ ctx, input }) => {
 *         return ctx.db
 *           .query(TodoTable)
 *           .filter((q) => q.eq(TodoTable.field.taskListId, input.taskListId))
 *           .take(50);
 *       }),
 *   }
 * });
 * ```
 */
export function initReactive<
  TContext = Record<string, unknown>,
>(): ReactiveBuilder<TContext> {
  return {
    procedure: new ProcedureBuilder<TContext>(),

    router<TRouter extends RouterDefinition<TContext>>(
      definition: TRouter,
    ): Router<TContext, TRouter> {
      return createRouter(definition);
    },
  };
}

/**
 * Type helper to infer the router type
 */
export type InferRouterType<T> =
  T extends Router<infer TContext, infer TRouter>
    ? { context: TContext; router: TRouter }
    : never;

/**
 * Type helper to get procedure input type
 */
export type InferProcedureInput<T> = T extends { inputSchema: infer TSchema }
  ? TSchema extends z.ZodType
    ? z.infer<TSchema>
    : undefined
  : undefined;

/**
 * Type helper to get procedure output type
 */
export type InferProcedureOutput<T> = T extends {
  resolver: (...args: any) => infer TOutput;
}
  ? Awaited<TOutput>
  : unknown;
