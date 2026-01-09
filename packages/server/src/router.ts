import { executeProcedure, isProcedure } from './procedure.js';
import type {
  DatabaseContext,
  ProcedureDefinition,
  RouterDefinition,
} from './types.js';

/**
 * Router class for organizing procedures
 */
export class Router<TContext, TRouter extends RouterDefinition<TContext>> {
  public readonly definition: TRouter;

  constructor(definition: TRouter) {
    this.definition = definition;
  }

  /**
   * Get a procedure by its path (e.g., "todos.list")
   */
  getProcedure(path: string): ProcedureDefinition<TContext, any, any> | null {
    const parts = path.split('.');
    let current: unknown = this.definition;

    for (const part of parts) {
      if (typeof current !== 'object' || current === null) {
        return null;
      }
      current = (current as Record<string, unknown>)[part];
    }

    if (isProcedure(current)) {
      return current;
    }

    return null;
  }

  /**
   * Execute a procedure by its path
   */
  async execute(
    path: string,
    ctx: TContext & { db: DatabaseContext },
    input: unknown,
  ): Promise<unknown> {
    const procedure = this.getProcedure(path);
    if (!procedure) {
      throw new Error(`Procedure not found: ${path}`);
    }

    return executeProcedure(procedure, ctx, input);
  }

  /**
   * Get all procedure paths in the router
   */
  getProcedurePaths(): string[] {
    const paths: string[] = [];

    function traverse(obj: unknown, prefix: string) {
      if (typeof obj !== 'object' || obj === null) return;

      for (const [key, value] of Object.entries(obj)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (isProcedure(value)) {
          paths.push(path);
        } else {
          traverse(value, path);
        }
      }
    }

    traverse(this.definition, '');
    return paths;
  }

  /**
   * Check if a path is a query procedure
   */
  isQuery(path: string): boolean {
    const procedure = this.getProcedure(path);
    return procedure?.type === 'query';
  }

  /**
   * Check if a path is a mutation procedure
   */
  isMutation(path: string): boolean {
    const procedure = this.getProcedure(path);
    return procedure?.type === 'mutation';
  }
}

/**
 * Create a router from a definition
 */
export function createRouter<
  TContext,
  TRouter extends RouterDefinition<TContext>,
>(definition: TRouter): Router<TContext, TRouter> {
  return new Router(definition);
}

/**
 * Merge multiple routers into one
 */
export function mergeRouters<TContext>(
  ...routers: Router<TContext, any>[]
): Router<TContext, RouterDefinition<TContext>> {
  const merged: RouterDefinition<TContext> = {};

  for (const router of routers) {
    Object.assign(merged, router.definition);
  }

  return new Router(merged);
}
