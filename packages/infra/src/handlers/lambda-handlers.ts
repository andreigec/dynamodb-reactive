/**
 * Entry point code generator for the reactive Lambda handlers.
 *
 * No user code is imported - the handlers use only environment variables
 * and stored query metadata for all operations.
 */

/**
 * Generate the entry point code for Lambda functions.
 * This is called by the CDK construct to create the bundled entry file.
 */
export function generateEntryPointCode(): string {
  return `// Auto-generated entry point for reactive Lambda handlers
// No user code required - all configuration comes from environment variables
import { createLambdaHandlers } from 'dynamodb-harness/server';

const handlers = createLambdaHandlers();

export const connectHandler = handlers.connectHandler;
export const disconnectHandler = handlers.disconnectHandler;
export const messageHandler = handlers.messageHandler;
export const streamHandler = handlers.streamHandler;
`;
}
