/* eslint-disable functional/immutable-data */
/* eslint-disable functional/prefer-readonly-type */
import type { Logger, MessageBus } from "../core.js";

export class DurableObjectBus implements MessageBus {
  readonly #connections: Set<WebSocket> = new Set();
  readonly #logger: Logger | undefined;
  #gameChannel: string | null = null;

  constructor(logger?: Logger) {
    this.#logger = logger;
  }

  setChannel(gameId: string): void {
    this.#gameChannel = `game:${gameId}`;
  }

  addConnection(socket: WebSocket): void {
    this.#connections.add(socket);
    socket.addEventListener("close", () => {
      this.#connections.delete(socket);
    });
    socket.addEventListener("error", (event) => {
      this.#logger?.warn?.("WebSocket connection error", { event });
    });
    this.#logger?.info?.("WebSocket client connected", {
      connections: this.#connections.size,
    });
  }

  async publish(channel: string, event: object): Promise<void> {
    if (!this.#gameChannel || channel !== this.#gameChannel) {
      return;
    }

    const message = JSON.stringify(event);
    for (const socket of this.#connections) {
      try {
        socket.send(message);
      } catch (error) {
        this.#logger?.warn?.("Failed to send message", { error });
      }
    }
  }
}
