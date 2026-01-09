\# \*\*Project: dynamodb-reactive\*\*



\*\*Tagline:\*\* A Serverless, Reactive tRPC replacement for AWS.



\## \*\*1\\. Overview\*\*



This project scaffolds a TypeScript monorepo enabling developers to build type-safe, real-time applications on DynamoDB without managing WebSocket infrastructure.



\*\*Core Philosophy:\*\*



\* \*\*Dependency Tracking (Inverted Index):\*\* Instead of scanning thousands of queries, the engine tracks which \*data fields\* a subscription cares about. Updates are O(1) lookups, not O(N) scans.  

\* \*\*Bandwidth Efficient:\*\* The server maintains the state of every subscription and sends \*\*JSON Patches\*\* (diffs) over the wire, not full payloads.  

\* \*\*Shared Runtime:\*\* The same "Router" definition is used by the Next.js server (for initial SSR/SEO) and the AWS Lambda (for reactive updates), ensuring zero logic duplication.



\## \*\*2\\. Monorepo Structure\*\*



| Package | Path | Purpose |

| :---- | :---- | :---- |

| \*\*Core\*\* | packages/core | Shared DynamoTable definitions and Zod schemas. |

| \*\*Server\*\* | packages/server | The runtime logic: Router builder, PartiQL generation, and Dependency Extractor. |

| \*\*Infra\*\* | packages/infra | CDK constructs. Provisions the "Engine" (Lambda \\+ Tables \\+ API Gateway). |

| \*\*Client\*\* | packages/client | The frontend proxy client and React hooks. |



\## \*\*3\\. Internal Architecture \& Tables\*\*



The ReactiveEngine automatically provisions these three system tables to handle the reactive logic. The user does not interact with these directly.



\### \*\*A. State Tables\*\*



1\. \*\*ReactiveConnections\*\*:  

&nbsp;  \* \*\*Purpose:\*\* Tracks active WebSocket connections and user context (Auth).  

&nbsp;  \* \*\*TTL:\*\* Enabled to auto-expire stale sockets.  

2\. \*\*ReactiveDependencies (The Inverted Index)\*\*:  

&nbsp;  \* \*\*Purpose:\*\* Maps Field\\#Value $\\\\rightarrow$ ConnectionID.  

&nbsp;  \* \*\*Logic:\*\* Allows the engine to instantly find who cares when taskListId=123 changes.  

3\. \*\*ReactiveConnectionQueries\*\*:  

&nbsp;  \* \*\*Purpose:\*\* Stores the active subscription state for diffing.  

&nbsp;  \* \*\*Schema:\*\* pk: connId, sk: queryId, lastResult: \\<JSON\\>, queryArgs: \\<JSON\\>.  

&nbsp;  \* \*\*Logic:\*\* Used to generate JSON Patches before sending updates.



\### \*\*B. The Logic Flow\*\*



1\. \*\*Subscription (Next.js/Server):\*\* User connects. The Router parses their query into dependencies (e.g., pk: taskListId, val: 123\\) and writes to ReactiveDependencies.  

2\. \*\*Mutation (DynamoDB):\*\* User writes data. DynamoDB Stream triggers the \*\*Engine Lambda\*\*.  

3\. \*\*Matching (Engine Lambda):\*\* Lambda reads the modified record, hashes the fields, and batch-queries ReactiveDependencies to find subscribers.  

4\. \*\*Execution \& Patching:\*\* Lambda re-runs the specific router procedure, compares the new result with lastResult, generates a JSON Patch, and pushes it to the WebSocket.



\## \*\*4\\. Package Requirements\*\*



\### \*\*A. Core (@dynamodb-reactive/core)\*\*



\* \*\*Exports:\*\* DynamoTable, defineSchema.  

\* \*\*Role:\*\* Pure type definitions. No runtime logic.



\### \*\*B. Server (@dynamodb-reactive/server)\*\*



\* \*\*Exports:\*\* initReactive, createReactiveHandler (for Next.js), createStreamHandler (for AWS Lambda).  

\* \*\*Internals:\*\*  

&nbsp; \* \*\*DependencyExtractor:\*\* Analyzes a router procedure and extracts the database keys it accesses for indexing.  

&nbsp; \* \*\*PartiQLBuilder:\*\* Converts Zod filters into DynamoDB PartiQL statements.  

