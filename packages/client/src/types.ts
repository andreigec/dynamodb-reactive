/**
 * JSON Patch operation (RFC 6902)
 */
export interface JsonPatch {
  op: 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';
  path: string;
  value?: unknown;
  from?: string;
}

/**
 * Messages sent from client to server
 */
export interface SubscribeMessage {
  type: 'subscribe';
  subscriptionId: string;
  path: string;
  input: unknown;
}

export interface UnsubscribeMessage {
  type: 'unsubscribe';
  subscriptionId: string;
}

export interface CallMessage {
  type: 'call';
  callId: string;
  path: string;
  input: unknown;
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage | CallMessage;

/**
 * Messages sent from server to client
 */
export interface SnapshotMessage {
  type: 'snapshot';
  subscriptionId: string;
  data: unknown;
}

export interface PatchMessage {
  type: 'patch';
  subscriptionId: string;
  patches: JsonPatch[];
}

export interface ResultMessage {
  type: 'result';
  callId: string;
  data: unknown;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
  subscriptionId?: string;
  callId?: string;
}

export type ServerMessage =
  | SnapshotMessage
  | PatchMessage
  | ResultMessage
  | ErrorMessage;

/**
 * Client configuration
 */
export interface ReactiveClientConfig {
  /**
   * WebSocket URL to connect to
   */
  url: string;

  /**
   * Authentication token or getter function
   */
  auth?: string | (() => string | Promise<string>);

  /**
   * Enable automatic reconnection
   * @default true
   */
  autoReconnect?: boolean;

  /**
   * Reconnection delay in milliseconds
   * @default 1000
   */
  reconnectDelay?: number;

  /**
   * Maximum reconnection attempts
   * @default 10
   */
  maxReconnectAttempts?: number;

  /**
   * Callback when connected
   */
  onConnect?: () => void;

  /**
   * Callback when disconnected
   */
  onDisconnect?: () => void;

  /**
   * Callback for errors
   */
  onError?: (error: Error) => void;
}

/**
 * Subscription options
 */
export interface SubscriptionOptions<TInput> {
  /**
   * Input for the subscription
   */
  input?: TInput;

  /**
   * Whether to automatically resubscribe on reconnect
   * @default true
   */
  resubscribeOnReconnect?: boolean;

  /**
   * Callback when data is received
   */
  onData?: (data: unknown) => void;

  /**
   * Callback when an error occurs
   */
  onError?: (error: Error) => void;
}

/**
 * Active subscription
 */
export interface Subscription<TData> {
  /**
   * Current data
   */
  data: TData | undefined;

  /**
   * Whether the subscription is loading
   */
  loading: boolean;

  /**
   * Error if any
   */
  error: Error | undefined;

  /**
   * Unsubscribe from updates
   */
  unsubscribe: () => void;

  /**
   * Manually refetch the data
   */
  refetch: () => Promise<void>;
}

/**
 * Connection state
 */
export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'reconnecting';

/**
 * Type helpers for inferring router types
 */
export type InferInput<T> = T extends { input: infer TInput }
  ? TInput
  : undefined;
export type InferOutput<T> = T extends { output: infer TOutput }
  ? TOutput
  : unknown;
