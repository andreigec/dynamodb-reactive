import type { DbContextConfig } from './db-context.js';

/**
 * Configuration for creating a reactive harness
 */
export interface ReactiveHarnessConfig<TContext> {
  /**
   * Function to get the context for a connection
   * This is called on each request to build the procedure context
   */
  getContext?: (connectionId: string) => Promise<TContext>;

  /**
   * Optional database configuration
   */
  dbConfig?: DbContextConfig;
}

/**
 * The reactive harness object containing all configuration needed for the engine
 */
export interface ReactiveHarness<TContext> {
  getContext: (connectionId: string) => Promise<TContext>;
  dbConfig?: DbContextConfig;
}

/**
 * Create a reactive harness that encapsulates the router and context configuration.
 *
 * This is the only export needed from user code for the ReactiveEngine.
 * The engine will use this harness to automatically create all WebSocket handlers.
 *
 * @example
 * ```typescript
 * // harness.ts - This is all you need in your handlers directory
 * import { createReactiveHarness } from 'dynamodb-harness/server';
 * import { appRouter } from './router';
 *
 * export default createReactiveHarness({
 *   getContext: async (connectionId) => ({
 *     connectionId,
 *   }),
 * });
 * ```
 */
export function createReactiveHarness<TContext>(
  config: ReactiveHarnessConfig<TContext>,
): ReactiveHarness<TContext> {
  return {
    getContext: config.getContext ?? (async () => ({}) as unknown as TContext),
    dbConfig: config.dbConfig,
  };
}
