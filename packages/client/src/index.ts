// Main client
export {
  createReactiveClient,
  ReactiveClient,
  type TypedReactiveClient,
} from './client.js';

// WebSocket manager
export { WebSocketManager } from './websocket.js';

// Patcher utilities
export { applyPatches } from './patcher.js';

// Type exports
export type {
  CallMessage,
  ClientMessage,
  ConnectionState,
  ErrorMessage,
  InferInput,
  InferOutput,
  JsonPatch,
  PatchMessage,
  ReactiveClientConfig,
  ResultMessage,
  ServerMessage,
  SnapshotMessage,
  SubscribeMessage,
  Subscription,
  SubscriptionOptions,
  UnsubscribeMessage,
} from './types.js';

// React exports (re-exported for convenience)
export {
  createProcedureHooks,
  createReactiveHooks,
  ReactiveClientProvider,
  useConnectionState,
  useMutation,
  useReactiveClient,
  useReactiveClientOrThrow,
  useSubscription,
} from './react.js';
