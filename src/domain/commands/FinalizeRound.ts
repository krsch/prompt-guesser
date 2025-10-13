import type { Logger } from "../ports/Logger.js";
import type { MessageBus } from "../ports/MessageBus.js";
import type { RoundGateway, RoundState } from "../ports/RoundGateway.js";
import type { PlayerId, TimePoint } from "../typedefs.js";

export async function finalizeRound(
  state: RoundState,
  at: TimePoint,
  gateway: RoundGateway,
  bus: MessageBus,
  logger?: Logger,
  source: string = "FinalizeRound",
): Promise<void> {
  const shuffledPrompts = state.shuffledPrompts;
  const shuffledPromptOwners = state.shuffledPromptOwners;

  if (!shuffledPrompts || !shuffledPromptOwners) {
    throw new Error("Cannot finalize round without shuffled prompts");
  }

  if (shuffledPrompts.length !== shuffledPromptOwners.length) {
    throw new Error("Shuffled prompts and owners length mismatch");
  }

  const scores: Record<PlayerId, number> = Object.fromEntries(
    state.players.map((playerId) => [playerId, 0]),
  );

  const votes = state.votes;
  if (!votes) {
    throw new Error("Cannot finalize round without recorded votes");
  }

  const voteEntries = Object.entries(votes) as [PlayerId, number][];

  const realPromptIndex = shuffledPromptOwners.findIndex(
    (ownerId) => ownerId === state.activePlayer,
  );

  if (realPromptIndex === -1) {
    throw new Error("Active player's prompt missing from shuffled prompts");
  }

  let correctGuesses = 0;
  for (const [voterId, voteIndex] of voteEntries) {
    if (!state.players.includes(voterId)) {
      throw new Error(`Vote recorded for unknown player ${voterId}`);
    }

    if (voterId === state.activePlayer) {
      throw new Error("Active player cannot vote in their own round");
    }

    if (!Number.isInteger(voteIndex) || voteIndex < 0 || voteIndex >= shuffledPrompts.length) {
      throw new Error(`Invalid vote index recorded for player ${voterId}`);
    }

    if (voteIndex === realPromptIndex) {
      scores[voterId] += 3;
      correctGuesses += 1;
      continue;
    }

    const ownerId = shuffledPromptOwners[voteIndex];
    if (!Object.prototype.hasOwnProperty.call(scores, ownerId)) {
      throw new Error(`Vote recorded for unknown prompt owner ${ownerId}`);
    }

    scores[ownerId] += 1;
  }

  const totalVotes = voteEntries.length;

  if (totalVotes > 0 && (correctGuesses === 0 || correctGuesses === totalVotes)) {
    for (const [voterId] of voteEntries) {
      scores[voterId] += 2;
    }
  } else if (correctGuesses > 0 && correctGuesses < totalVotes) {
    scores[state.activePlayer] += 3;
  }

  state.scores = scores;
  state.phase = "scoring";

  await gateway.saveRoundState(state);
  logger?.info?.("Round entering scoring", {
    roundId: state.id,
    at,
    type: source,
    phase: state.phase,
  });

  await bus.publish(`round:${state.id}`, {
    type: "PhaseChanged",
    phase: state.phase,
    at,
  });

  state.phase = "finished";
  state.finishedAt = at;

  await gateway.saveRoundState(state);

  logger?.info?.("Round finished", {
    roundId: state.id,
    at,
    type: source,
  });

  await bus.publish(`round:${state.id}`, {
    type: "RoundFinished",
    roundId: state.id,
    at,
    scores,
  });
}
