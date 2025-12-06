import { describe, expect, it, vi } from "vitest";

import { InMemoryGameStore } from "../src/adapters/in-memory/InMemoryGameStore.js";
import { createGameConfig } from "../src/domain/GameConfig.js";
import { CommandError, StateFailureError } from "../src/mvcc/errors.js";
import { GameService } from "../src/mvcc/GameService.js";
import type { GameReactor, GameReactorContextBase } from "../src/mvcc/reactors.js";
import type { GameCommand, GameId, GameState } from "../src/mvcc/types.js";

describe("GameService", () => {
  it("runs commands through the store and reactors", async () => {
    const store = new InMemoryGameStore();
    const initial = makeInitialState("game-1");
    await store.createGame(initial);

    const nextState: GameState = {
      ...initial,
      lobby: { ...initial.lobby, players: [...initial.lobby.players, "p3"] },
    };

    const command: GameCommand = {
      type: "AddPlayer",
      apply: () => ({ kind: "ok", state: nextState }),
    };

    const ctx = makeReactorContext();
    const reactor: GameReactor = { handle: vi.fn(async () => {}) };
    const service = new GameService({ store, reactors: [reactor], reactorContext: ctx });

    await service.run(initial.id, command);

    expect(reactor.handle).toHaveBeenCalledTimes(1);
    expect(reactor.handle).toHaveBeenCalledWith(
      { before: initial, after: nextState },
      expect.objectContaining({
        bus: ctx.bus,
        scheduler: ctx.scheduler,
        logger: ctx.logger,
        service: expect.any(Object),
      }),
      "ok",
    );
  });

  it("throws when command is rejected", async () => {
    const store = new InMemoryGameStore();
    const initial = makeInitialState("game-2");
    await store.createGame(initial);

    const command: GameCommand = {
      type: "Rejecting",
      apply: () => ({ kind: "rejected", error: new CommandError("nope") }),
    };

    const ctx = makeReactorContext();
    const reactor: GameReactor = { handle: vi.fn(async () => {}) };
    const service = new GameService({ store, reactors: [reactor], reactorContext: ctx });

    await expect(service.run(initial.id, command)).rejects.toBeInstanceOf(CommandError);
    expect(reactor.handle).not.toHaveBeenCalled();
  });

  it("throws when command fails a round but still runs reactors", async () => {
    const store = new InMemoryGameStore();
    const initial = makeInitialState("game-3");
    await store.createGame(initial);

    const failure = new StateFailureError("round failed");
    const command: GameCommand = {
      type: "Failing",
      apply: () => ({ kind: "failedRound", state: initial, error: failure }),
    };

    const ctx = makeReactorContext();
    const reactor: GameReactor = { handle: vi.fn(async () => {}) };
    const service = new GameService({ store, reactors: [reactor], reactorContext: ctx });

    await expect(service.run(initial.id, command)).rejects.toBe(failure);
    expect(reactor.handle).toHaveBeenCalledTimes(1);
    const changeArg = (reactor.handle as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(changeArg?.before).toEqual(initial);
    expect(changeArg?.after.currentRound?.state.phase).toBe("failed");
  });
});

function makeReactorContext(): GameReactorContextBase {
  return {
    bus: { publish: async (): Promise<void> => {} },
    scheduler: {
      scheduleTimeout: async (): Promise<void> => {},
    },
    logger: {
      info: (): void => {},
      warn: (): void => {},
      error: (): void => {},
    },
  };
}

function makeInitialState(gameId: GameId): GameState {
  const round = {
    id: "round-1" as const,
    players: ["p1"],
    activePlayer: "p1",
    phase: "prompt" as const,
    seed: 1,
    startedAt: 1,
  };
  return {
    id: gameId,
    lobby: {
      host: "p1",
      players: ["p1"],
      config: createGameConfig(),
    },
    currentRound: { id: round.id, state: round },
  };
}
