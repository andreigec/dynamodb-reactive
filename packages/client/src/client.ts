import { applyPatches } from './patcher.js';
import type {
  ConnectionState,
  JsonPatch,
  ReactiveClientConfig,
  ServerMessage,
  Subscription,
  SubscriptionOptions,
} from './types.js';
import { WebSocketManager } from './websocket.js';

/**
 * Generate a unique subscription ID
 */
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Internal subscription state
 */
interface SubscriptionState<TData> {
  id: string;
  path: string;
  input: unknown;
  data: TData | undefined;
  loading: boolean;
  error: Error | undefined;
  listeners: Set<() => void>;
  options: SubscriptionOptions<unknown>;
}

/**
 * Pending call state
 */
interface PendingCall {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Reactive client for type-safe subscriptions
 */
export class ReactiveClient {
  private wsManager: WebSocketManager;
  private subscriptions = new Map<string, SubscriptionState<unknown>>();
  private pendingCalls = new Map<string, PendingCall>();
  private connectionState: ConnectionState = 'disconnected';
  private stateListeners = new Set<(state: ConnectionState) => void>();

  constructor(config: ReactiveClientConfig) {
    this.wsManager = new WebSocketManager(config);

    // Handle incoming messages
    this.wsManager.onMessage((message) => this.handleMessage(message));

    // Handle connection state changes
    this.wsManager.onStateChange((state) => {
      this.connectionState = state;
      this.notifyStateListeners();

      if (state === 'connected') {
        this.resubscribeAll();
      }
    });
  }

  /**
   * Connect to the server
   */
  async connect(): Promise<void> {
    await this.wsManager.connect();
  }

  /**
   * Disconnect from the server
   */
  disconnect(): void {
    this.wsManager.disconnect();
  }

  /**
   * Get current connection state
   */
  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  /**
   * Subscribe to connection state changes
   */
  onConnectionStateChange(
    listener: (state: ConnectionState) => void,
  ): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /**
   * Subscribe to a procedure
   */
  subscribe<TData>(
    path: string,
    options: SubscriptionOptions<unknown> = {},
  ): Subscription<TData> {
    const id = generateId();

    const state: SubscriptionState<TData> = {
      id,
      path,
      input: options.input,
      data: undefined,
      loading: true,
      error: undefined,
      listeners: new Set(),
      options,
    };

    this.subscriptions.set(id, state as SubscriptionState<unknown>);

    // Send subscribe message
    this.wsManager.send({
      type: 'subscribe',
      subscriptionId: id,
      path,
      input: options.input,
    });

    const subscription: Subscription<TData> = {
      get data() {
        return state.data;
      },
      get loading() {
        return state.loading;
      },
      get error() {
        return state.error;
      },
      unsubscribe: () => this.unsubscribe(id),
      refetch: () => this.refetch(id),
    };

    return subscription;
  }

  /**
   * Call a mutation procedure
   */
  async call<TInput, TOutput>(path: string, input: TInput): Promise<TOutput> {
    const callId = generateId();

    return new Promise<TOutput>((resolve, reject) => {
      this.pendingCalls.set(callId, {
        resolve: resolve as (data: unknown) => void,
        reject,
      });

      this.wsManager.send({
        type: 'call',
        callId,
        path,
        input,
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingCalls.has(callId)) {
          this.pendingCalls.delete(callId);
          reject(new Error('Call timeout'));
        }
      }, 30000);
    });
  }

  /**
   * Unsubscribe from a subscription
   */
  private unsubscribe(id: string): void {
    const state = this.subscriptions.get(id);
    if (!state) return;

    this.subscriptions.delete(id);

    this.wsManager.send({
      type: 'unsubscribe',
      subscriptionId: id,
    });
  }

  /**
   * Refetch a subscription
   */
  private async refetch(id: string): Promise<void> {
    const state = this.subscriptions.get(id);
    if (!state) return;

    state.loading = true;
    this.notifySubscriptionListeners(id);

    // Re-send subscribe message to get fresh data
    this.wsManager.send({
      type: 'subscribe',
      subscriptionId: id,
      path: state.path,
      input: state.input,
    });
  }

  /**
   * Handle incoming server messages
   */
  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case 'snapshot':
        this.handleSnapshot(message.subscriptionId, message.data);
        break;

      case 'patch':
        this.handlePatch(message.subscriptionId, message.patches);
        break;

      case 'result':
        this.handleResult(message.callId, message.data);
        break;

