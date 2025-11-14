import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { InMemoryGameGateway } from "../src/adapters/in-memory/InMemoryGameGateway.js";
import { InMemoryRoundGateway } from "../src/adapters/in-memory/InMemoryRoundGateway.js";
import type { CommandContext } from "../src/domain/commands/Command.js";
import { CreateGame } from "../src/domain/commands/CreateGame.js";
import { JoinGame } from "../src/domain/commands/JoinGame.js";
import { StartNextRound } from "../src/domain/commands/StartNextRound.js";
import { SubmitDecoy } from "../src/domain/commands/SubmitDecoy.js";
import { SubmitPrompt } from "../src/domain/commands/SubmitPrompt.js";
import { SubmitVote } from "../src/domain/commands/SubmitVote.js";
import {
  getShuffledPrompts,
  promptIndexToPlayerId,
} from "../src/domain/entities/RoundRules.js";
import { createGameConfig } from "../src/domain/GameConfig.js";
import type { ImageGenerator } from "../src/domain/ports/ImageGenerator.js";
import type { MessageBus } from "../src/domain/ports/MessageBus.js";
import type { Scheduler } from "../src/domain/ports/Scheduler.js";

const players = ["alex", "bailey", "casey", "devon"] as const satisfies readonly string[];
const activePlayer = players[0];

const imageGenerator: ImageGenerator = {
  async generate() {
    return "https://example.com/generated.png";
  },
};

describe("Integration: play a full round", () => {
  it("walks through prompt, guessing and voting phases", async () => {
    const seedSpy = vi
      .spyOn(webcrypto, "getRandomValues")
      .mockImplementation(<T extends ArrayBufferView>(array: T) => {
        if (array instanceof Uint32Array) {
          array[0] = 0xface_b00c;
        }
        return array;
      });

    const roundGateway = new InMemoryRoundGateway();
    const gameGateway = new InMemoryGameGateway();
    interface PublishedEvent extends Record<string, unknown> {
      readonly type: string;
    }

    const events: Array<{ channel: string; event: PublishedEvent }> = [];
    const bus: MessageBus = {
      async publish(channel, event) {
        if (typeof event !== "object" || event === null) {
          throw new Error("Event payload must be an object");
        }

        const payload = event as Record<string, unknown>;
        const type = payload["type"];
        if (typeof type !== "string") {
          throw new Error("Event payload must include a string type");
        }

        events.push({ channel, event: { ...payload, type } });
      },
    };

    const scheduler: Scheduler = {
      async scheduleTimeout(_roundId, _phase, _delayMs) {
        // Integration test advances phases explicitly by running commands; scheduled timeouts are
        // dispatched manually when needed.
      },
    };

    const config = createGameConfig({ totalRounds: 1 });

    const startedAt = Date.UTC(2024, 4, 20, 12, 0, 0);

    const baseContext = {
      roundGateway,
      gameGateway,
      bus,
      imageGenerator,
      scheduler,
    } satisfies CommandContext;

    await new CreateGame(activePlayer, config, startedAt).execute(baseContext);

    const createdEvent = events.find((entry) => entry.event.type === "GameCreated");
    const gameIdValue = createdEvent?.event["gameId"];
    if (typeof gameIdValue !== "string") {
      throw new Error("Game identifier should be a string");
    }

    const gameId = gameIdValue;

    for (const player of players.slice(1)) {
      await new JoinGame(gameId, player, startedAt + 1_000).execute(baseContext);
    }

    await new StartNextRound(gameId, startedAt).execute(baseContext);

    const roundStarted = events.find((entry) => entry.event.type === "RoundStarted");
    expect(roundStarted).toBeDefined();
    const roundIdValue = roundStarted?.event["roundId"];
    if (typeof roundIdValue !== "string") {
      throw new Error("Round identifier should be a string");
    }

    const roundId = roundIdValue;

    const promptTime = startedAt + 10_000;
    await new SubmitPrompt(
      roundId,
      activePlayer,
      "A cat playing piano",
      promptTime,
    ).execute(baseContext);

    const guessingEvents = events.filter((entry) => entry.event.type === "PhaseChanged");
    expect(guessingEvents.some((entry) => entry.event["phase"] === "guessing")).toBe(
      true,
    );

    await new SubmitDecoy(
      roundId,
      players[1],
      "A dog painting",
      promptTime + 1_000,
    ).execute(baseContext);
    await new SubmitDecoy(
      roundId,
      players[2],
      "A rabbit skiing",
      promptTime + 2_000,
    ).execute(baseContext);
    await new SubmitDecoy(
      roundId,
      players[3],
      "A turtle surfing",
      promptTime + 3_000,
    ).execute(baseContext);

    const roundStateAfterPrompts = await roundGateway.loadRoundState(roundId);
    expect(roundStateAfterPrompts.phase).toBe("voting");
    const promptsAfterShuffle = getShuffledPrompts(roundStateAfterPrompts);
    expect(new Set(promptsAfterShuffle)).toEqual(
      new Set([
        "A cat playing piano",
        "A dog painting",
        "A rabbit skiing",
        "A turtle surfing",
      ]),
    );
    const owners = promptsAfterShuffle.map((_, index) => {
      const owner = promptIndexToPlayerId(roundStateAfterPrompts, index);
      if (!owner) {
        throw new Error("Expected prompt owner to be defined");
      }

      return owner;
    });
    expect(new Set(owners)).toEqual(new Set(players));

    const voteIndexForPrompt = (prompt: string): number => {
      const index = promptsAfterShuffle.indexOf(prompt);
      expect(index).toBeGreaterThanOrEqual(0);
      return index;
    };

    await new SubmitVote(
      roundId,
      players[1],
      voteIndexForPrompt("A cat playing piano"),
      promptTime + 5_000,
    ).execute(baseContext);
    await new SubmitVote(
      roundId,
      players[2],
      voteIndexForPrompt("A turtle surfing"),
      promptTime + 6_000,
    ).execute(baseContext);
    await new SubmitVote(
      roundId,
      players[3],
      voteIndexForPrompt("A dog painting"),
      promptTime + 7_000,
    ).execute(baseContext);

    const finalState = await roundGateway.loadRoundState(roundId);
    expect(finalState.phase).toBe("finished");

    expect(finalState.scores).toEqual({
      alex: 3,
      bailey: 4,
      casey: 0,
      devon: 1,
    });
    expect(finalState.finishedAt).toBeDefined();

    const phases = events
      .filter((entry) => entry.event.type === "PhaseChanged")
      .map((entry) => entry.event["phase"]);

    expect(phases).toEqual(["guessing", "voting", "scoring", "finished"]);

    expect(
      events.some(
        (entry) =>
          entry.event.type === "RoundFinished" && entry.event["roundId"] === roundId,
      ),
    ).toBe(true);
    const finalGameState = await gameGateway.loadGameState(gameId);
    expect(finalGameState.phase).toBe("finished");
    expect(finalGameState.cumulativeScores).toEqual({
      alex: 3,
      bailey: 4,
      casey: 0,
      devon: 1,
    });

    seedSpy.mockRestore();
  });
});
