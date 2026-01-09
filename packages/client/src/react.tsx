/* eslint-disable no-console */
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { ReactiveClient } from './client.js';
import type {
  ConnectionState,
  ReactiveClientConfig,
  Subscription,
  SubscriptionOptions,
} from './types.js';

/**
 * Context for the reactive client
 */
const ReactiveClientContext = createContext<ReactiveClient | null>(null);

/**
 * Provider component for the reactive client
 *
 * If no config.url or client is provided, WebSocket features are disabled
 * and children are rendered without the reactive context.
 */
export function ReactiveClientProvider({
  children,
  config,
  client: externalClient,
}: {
  children: ReactNode;
  config?: ReactiveClientConfig;
  client?: ReactiveClient;
}) {
  // Extract URL for stable dependency
  const url = config?.url;
  const hasUrl = Boolean(url);

  // Always start with null to avoid hydration mismatch
  // Client will be created in useEffect after hydration
  const [client, setClient] = useState<ReactiveClient | null>(
    externalClient ?? null,
  );

  // Create client after mount (avoids hydration mismatch)
  useEffect(() => {
    // Skip if we have an external client or no URL
    if (externalClient || !url) return;

    // Create client if we don't have one
    if (!client) {
      const newClient = new ReactiveClient({ ...config, url });
      setClient(newClient);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, externalClient]);

  // Connect/disconnect effect
  useEffect(() => {
    if (!client) return;

    void client.connect();

    return () => {
      client.disconnect();
    };
  }, [client]);

  // Log warning if no URL configured (only once in dev)
  useEffect(() => {
    if (!hasUrl && process.env.NODE_ENV === 'development') {
      console.warn(
        '[dynamodb-reactive] WebSocket URL not configured, real-time features disabled',
      );
    }
  }, [hasUrl]);

  // Always render with context provider - hooks will handle null client
  return (
    <ReactiveClientContext.Provider value={client}>
      {children}
    </ReactiveClientContext.Provider>
  );
}

/**
 * Hook to get the reactive client
 * Returns null if WebSocket is not configured
 */
export function useReactiveClient(): ReactiveClient | null {
  return useContext(ReactiveClientContext);
}

/**
 * Hook to get the reactive client, throwing if not available
 */
export function useReactiveClientOrThrow(): ReactiveClient {
  const client = useContext(ReactiveClientContext);
  if (!client) {
    throw new Error(
      'useReactiveClientOrThrow must be used within a ReactiveClientProvider with a configured URL',
    );
  }
  return client;
}

/**
 * Hook to get the connection state
 * Returns 'disabled' if WebSocket is not configured
 */
export function useConnectionState(): ConnectionState | 'disabled' {
  const client = useReactiveClient();

  return useSyncExternalStore(
    (callback) => {
      if (!client) return () => {};
      return client.onConnectionStateChange(callback);
    },
    () => (client ? client.getConnectionState() : 'disabled'),
    () => 'disabled' as const,
  );
}

/**
 * Hook for reactive subscriptions
 * Returns disabled state if WebSocket is not configured
 */
export function useSubscription<TData>(
  path: string,
  options: SubscriptionOptions<unknown> = {},
): {
  data: TData | undefined;
  loading: boolean;
  error: Error | undefined;
  disabled: boolean;
  refetch: () => Promise<void>;
} {
  const client = useReactiveClient();
  const subscriptionRef = useRef<Subscription<TData> | null>(null);
  const [state, setState] = useState<{
    data: TData | undefined;
    loading: boolean;
    error: Error | undefined;
  }>({
    data: undefined,
    loading: !client ? false : true,
    error: undefined,
  });

  // Serialize options for dependency comparison
  const inputKey = JSON.stringify(options.input);
  // Store callbacks in refs to avoid re-subscribing when they change
  const onDataRef = useRef(options.onData);
  const onErrorRef = useRef(options.onError);
  onDataRef.current = options.onData;
  onErrorRef.current = options.onError;

  useEffect(() => {
    if (!client) return;

    // Parse input from inputKey to ensure we use the serialized value
    const input = inputKey ? JSON.parse(inputKey) : undefined;

    const subscription = client.subscribe<TData>(path, {
      input,
      onData: (data) => {
        setState((prev) => ({
          ...prev,
          data: data as TData,
          loading: false,
          error: undefined,
        }));
        onDataRef.current?.(data);
      },
      onError: (error) => {
        setState((prev) => ({
          ...prev,
          error,
          loading: false,
        }));
        onErrorRef.current?.(error);
      },
    });

    subscriptionRef.current = subscription;

    // Update state from subscription
    setState({
      data: subscription.data,
      loading: subscription.loading,
      error: subscription.error,
    });

    return () => {
      subscription.unsubscribe();
      subscriptionRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, path, inputKey]);

  const refetch = async () => {
    if (subscriptionRef.current) {
      setState((prev) => ({ ...prev, loading: true }));
      await subscriptionRef.current.refetch();
    }
  };

  return {
    ...state,
    disabled: !client,
    refetch,
  };
}

/**
 * Hook for mutations
 * Throws if called when WebSocket is not configured
 */
export function useMutation<TInput, TOutput>(
  path: string,
): {
  mutate: (input: TInput) => Promise<TOutput>;
  data: TOutput | undefined;
  loading: boolean;
  error: Error | undefined;
  disabled: boolean;
  reset: () => void;
} {
  const client = useReactiveClient();
  const [state, setState] = useState<{
    data: TOutput | undefined;
    loading: boolean;
    error: Error | undefined;
  }>({
    data: undefined,
    loading: false,
    error: undefined,
  });

  const mutate = async (input: TInput): Promise<TOutput> => {
    if (!client) {
      throw new Error('WebSocket not configured - mutations are disabled');
    }

    setState((prev) => ({ ...prev, loading: true, error: undefined }));

    try {
      const result = await client.call<TInput, TOutput>(path, input);
      setState({ data: result, loading: false, error: undefined });
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      setState((prev) => ({ ...prev, loading: false, error: err }));
      throw err;
    }
  };

  const reset = () => {
    setState({ data: undefined, loading: false, error: undefined });
  };

  return {
    mutate,
    ...state,
    disabled: !client,
    reset,
  };
}

/**
 * Create typed React hooks from a router type
 */
export function createReactiveHooks() {
  return {
    useSubscription: <TPath extends string, TData = unknown>(
      path: TPath,
      options?: SubscriptionOptions<unknown>,
    ) => useSubscription<TData>(path, options),

    useMutation: <TPath extends string, TInput = unknown, TOutput = unknown>(
      path: TPath,
    ) => useMutation<TInput, TOutput>(path),

    useConnectionState,
    useReactiveClient,
  };
}

/**
 * Type-safe hook creator for a specific procedure path
 */
export function createProcedureHooks<TInput, TOutput>(path: string) {
  return {
    useSubscription: (
      input?: TInput,
      options?: Omit<SubscriptionOptions<TInput>, 'input'>,
    ) => useSubscription<TOutput>(path, { ...options, input }),

    useMutation: () => useMutation<TInput, TOutput>(path),
  };
}
