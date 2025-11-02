import type { MessageBus } from "@prompt-guesser/core/domain/ports/MessageBus.js";
import type { Logger } from "@prompt-guesser/core/domain/ports/Logger.js";
import type { WebSocket } from "ws";

export interface PublishedEvent<TEvent extends object = object> {
  readonly channel: string;
  readonly event: TEvent;
}

type Listener = {
  readonly predicate: (payload: PublishedEvent) => boolean;
  readonly resolve: (payload: PublishedEvent) => void;
  readonly reject: (error: Error) => void;
  readonly timeout?: ReturnType<typeof setTimeout>;
};

export class WebSocketBus implements MessageBus {
  readonly #clients = new Map<string, Set<WebSocket>>();
  readonly #listeners = new Set<Listener>();
  #logger: Logger | undefined;

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

    for (const listener of this.#listeners) {
      if (listener.predicate(payload)) {
        listener.timeout && clearTimeout(listener.timeout);
        this.#listeners.delete(listener);
        listener.resolve(payload);
      }
    }

    this.#logger?.debug?.("Event published", { channel, event });
  }

  attach(channel: string, socket: WebSocket): void {
    const connections = this.#clients.get(channel) ?? new Set<WebSocket>();
    connections.add(socket);
    this.#clients.set(channel, connections);

    this.#logger?.info?.("WebSocket client attached", { channel, size: connections.size });

    socket.on("close", () => {
      connections.delete(socket);
      if (connections.size === 0) {
        this.#clients.delete(channel);
      }
      this.#logger?.info?.("WebSocket client disconnected", {
        channel,
        size: connections.size,
      });
    });

    socket.on("error", (error: Error) => {
      this.#logger?.warn?.("WebSocket client error", { channel, error });
    });
  }

  waitFor(
    predicate: Listener["predicate"],
    timeoutMs = 5000,
  ): Promise<PublishedEvent> {
    return new Promise<PublishedEvent>((resolve, reject) => {
      let listener: Listener;

      const timeout =
        timeoutMs > 0
          ? setTimeout(() => {
              this.#listeners.delete(listener);
              reject(new Error("Timed out waiting for event"));
            }, timeoutMs)
          : undefined;

      listener = timeout
        ? { predicate, resolve, reject, timeout }
        : { predicate, resolve, reject };

      this.#listeners.add(listener);
    });
  }
}
