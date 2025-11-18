import { describe, expect, it, vi } from "vitest";
import type { WebSocket } from "ws";

import { WebSocketBus } from "../../packages/backend-local/src/adapters/WebSocketBus.js";

interface FakeSocket {
  readonly socket: WebSocket;
  readonly send: ReturnType<typeof vi.fn>;
  emit(event: string, ...args: unknown[]): void;
}

function createFakeSocket(): FakeSocket {
  const handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  const send = vi.fn();
  const socket = {
    readyState: 1,
    send,
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      const list = handlers.get(event) ?? [];
      list.push(handler);
      handlers.set(event, list);
      return socket;
    }),
  };

  return {
    socket: socket as unknown as WebSocket,
    send,
    emit(event: string, ...args: unknown[]): void {
      const list = handlers.get(event);
      if (!list) {
        return;
      }
      for (const handler of list) {
        handler(...args);
      }
    },
  } satisfies FakeSocket;
}

describe("WebSocketBus", () => {
  it("delivers published events to attached sockets", async () => {
    const bus = new WebSocketBus();
    const clientA = createFakeSocket();
    const clientB = createFakeSocket();

    bus.attach("round:test", clientA.socket);
    bus.attach("round:test", clientB.socket);

    await bus.publish("round:test", { type: "PhaseChanged", phase: "guessing" });

    expect(clientA.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "PhaseChanged", phase: "guessing" }),
    );
    expect(clientB.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "PhaseChanged", phase: "guessing" }),
    );
  });

  it("supports waiting for matching events", async () => {
    const bus = new WebSocketBus();

    const waitPromise = bus.waitFor(
      ({ event }) => (event as { type?: string }).type === "TargetEvent",
      1000,
    );

    await bus.publish("round:test", { type: "OtherEvent" });
    await bus.publish("round:test", { type: "TargetEvent", payload: 42 });

    await expect(waitPromise).resolves.toMatchObject({
      channel: "round:test",
      event: { type: "TargetEvent", payload: 42 },
    });
  });

  it("removes closed sockets", async () => {
    const bus = new WebSocketBus();
    const client = createFakeSocket();

    bus.attach("round:test", client.socket);
    client.emit("close");

    await bus.publish("round:test", { type: "AfterClose" });

    expect(client.send).not.toHaveBeenCalled();
  });
});