      case 'error':
        this.handleError(message);
        break;
    }
  }

  /**
   * Handle a snapshot message
   */
  private handleSnapshot(subscriptionId: string, data: unknown): void {
    const state = this.subscriptions.get(subscriptionId);
    if (!state) return;

    state.data = data;
    state.loading = false;
    state.error = undefined;

    this.notifySubscriptionListeners(subscriptionId);
    state.options.onData?.(data);
  }

  /**
   * Handle a patch message
   */
  private handlePatch(subscriptionId: string, patches: JsonPatch[]): void {
    const state = this.subscriptions.get(subscriptionId);
    if (!state || state.data === undefined) return;

    try {
      state.data = applyPatches(state.data, patches);
      this.notifySubscriptionListeners(subscriptionId);
      state.options.onData?.(state.data);
    } catch (error) {
      state.error = error instanceof Error ? error : new Error(String(error));
      this.notifySubscriptionListeners(subscriptionId);
      state.options.onError?.(state.error);
    }
  }

  /**
   * Handle a result message
   */
  private handleResult(callId: string, data: unknown): void {
    const pending = this.pendingCalls.get(callId);
    if (!pending) return;

    this.pendingCalls.delete(callId);
    pending.resolve(data);
  }

  /**
   * Handle an error message
   */
  private handleError(message: {
    message: string;
    subscriptionId?: string;
    callId?: string;
  }): void {
    const error = new Error(message.message);

    if (message.subscriptionId) {
      const state = this.subscriptions.get(message.subscriptionId);
      if (state) {
        state.error = error;
        state.loading = false;
        this.notifySubscriptionListeners(message.subscriptionId);
        state.options.onError?.(error);
      }
    }

    if (message.callId) {
      const pending = this.pendingCalls.get(message.callId);
      if (pending) {
        this.pendingCalls.delete(message.callId);
        pending.reject(error);
      }
    }
  }

  /**
   * Resubscribe to all subscriptions after reconnect
   */
  private resubscribeAll(): void {
    for (const [id, state] of this.subscriptions) {
      if (state.options.resubscribeOnReconnect !== false) {
        state.loading = true;
        this.notifySubscriptionListeners(id);

        this.wsManager.send({
          type: 'subscribe',
          subscriptionId: id,
          path: state.path,
          input: state.input,
        });
      }
    }
  }

  /**
   * Notify subscription listeners of state changes
   */
  private notifySubscriptionListeners(id: string): void {
    const state = this.subscriptions.get(id);
    if (!state) return;

    for (const listener of state.listeners) {
      listener();
    }
  }

  /**
   * Notify connection state listeners
   */
  private notifyStateListeners(): void {
    for (const listener of this.stateListeners) {
      listener(this.connectionState);
    }
  }

  /**
   * Add a listener for subscription state changes
   * Used internally by React hooks
   */
  addSubscriptionListener(id: string, listener: () => void): () => void {
    const state = this.subscriptions.get(id);
    if (!state) return () => {};

    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  }

  /**
   * Get subscription state
   * Used internally by React hooks
   */
  getSubscriptionState<TData>(
    id: string,
  ): SubscriptionState<TData> | undefined {
    return this.subscriptions.get(id) as SubscriptionState<TData> | undefined;
  }
}

/**
 * Create a type-safe reactive client
 */
export function createReactiveClient<TRouter>(
  config: ReactiveClientConfig,
): TypedReactiveClient<TRouter> {
  const client = new ReactiveClient(config);
  return createTypedProxy(client, []) as TypedReactiveClient<TRouter>;
}

/**
 * Type-safe client proxy type
 */
export type TypedReactiveClient<TRouter> = {
  [K in keyof TRouter]: TRouter[K] extends { query: any }
    ? {
        useSubscription: <TData = unknown>(
          input?: unknown,
          options?: Omit<SubscriptionOptions<unknown>, 'input'>,
        ) => Subscription<TData>;
      }
    : TRouter[K] extends { mutation: any }
      ? {
          mutate: <TInput, TOutput>(input: TInput) => Promise<TOutput>;
        }
      : TypedReactiveClient<TRouter[K]>;
} & {
  _client: ReactiveClient;
  connect: () => Promise<void>;
  disconnect: () => void;
};

/**
 * Create a typed proxy for path-based access
 */
function createTypedProxy(client: ReactiveClient, path: string[]): unknown {
  return new Proxy(
    {},
    {
      get(_target, prop) {
        if (prop === '_client') return client;
        if (prop === 'connect') return () => client.connect();
        if (prop === 'disconnect') return () => client.disconnect();

        if (typeof prop !== 'string') return undefined;

        const newPath = [...path, prop];

        // Check if this is a subscription or mutation
        if (prop === 'useSubscription') {
          return (input?: unknown, options?: SubscriptionOptions<unknown>) => {
            const parentPath = path.join('.');
            return client.subscribe(parentPath, { ...options, input });
          };
        }

        if (prop === 'mutate') {
          return async (input: unknown) => {
            const parentPath = path.join('.');
            return client.call(parentPath, input);
          };
        }

        return createTypedProxy(client, newPath);
      },
    },
  );
}
