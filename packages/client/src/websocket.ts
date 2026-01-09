/* eslint-disable no-console */
import type {
  ClientMessage,
  ConnectionState,
  ReactiveClientConfig,
  ServerMessage,
} from './types.js';

/**
 * WebSocket manager with automatic reconnection
 */
export class WebSocketManager {
  private config: Required<
    Omit<
      ReactiveClientConfig,
      'auth' | 'onConnect' | 'onDisconnect' | 'onError'
    >
  > &
    ReactiveClientConfig;
  private ws: WebSocket | null = null;
  private state: ConnectionState = 'disconnected';
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private messageQueue: ClientMessage[] = [];
  private messageHandlers = new Set<(message: ServerMessage) => void>();
  private stateHandlers = new Set<(state: ConnectionState) => void>();

  constructor(config: ReactiveClientConfig) {
    this.config = {
      autoReconnect: true,
      reconnectDelay: 1000,
      maxReconnectAttempts: 10,
      ...config,
    };
  }

  /**
   * Get current connection state
   */
  getState(): ConnectionState {
    return this.state;
  }

  /**
   * Connect to the WebSocket server
   */
  async connect(): Promise<void> {
    if (this.state === 'connected' || this.state === 'connecting') {
      return;
    }

    this.setState('connecting');

    try {
      const url = await this.buildUrl();
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.setState('connected');
        this.reconnectAttempts = 0;
        this.flushMessageQueue();
        this.config.onConnect?.();
      };

      this.ws.onclose = (event) => {
        this.ws = null;
        this.setState('disconnected');
        this.config.onDisconnect?.();

        if (this.config.autoReconnect && !event.wasClean) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = () => {
        const error = new Error('WebSocket error');
        this.config.onError?.(error);
      };

      this.ws.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data) as ServerMessage;
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse WebSocket message:', error);
        }
      };
    } catch (error) {
      this.setState('disconnected');
      this.config.onError?.(
        error instanceof Error ? error : new Error(String(error)),
      );

      if (this.config.autoReconnect) {
        this.scheduleReconnect();
      }
    }
  }

  /**
   * Disconnect from the WebSocket server
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.setState('disconnected');
  }

  /**
   * Send a message to the server
   */
  send(message: ClientMessage): void {
    // Check both our state and the actual WebSocket readyState
    if (this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      // Queue message for when we reconnect
      this.messageQueue.push(message);
    }
  }

  /**
   * Subscribe to incoming messages
   */
  onMessage(handler: (message: ServerMessage) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /**
   * Subscribe to connection state changes
   */
  onStateChange(handler: (state: ConnectionState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => this.stateHandlers.delete(handler);
  }

  private async buildUrl(): Promise<string> {
    let url = this.config.url;

    if (this.config.auth) {
      const token =
        typeof this.config.auth === 'function'
          ? await this.config.auth()
          : this.config.auth;

      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}token=${encodeURIComponent(token)}`;
    }

    return url;
  }

  private setState(state: ConnectionState): void {
    this.state = state;
    for (const handler of this.stateHandlers) {
      handler(state);
    }
  }

  private handleMessage(message: ServerMessage): void {
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error('Max reconnection attempts reached');
      return;
    }

    this.setState('reconnecting');
    this.reconnectAttempts++;

    // Exponential backoff with jitter
    const delay =
      Math.min(
        this.config.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
        30000, // Max 30 seconds
      ) *
      (0.5 + Math.random() * 0.5);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private flushMessageQueue(): void {
    const queue = this.messageQueue;
    this.messageQueue = [];

    for (const message of queue) {
      this.send(message);
    }
  }
}
