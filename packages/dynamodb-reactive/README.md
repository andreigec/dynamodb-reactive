# **dynamodb-reactive**

**Tagline:** A Serverless, Reactive tRPC replacement for AWS - unified package.

## **1. Overview**

`dynamodb-reactive` provides type-safe, real-time DynamoDB subscriptions with automatic JSON Patch diffing over WebSockets.

**Key Features:**

* **Full TypeScript Support:** End-to-end type safety from schema definition to React hooks.

## **2. Installation**

```bash
npm install dynamodb-reactive zod
# or
pnpm add dynamodb-reactive zod
```

**Peer Dependencies (install as needed):**

| Dependency | Required For |
| :--- | :--- |
| `zod` | Schema definitions (required) |
| `react` | React hooks |
| `aws-cdk-lib` | Infrastructure |
| `constructs` | Infrastructure |

## **3. Package Exports**

| Import Path | Purpose |
| :--- | :--- |
| `dynamodb-reactive` | Core exports (DynamoTable, schemas) |
| `dynamodb-reactive/core` | Core table definitions |
| `dynamodb-reactive/server` | Server runtime (Router, handlers) |
| `dynamodb-reactive/client` | Frontend client |
| `dynamodb-reactive/react` | React hooks |
| `dynamodb-reactive/infra` | CDK constructs |

## **4. Quick Start**

### **Step 1: Define Your Schema**

```typescript
import { z } from 'zod';
import { DynamoTable } from 'dynamodb-reactive/core';

export const TodoTable = new DynamoTable({
  tableName: 'my-table',
  schema: z.object({
    PK: z.string(),
    SK: z.string(),
    id: z.string(),
    text: z.string(),
    completed: z.boolean(),
    createdAt: z.number(),
  }),
  pk: 'PK',
  sk: 'SK',
});
```

### **Step 2: Create the Router**

```typescript
import { z } from 'zod';
import { initReactive } from 'dynamodb-reactive/server';
import { TodoTable } from './schema';

type AppContext = Record<string, unknown>;
const t = initReactive<AppContext>();

export const appRouter = t.router({
  todos: {
    // Query procedure
    list: t.procedure
      .input(z.object({}).optional())
      .query(async ({ ctx }) => {
        return ctx.db
          .query(TodoTable)
          .filter((q) => q.eq(TodoTable.field.PK, 'TODO'))
          .execute();
      }),

    // Mutation procedure
    create: t.procedure
      .input(z.object({ text: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const item = {
          PK: 'TODO',
          SK: Date.now().toString(),
          id: Date.now().toString(),
          text: input.text,
          completed: false,
          createdAt: Date.now(),
        };
        await ctx.db.put(TodoTable, item);
        return item;
      }),
  },
});

export type AppRouter = typeof appRouter;
```

### **Step 3: Create API Handler**

```typescript
import { createReactiveHandler } from 'dynamodb-reactive/server';
import { appRouter } from './router';

export const handler = createReactiveHandler({
  router: appRouter,
  dbConfig: { region: 'us-east-1' },
  getContext: async () => ({}),
});

// In Next.js API route:
export async function POST(request: Request) {
  const body = await request.json();
  const response = await handler.handleRequest('client-id', body);
  return Response.json(response);
}
```

### **Step 4: Call from Client**

```typescript
// Query
const response = await fetch('/api/reactive', {
  method: 'POST',
  body: JSON.stringify({
    type: 'subscribe',
    subscriptionId: 'sub-1',
    path: 'todos.list',
    input: {},
  }),
});
const { data } = await response.json();

// Mutation
const response = await fetch('/api/reactive', {
  method: 'POST',
  body: JSON.stringify({
    type: 'call',
    callId: 'call-1',
    path: 'todos.create',
    input: { text: 'New todo' },
  }),
});
const { data } = await response.json();
```

## **5. Database Context Methods**

The `ctx.db` object provides these methods:

| Method | Description |
| :--- | :--- |
| `query(table).filter(...).execute()` | Query with filters |
| `get(table, key)` | Get single item by key |
| `put(table, item)` | Create/replace item |
| `update(table, key, updates)` | Update item fields |
| `delete(table, key)` | Delete item |

## **6. Requirements**

* Node.js >= 18.0.0
* TypeScript >= 5.3.0

## **7. License**

MIT
