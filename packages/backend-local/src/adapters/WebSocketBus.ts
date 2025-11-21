/* eslint-disable functional/immutable-data */
/* eslint-disable functional/prefer-readonly-type */
import type { WebSocket } from "ws";

import type { Logger, MessageBus } from "../core.js";

export interface PublishedEvent<TEvent extends object = object> {
  readonly channel: string;
  readonly event: TEvent;
}

type Listener = {
  readonly predicate: (payload: PublishedEvent) => boolean;
  readonly resolve: (payload: PublishedEvent) => void;
  readonly reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
};

export class WebSocketBus implements MessageBus {
  #clients: Map<string, Set<WebSocket>> = new Map();
  #listeners: Set<Listener> = new Set();
  readonly #logger: Logger | undefined;

  constructor(logger?: Logger) {
    this.#logger = logger;
  }

  async publish(channel: string, event: object): Promise<void> {
    const payload: PublishedEvent = { channel, event };
    const connections = this.#clients.get(channel);

    if (connections) {
      const message = JSON.stringify(event);
      for (const socket of connections) {
        try {
          socket.send(message);
        } catch (error) {
          this.#logger?.warn?.("Failed to deliver event", {
            channel,
            error,
          });
        }
      }
    }

    const matchedListeners: Listener[] = [];
    for (const listener of this.#listeners) {
      if (listener.predicate(payload)) {
        matchedListeners.push(listener);
      }
    }

    for (const listener of matchedListeners) {
      if (listener.timeout) {
        clearTimeout(listener.timeout);
      }
      this.#listeners.delete(listener);
      listener.resolve(payload);
    }

    this.#logger?.debug?.("Event published", { channel, event });
  }

  attach(channel: string, socket: WebSocket): void {
    let connections = this.#clients.get(channel);
    if (!connections) {
      connections = new Set<WebSocket>();
      this.#clients.set(channel, connections);
    }
    connections.add(socket);

    this.#logger?.info?.("WebSocket client attached", {
      channel,
      size: connections.size,
    });

    socket.on("close", () => {
      const currentConnections = this.#clients.get(channel);
      if (!currentConnections) {
        return;
      }
      currentConnections.delete(socket);
      if (currentConnections.size === 0) {
        this.#clients.delete(channel);
      }
      this.#logger?.info?.("WebSocket client disconnected", {
        channel,
        size: currentConnections.size,
      });
    });

    socket.on("error", (error: Error) => {
      this.#logger?.warn?.("WebSocket client error", { channel, error });
    });
  }

  waitFor(predicate: Listener["predicate"], timeoutMs = 5000): Promise<PublishedEvent> {
    return new Promise<PublishedEvent>((resolve, reject) => {
      const listener: Listener = { predicate, resolve, reject };

      if (timeoutMs > 0) {
        listener.timeout = setTimeout(() => {
          this.#listeners.delete(listener);
          reject(new Error("Timed out waiting for event"));
        }, timeoutMs);
      }

      this.#listeners.add(listener);
    });
  }
}