&nbsp; \* \*\*Patcher:\*\* Uses fast-json-patch to diff datasets.



\### \*\*C. Infra (@dynamodb-reactive/infra)\*\*



\* \*\*Exports:\*\* ReactiveEngine (CDK Construct).  

\* \*\*Function:\*\*  

&nbsp; \* Provisions the 3 system tables.  

&nbsp; \* Bundles the createStreamHandler from the Server package into a Node.js Lambda.  

&nbsp; \* Sets up DynamoDB Streams and Event Source Mappings.



\### \*\*D. Client (@dynamodb-reactive/client)\*\*



\* \*\*Exports:\*\* createReactiveClient.  

\* \*\*Function:\*\* Handles WebSocket reconnection, applying JSON patches to local state, and TypeScript inference.



\## ---



\*\*5\\. End-User Consumption Guide\*\*



\### \*\*Step 1: Define Data (packages/core)\*\*



TypeScript



import { z } from 'zod';  

import { DynamoTable } from '@dynamodb-reactive/core';



export const TodoTable \\= new DynamoTable({  

&nbsp; tableName: 'prod-todo-table',  

&nbsp; schema: z.object({  

&nbsp;   id: z.string(),  

&nbsp;   taskListId: z.string(),  

&nbsp;   text: z.string(),  

&nbsp;   isDone: z.boolean(),  

&nbsp; }),  

&nbsp; pk: 'id',  

&nbsp; indexes: {  

&nbsp;   byTaskId: { name: 'gsi\\\_by\\\_task\\\_id', pk: 'taskListId' }   

&nbsp; }  

});



\### \*\*Step 2: Define Logic (packages/server)\*\*



The user defines procedures. The system automatically handles context serialization.



TypeScript



import { initReactive } from '@dynamodb-reactive/server';  

import { TodoTable } from '../my-schema'; 



const t \\= initReactive\\<{ userId: string }\\>(); // Define Context type



export const appRouter \\= t.router({  

&nbsp; todos: {  

&nbsp;   // A Reactive Query  

&nbsp;   list: t.procedure  

&nbsp;     .input(z.object({ taskListId: z.string() }))  

&nbsp;     .query(({ ctx, input }) \\=\\> {  

&nbsp;        // This query is automatically parsed for dependencies:  

&nbsp;        // Dependency: TodoTable.taskListId \\== input.taskListId  

&nbsp;        return ctx.db  

&nbsp;          .query(TodoTable)  

&nbsp;          .filter((q) \\=\\> q.eq(TodoTable.field.taskListId, input.taskListId))  

&nbsp;          .take(50);  

&nbsp;   }),  

&nbsp; }  

});



export type AppRouter \\= typeof appRouter;



\### \*\*Step 3: Deploy Infra (packages/infra)\*\*



TypeScript



import { ReactiveEngine } from '@dynamodb-reactive/infra';  

import { TodoTable } from '../my-schema';  

// The Engine handles all Lambda creation and Stream wiring internally  

export class MyStack extends cdk.Stack {  

&nbsp; constructor(scope, id, props) {  

&nbsp;   super(scope, id, props);  

&nbsp;   new ReactiveEngine(this, 'Engine', {  

&nbsp;     tables: \\\[TodoTable\\], // Grants R/W access and enabling Streams  

&nbsp;   });  

&nbsp; }  

}



\### \*\*Step 4: Frontend Usage (packages/client)\*\*



TypeScript



'use client';  

import { createReactiveClient } from '@dynamodb-reactive/client';  

import type { AppRouter } from '../server/router'; 



// Client automatically handles WS connection and JSON Patching  

const client \\= createReactiveClient\\<AppRouter\\>({  

&nbsp; url: process.env.NEXT\\\_PUBLIC\\\_WS\\\_URL  

});



export default function TodoList({ listId }: { listId: string }) {  

&nbsp; // 1\\. Initial Load: Happens via HTTP (hidden detail)  

&nbsp; // 2\\. Updates: Arrive via WS as patches  

&nbsp; const { data } \\= client.todos.list.useSubscription({ taskListId: listId });  

&nbsp;   

&nbsp; return \\<pre\\>{JSON.stringify(data, null, 2)}\\</pre\\>;  

}  

