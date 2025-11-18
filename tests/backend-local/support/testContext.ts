import { vi } from "vitest";

import type { PublishedEvent } from "../../../packages/backend-local/src/adapters/WebSocketBus.js";
import type { EventBus } from "../../../packages/backend-local/src/app.js";
import type { CommandContext } from "../../../src/domain/commands/Command.js";
import { GameConfig } from "../../../src/domain/GameConfig.js";
import type { ImageGenerator } from "../../../src/domain/ports/ImageGenerator.js";
import type { Logger } from "../../../src/domain/ports/Logger.js";
import type {
  PromptAppendResult,
  RoundGateway,
  RoundState,
  ValidRoundState,
  VoteAppendResult,
} from "../../../src/domain/ports/RoundGateway.js";
import type { Scheduler } from "../../../src/domain/ports/Scheduler.js";
import type { PlayerId, RoundId, TimePoint } from "../../../src/domain/typedefs.js";

type Waiter = {
  readonly predicate: (payload: PublishedEvent) => boolean;
  readonly resolve: (payload: PublishedEvent) => void;
  readonly reject: (error: Error) => void;
  timeout?: ReturnType<typeof setTimeout>;
};

function clone<T>(value: T): T {
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }

  return JSON.parse(JSON.stringify(value)) as T;
}

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

  emit(channel: string, event: object): Promise<void> {
    return this.publish(channel, event);
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

export class FakeImageGenerator implements ImageGenerator {
  readonly generated: string[] = [];

  async generate(prompt: string): Promise<string> {
    this.generated.push(prompt);
    return `fake://image/${encodeURIComponent(prompt)}`;
  }
}

export class FakeRoundGateway implements RoundGateway {
  readonly rounds = new Map<RoundId, ValidRoundState>();
  #nextId = 1;

  async loadRoundState(roundId: RoundId): Promise<ValidRoundState> {
    const state = this.rounds.get(roundId);
    if (!state) {
      throw new Error(`Round not found: ${roundId}`);
    }
    return clone(state);
  }

  async saveRoundState(state: RoundState): Promise<void> {
    if (!this.rounds.has(state.id)) {
      throw new Error(`Round not found: ${state.id}`);
    }
    this.rounds.set(state.id, clone(state as ValidRoundState));
  }

  async appendPrompt(
    roundId: RoundId,
    playerId: PlayerId,
    prompt: string,
  ): Promise<PromptAppendResult> {
    const state = this.rounds.get(roundId);
    if (!state) {
      throw new Error(`Round not found: ${roundId}`);
    }

    state.prompts ??= {};
    const existing = state.prompts[playerId];
    if (existing !== undefined) {
      return { inserted: false, prompts: clone(state.prompts) };
    }

    state.prompts[playerId] = prompt;
    return { inserted: true, prompts: clone(state.prompts) };
  }

  async appendVote(
    roundId: RoundId,
    playerId: PlayerId,
    promptIndex: number,
  ): Promise<VoteAppendResult> {
    const state = this.rounds.get(roundId);
    if (!state) {
      throw new Error(`Round not found: ${roundId}`);
    }

    state.votes ??= {};
    const existing = state.votes[playerId];
    if (existing !== undefined) {
      return { inserted: false, votes: clone(state.votes) };
    }

    state.votes[playerId] = promptIndex;
    return { inserted: true, votes: clone(state.votes) };
  }

  async countSubmittedPrompts(roundId: RoundId): Promise<number> {
    const state = this.rounds.get(roundId);
    if (!state) {
      throw new Error(`Round not found: ${roundId}`);
    }
    return Object.keys(state.prompts ?? {}).length;
  }

  async startNewRound(
    players: readonly PlayerId[],
    activePlayer: PlayerId,
    startedAt: TimePoint,
  ): Promise<RoundState> {
    const id = `round-${this.#nextId++}` as RoundId;
    const state: ValidRoundState = {
      id,
      players: [...players],
      activePlayer,
      phase: "prompt",
      prompts: {},
      seed: this.#nextId,
      startedAt,
    };
    this.rounds.set(id, clone(state));
    return clone(state);
  }
}

export function createLoggerMock(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } satisfies Logger;
}

export interface BackendTestContext {
  readonly gateway: FakeRoundGateway;
  readonly bus: FakeBus;
  readonly scheduler: FakeScheduler;
  readonly imageGenerator: FakeImageGenerator;
  readonly config: GameConfig;
  readonly logger: Logger;
}

export interface TestContextOverrides {
  readonly config?: GameConfig;
  readonly logger?: Logger;
}

export function createTestContext(
  overrides: TestContextOverrides = {},
): BackendTestContext {
  const context: BackendTestContext = {
    gateway: new FakeRoundGateway(),
    bus: new FakeBus(),
    scheduler: new FakeScheduler(),
    imageGenerator: new FakeImageGenerator(),
    config:
      overrides.config ??
      new GameConfig({
        minPlayers: 1,
        maxPlayers: 6,
        promptDurationMs: 10_000,
        guessingDurationMs: 20_000,
        votingDurationMs: 30_000,
      }),
    logger: overrides.logger ?? createLoggerMock(),
  };

  return context;
}

export function createCommandContextFactory(
  context: BackendTestContext,
): () => CommandContext {
  return (): CommandContext => ({
    gateway: context.gateway,
    bus: context.bus,
    imageGenerator: context.imageGenerator,
    scheduler: context.scheduler,
    config: context.config,
    logger: context.logger,
  });
}
