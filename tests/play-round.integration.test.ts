import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { InMemoryRoundGateway } from "../src/adapters/in-memory/InMemoryRoundGateway.js";
import { StartNewRound } from "../src/domain/commands/StartNewRound.js";
import { SubmitDecoy } from "../src/domain/commands/SubmitDecoy.js";
import { SubmitPrompt } from "../src/domain/commands/SubmitPrompt.js";
import { SubmitVote } from "../src/domain/commands/SubmitVote.js";
import {
  getShuffledPrompts,
  promptIndexToPlayerId,
} from "../src/domain/entities/RoundRules.js";
import { GameConfig } from "../src/domain/GameConfig.js";
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

    const gateway = new InMemoryRoundGateway();
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

    const config = GameConfig.withDefaults();

    const startedAt = Date.UTC(2024, 4, 20, 12, 0, 0);

    await new StartNewRound(players, activePlayer, startedAt).execute({
      gateway,
      bus,
      imageGenerator,
      config,
      scheduler,
    });

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
    ).execute({
      gateway,
      bus,
      imageGenerator,
      config,
      scheduler,
    });

    const guessingEvents = events.filter((entry) => entry.event.type === "PhaseChanged");
    expect(guessingEvents.some((entry) => entry.event["phase"] === "guessing")).toBe(
      true,
    );

    await new SubmitDecoy(
      roundId,
      players[1],
      "A dog painting",
      promptTime + 1_000,
    ).execute({
      gateway,
      bus,
      imageGenerator,
      config,
      scheduler,
    });
    await new SubmitDecoy(
      roundId,
      players[2],
      "A rabbit skiing",
      promptTime + 2_000,
    ).execute({
      gateway,
      bus,
      imageGenerator,
      config,
      scheduler,
    });
    await new SubmitDecoy(
      roundId,
      players[3],
      "A turtle surfing",
      promptTime + 3_000,
    ).execute({
      gateway,
      bus,
      imageGenerator,
      config,
      scheduler,
    });

    const roundStateAfterPrompts = await gateway.loadRoundState(roundId);
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
    ).execute({
      gateway,
      bus,
      imageGenerator,
      config,
      scheduler,
    });
    await new SubmitVote(
      roundId,
      players[2],
      voteIndexForPrompt("A turtle surfing"),
      promptTime + 6_000,
    ).execute({
      gateway,
      bus,
      imageGenerator,
      config,
      scheduler,
    });
    await new SubmitVote(
      roundId,
      players[3],
      voteIndexForPrompt("A dog painting"),
      promptTime + 7_000,
    ).execute({
      gateway,
      bus,
      imageGenerator,
      config,
      scheduler,
    });

    const finalState = await gateway.loadRoundState(roundId);
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

    expect(phases).toEqual(["guessing", "voting", "scoring"]);

    expect(
      events.some(
        (entry) =>
          entry.event.type === "RoundFinished" && entry.event["roundId"] === roundId,
      ),
    ).toBe(true);
    seedSpy.mockRestore();
  });
});
