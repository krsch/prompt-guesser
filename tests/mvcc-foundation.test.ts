import { describe, expect, it, vi } from "vitest";

import { InMemoryGameStore } from "../src/adapters/in-memory/InMemoryGameStore.js";
import { createGameConfig } from "../src/domain/GameConfig.js";
import { CommandError, StateFailureError } from "../src/mvcc/errors.js";
import type { GameStore, GameStoreUpdateResult } from "../src/mvcc/GameStore.js";
import type { GameReactor, GameReactorContext } from "../src/mvcc/reactors.js";
import { runGameCommand } from "../src/mvcc/runGameCommand.js";
import type {
  CommandResult,
  GameCommand,
  GameId,
  GameState,
  RoundState,
} from "../src/mvcc/types.js";

describe("InMemoryGameStore", () => {
  it("creates initial state via factory and returns change for ok result", async () => {
    const store = new InMemoryGameStore();
    const initial = makeGameState({ id: "game-new" as GameId });
    await store.createGame(initial);

    const command: GameCommand = {
      type: "Noop",
      apply: (state) => ({ kind: "ok", state }),
    };

    const result = await store.updateGame("game-new" as GameId, command.apply);

    if (result.kind !== "ok") {
      throw new Error("Expected ok result");
    }

    expect(result.change).toEqual({
      before: initial,
      after: initial,
    });
  });

  it("returns rejected without persisting changes", async () => {
    const store = new InMemoryGameStore();
    const initial = makeGameState();
    const error = new CommandError("rejected");

    await store.createGame(initial);

    const result = await store.updateGame(initial.id, () => ({
      kind: "rejected",
      error,
    }));

    expect(result).toEqual({ kind: "rejected", error });

    const followUp = await store.updateGame(initial.id, (state) => ({
      kind: "ok",
      state: state,
    }));

    if (followUp.kind !== "ok") {
      throw new Error("Expected follow-up write to succeed");
    }

    expect(followUp.change.before).toEqual(initial);
  });

  it("persists failedRound results and returns change snapshot", async () => {
    const store = new InMemoryGameStore();
    const initial = makeGameState();
    const error = new StateFailureError("round failed");

    await store.createGame(initial);

    const currentRound = initial.currentRound;
    if (!currentRound) {
      throw new Error("Expected current round to exist in test state");
    }

    const failedRoundState: GameState = {
      ...initial,
      currentRound: {
        ...currentRound,
        state: { ...currentRound.state, phase: "failed" },
      },
    };

    const result = await store.updateGame(initial.id, () => ({
      kind: "failedRound",
      state: failedRoundState,
      error,
    }));

    if (result.kind !== "failedRound") {
      throw new Error("Expected failedRound result");
    }

    expect(result.change.before).toEqual(initial);
    expect(result.change.after).toEqual(failedRoundState);
    expect(result.error).toBe(error);
  });
});

describe("runGameCommand", () => {
  it("sends direct error and skips reactors when command is rejected", async () => {
    const command: GameCommand = {
      type: "RejectingCommand",
      apply: vi.fn(
        (): CommandResult => ({
          kind: "ok",
          state: makeGameState(),
        }),
      ),
    };

    const error = new CommandError("nope");
    const store: GameStore = {
      loadGame: async () => makeGameState(),
      createGame: async () => {
        /* noop for test */
      },
      updateGame: vi.fn(async (_id, applyFn) => {
        applyFn(makeGameState());
        return { kind: "rejected" as const, error };
      }),
    };

    const reactor: GameReactor = { handle: vi.fn(async () => {}) };
    const ctx = makeReactorContext();

    const returnedError = await runGameCommand(
      "game-1" as GameId,
      command,
      store,
      [reactor],
      ctx,
    );

    expect(store.updateGame).toHaveBeenCalledTimes(1);
    expect(command.apply).toHaveBeenCalledTimes(1);
    expect(returnedError).toBe(error);
    expect(reactor.handle).not.toHaveBeenCalled();
  });

  it("dispatches reactors for ok results", async () => {
    const store = new InMemoryGameStore();
    const initial = makeGameState();
    await store.createGame(initial);

    const nextState: GameState = {
      ...initial,
      lobby: { ...initial.lobby, players: [...initial.lobby.players, "p3"] },
    };

    const command: GameCommand = {
      type: "AddPlayer",
      apply: (): CommandResult => ({ kind: "ok", state: nextState }),
    };

    const reactor: GameReactor = { handle: vi.fn(async () => {}) };
    const ctx = makeReactorContext();

    await runGameCommand(initial.id, command, store, [reactor], ctx);

    expect(reactor.handle).toHaveBeenCalledTimes(1);
    expect(reactor.handle).toHaveBeenCalledWith(
      { before: initial, after: nextState },
      ctx,
      "ok",
    );
  });

  it("propagates failedRound to reactors", async () => {
    const initial = makeGameState();
    const currentRound = initial.currentRound;
    if (!currentRound) {
      throw new Error("Expected current round to exist in test state");
    }

    const failedState: GameState = {
      ...initial,
      currentRound: {
        ...currentRound,
        state: { ...currentRound.state, phase: "failed" },
      },
    };

    const storeResult: GameStoreUpdateResult = {
      kind: "failedRound",
      change: { before: initial, after: failedState },
      error: new StateFailureError("round failed"),
    };

    const store: GameStore = {
      loadGame: async () => initial,
      createGame: async () => {
        /* noop for test */
      },
      updateGame: vi.fn(async (_id, applyFn) => {
        applyFn(initial);
        return storeResult;
      }),
    };

    const reactor: GameReactor = { handle: vi.fn(async () => {}) };
    const ctx = makeReactorContext();
    const command: GameCommand = {
      type: "Failing",
      apply: (): CommandResult => ({
        kind: "failedRound",
        state: failedState,
        error: storeResult.error,
      }),
    };

    await runGameCommand(initial.id, command, store, [reactor], ctx);

    expect(reactor.handle).toHaveBeenCalledTimes(1);
    expect(reactor.handle).toHaveBeenCalledWith(storeResult.change, ctx, "failedRound");
  });
});

function makeRoundState(overrides: Partial<RoundState> = {}): RoundState {
  const base: RoundState = {
    id: "round-1",
    players: ["p1", "p2"],
    activePlayer: "p1",
    phase: "prompt",
    seed: 1,
    startedAt: 1,
    prompts: {},
    votes: {},
    scores: {},
    shuffleOrder: [],
  };

  return { ...base, ...overrides };
}

function makeGameState(overrides: Partial<GameState> = {}): GameState {
  const round = makeRoundState();
  const base: GameState = {
    id: "game-1",
    lobby: {
      host: "p1",
      players: ["p1", "p2"],
      config: createGameConfig(),
    },
    currentRound: { id: round.id, state: round },
  };

  return { ...base, ...overrides };
}

function makeReactorContext(
  overrides: Partial<GameReactorContext> = {},
): GameReactorContext {
  const base: GameReactorContext = {
    bus: { publish: vi.fn(async () => {}) },
    scheduler: { scheduleTimeout: vi.fn(async () => {}) },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };

  return { ...base, ...overrides };
}
