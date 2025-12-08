import { describe, expect, it } from "vitest";

import { DurableObjectGameStore } from "../src/adapters/DurableObjectGameStore.js";
import { NotFoundError, type GameState } from "../src/core.js";
import {
  createFakeDurableObjectState,
  FakeDurableObjectStorage,
} from "./support/fakes.js";

const GAME_ID = "game-123";

function createState(): GameState {
  return {
    id: GAME_ID,
    lobby: {
      host: "host",
      players: ["host"],
      config: {
        totalRounds: 3,
        promptDurationMs: 1_000,
        guessingDurationMs: 2_000,
        votingDurationMs: 3_000,
      },
    },
  };
}

describe("DurableObjectGameStore", () => {
  it("throws when the game is missing", async () => {
    const store = new DurableObjectGameStore(createFakeDurableObjectState());
    await expect(store.loadGame(GAME_ID)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("creates and clones game state", async () => {
    const storage = new FakeDurableObjectStorage();
    const store = new DurableObjectGameStore(createFakeDurableObjectState(storage));

    const initial = createState();
    await store.createGame(initial);

    const loaded = await store.loadGame(GAME_ID);
    expect(loaded).toEqual(initial);

    // Mutating the loaded state should not leak into storage
    (loaded.lobby as unknown as { players: string[] }).players.push("intruder");
    const reloaded = await store.loadGame(GAME_ID);
    expect(reloaded.lobby.players).toEqual(["host"]);
  });

  it("applies updates and reports changes", async () => {
    const storage = new FakeDurableObjectStorage();
    const store = new DurableObjectGameStore(createFakeDurableObjectState(storage));
    await store.createGame(createState());

    const result = await store.updateGame(GAME_ID, (state) => {
      const next: GameState = {
        ...state,
        lobby: { ...state.lobby, players: [...state.lobby.players, "alice"] },
      };
      return { kind: "ok", state: next };
    });

    const saved = await store.loadGame(GAME_ID);
    expect(saved.lobby.players).toEqual(["host", "alice"]);
    expect(result).toMatchObject({
      kind: "ok",
      change: { before: expect.any(Object), after: expect.any(Object) },
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.change.before.lobby.players).toEqual(["host"]);
      expect(result.change.after.lobby.players).toEqual(["host", "alice"]);
    }
  });
});
