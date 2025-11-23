import { vi } from "vitest";

import type { PublishedEvent } from "../../src/adapters/WebSocketBus.js";
import type { EventBus } from "../../src/app.js";
import {
  BroadcastReactor,
  GameService,
  InMemoryGameStore,
  createGameConfig,
  type GameConfig,
  type GameId,
  type RoundId,
  type GameStore,
  type Logger,
  type Scheduler,
} from "../../src/core.js";

type Waiter = {
  readonly predicate: (payload: PublishedEvent) => boolean;
  readonly resolve: (payload: PublishedEvent) => void;
  readonly reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
};

export class FakeBus implements EventBus {
  readonly events: PublishedEvent[] = [];
  readonly #waiters = new Set<Waiter>();

  async publish(channel: string, event: object): Promise<void> {
    const payload: PublishedEvent = { channel, event };
    this.events.push(payload);

    for (const waiter of [...this.#waiters]) {
      if (waiter.predicate(payload)) {
        this.#waiters.delete(waiter);
        if (waiter.timeout) {
          clearTimeout(waiter.timeout);
        }
        waiter.resolve(payload);
      }
    }
  }

  waitFor(predicate: Waiter["predicate"], timeoutMs = 5000): Promise<PublishedEvent> {
    return new Promise<PublishedEvent>((resolve, reject) => {
      const waiter: Waiter = { predicate, resolve, reject };

      if (timeoutMs > 0) {
        waiter.timeout = setTimeout(() => {
          this.#waiters.delete(waiter);
          reject(new Error("Timed out waiting for event"));
        }, timeoutMs);
      }

      this.#waiters.add(waiter);
    });
  }
}

export class FakeScheduler implements Scheduler {
  readonly scheduled: Array<{
    readonly roundId: RoundId;
    readonly phase: string;
    readonly delayMs: number;
  }> = [];

  async scheduleTimeout(roundId: RoundId, phase: string, delayMs: number): Promise<void> {
    this.scheduled.push({ roundId, phase, delayMs });
  }
}

export function createLoggerMock(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } satisfies Logger;
}

export interface BackendTestContext {
  readonly gameStore: GameStore;
  readonly service: GameService;
  readonly bus: FakeBus;
  readonly scheduler: FakeScheduler;
  readonly config: GameConfig;
  readonly logger: Logger;
  readonly gameId: GameId;
}

export function createTestContext(): BackendTestContext {
  const config = createGameConfig({
    promptDurationMs: 10_000,
    guessingDurationMs: 20_000,
    votingDurationMs: 30_000,
  });
  const bus = new FakeBus();
  const scheduler = new FakeScheduler();
  const logger = createLoggerMock();
  const gameStore = new InMemoryGameStore();
  const gameId = "game-1" as GameId;
  const initialState = {
    id: gameId,
    lobby: {
      host: "host",
      players: ["host"],
      config,
    },
  };
  const service = new GameService({
    store: gameStore,
    reactors: [new BroadcastReactor()],
    reactorContext: { bus, scheduler, logger },
  });
  void gameStore.createGame(initialState);

  return { gameStore, service, bus, scheduler, config, logger, gameId };
}
