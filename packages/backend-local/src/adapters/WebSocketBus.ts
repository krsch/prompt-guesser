import type { Logger } from "@prompt-guesser/core/domain/ports/Logger.js";
import type { MessageBus } from "@prompt-guesser/core/domain/ports/MessageBus.js";
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
  // eslint-disable-next-line functional/prefer-readonly-type
  #clients: ReadonlyMap<string, ReadonlySet<WebSocket>> = new Map();
  // eslint-disable-next-line functional/prefer-readonly-type
  #listeners: ReadonlySet<Listener> = new Set();
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

    for (const listener of Array.from(this.#listeners)) {
      if (listener.predicate(payload)) {
        if (listener.timeout) {
          clearTimeout(listener.timeout);
        }
        const remainingListeners = new Set(
          [...this.#listeners].filter((existing) => existing !== listener),
        );
        // eslint-disable-next-line functional/immutable-data
        this.#listeners = remainingListeners;
        listener.resolve(payload);
      }
    }

    this.#logger?.debug?.("Event published", { channel, event });
  }

  attach(channel: string, socket: WebSocket): void {
    const existingConnections = this.#clients.get(channel) ?? new Set<WebSocket>();
    const nextConnections = new Set([...existingConnections, socket]);
    const clientsWithoutChannel = new Map(
      [...this.#clients.entries()].filter(([existingChannel]) => existingChannel !== channel),
    );
    const nextClients = new Map([
      ...clientsWithoutChannel.entries(),
      [channel, nextConnections] as const,
    ]);
    // eslint-disable-next-line functional/immutable-data
    this.#clients = nextClients;

    this.#logger?.info?.("WebSocket client attached", {
      channel,
      size: nextConnections.size,
    });

    socket.on("close", () => {
      const currentConnections = this.#clients.get(channel);
      if (!currentConnections) {
        return;
      }
      const reducedConnections = new Set([...currentConnections].filter((client) => client !== socket));
      const clientsWithoutChannel = new Map(
        [...this.#clients.entries()].filter(([existingChannel]) => existingChannel !== channel),
      );
      const updatedClients =
        reducedConnections.size === 0
          ? clientsWithoutChannel
          : new Map([
              ...clientsWithoutChannel.entries(),
              [channel, reducedConnections] as const,
            ]);
      // eslint-disable-next-line functional/immutable-data
      this.#clients = updatedClients;
      this.#logger?.info?.("WebSocket client disconnected", {
        channel,
        size: reducedConnections.size,
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
              const remaining = new Set(
                [...this.#listeners].filter((existing) => existing !== listener),
              );
              // eslint-disable-next-line functional/immutable-data
              this.#listeners = remaining;
              reject(new Error("Timed out waiting for event"));
            }, timeoutMs)
          : undefined;

      listener = timeout
        ? { predicate, resolve, reject, timeout }
        : { predicate, resolve, reject };

      const listeners = new Set([...this.#listeners, listener]);
      // eslint-disable-next-line functional/immutable-data
      this.#listeners = listeners;
    });
  }
}
