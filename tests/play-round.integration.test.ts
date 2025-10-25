import { describe, it, expect, vi } from "vitest";

import { webcrypto } from "node:crypto";

import { InMemoryRoundGateway } from "../src/adapters/in-memory/InMemoryRoundGateway";
import { GameConfig } from "../src/domain/GameConfig";
import { StartNewRound } from "../src/domain/commands/StartNewRound";
import { SubmitPrompt } from "../src/domain/commands/SubmitPrompt";
import { SubmitDecoy } from "../src/domain/commands/SubmitDecoy";
import { SubmitVote } from "../src/domain/commands/SubmitVote";
import type { MessageBus } from "../src/domain/ports/MessageBus";
import type { ImageGenerator } from "../src/domain/ports/ImageGenerator";
import type { Scheduler } from "../src/domain/ports/Scheduler";
import {
  getShuffledPrompts,
  canonicalSubmittedPlayers,
  promptIndexToPlayerId,
} from "../src/domain/entities/RoundRules.js";

const players = ["alex", "bailey", "casey", "devon"];
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
      .mockImplementation((array: Uint32Array) => {
        array[0] = 0xface_b00c;
        return array;
      });

    const gateway = new InMemoryRoundGateway();
    const events: { channel: string; event: any }[] = [];
    const bus: MessageBus = {
      async publish(channel, event) {
        events.push({ channel, event });
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
    const roundId = roundStarted!.event.roundId as string;

    const promptTime = startedAt + 10_000;
    await new SubmitPrompt(roundId, activePlayer, "A cat playing piano", promptTime).execute({
      gateway,
      bus,
      imageGenerator,
      config,
      scheduler,
    });

    const guessingEvents = events.filter((entry) => entry.event.type === "PhaseChanged");
    expect(guessingEvents.some((entry) => entry.event.phase === "guessing")).toBe(true);

    await new SubmitDecoy(roundId, players[1], "A dog painting", promptTime + 1_000).execute({
      gateway,
      bus,
      imageGenerator,
      config,
      scheduler,
    });
    await new SubmitDecoy(roundId, players[2], "A rabbit skiing", promptTime + 2_000).execute({
      gateway,
      bus,
      imageGenerator,
      config,
      scheduler,
    });
    await new SubmitDecoy(roundId, players[3], "A turtle surfing", promptTime + 3_000).execute({
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
    const owners = promptsAfterShuffle.map((_, index) =>
      promptIndexToPlayerId(roundStateAfterPrompts, index)!,
    );
    expect(new Set(owners)).toEqual(new Set(players));

    const voteIndexForPrompt = (prompt: string) => {
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

    const expectedScores = Object.fromEntries(players.map((player) => [player, 0]));
    const base = canonicalSubmittedPlayers(finalState);
    const permutation = finalState.shuffleOrder ?? [];
    const votes = finalState.votes ?? {};
    const activeBaseIndex = base.indexOf(activePlayer);
    const realPromptIndex = permutation.indexOf(activeBaseIndex);

    let correctGuesses = 0;
    for (const [voterId, index] of Object.entries(votes)) {
      if (index === realPromptIndex) {
        expectedScores[voterId]! += 3;
        correctGuesses += 1;
        continue;
      }

      const owner = base[permutation[index]!];
      expectedScores[owner]! += 1;
    }

    const totalVotes = Object.keys(votes).length;
    if (totalVotes > 0 && (correctGuesses === 0 || correctGuesses === totalVotes)) {
      for (const voterId of Object.keys(votes)) {
        expectedScores[voterId]! += 2;
      }
    } else if (correctGuesses > 0 && correctGuesses < totalVotes) {
      expectedScores[activePlayer]! += 3;
    }

    expect(finalState.scores).toEqual(expectedScores);
    expect(finalState.finishedAt).toBeDefined();

    const phases = events
      .filter((entry) => entry.event.type === "PhaseChanged")
      .map((entry) => entry.event.phase);

    expect(phases).toEqual([
      "guessing",
      "voting",
      "scoring",
    ]);

    expect(
      events.some(
        (entry) => entry.event.type === "RoundFinished" && entry.event.roundId === roundId,
      ),
    ).toBe(true);
    seedSpy.mockRestore();
  });
});
