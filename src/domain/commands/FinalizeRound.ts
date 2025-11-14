/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { canonicalSubmittedPlayers } from "../entities/RoundRules.js";
import type { GameState } from "../ports/GameGateway.js";
import type { ValidRoundState } from "../ports/RoundGateway.js";
import type { PlayerId, RoundId, TimePoint } from "../typedefs.js";
import type { CommandContext } from "./Command.js";
import { dispatchCommand } from "./dispatchCommand.js";
import { StartNextRound } from "./StartNextRound.js";

export async function finalizeRound(
  state: ValidRoundState & { readonly phase: "voting" },
  at: TimePoint,
  ctx: CommandContext,
  source: string = "FinalizeRound",
): Promise<void> {
  const { roundGateway, bus, logger, gameGateway } = ctx;
  const submittedPlayers = canonicalSubmittedPlayers(state);
  const shuffleOrder = state.shuffleOrder;

  const scores: Record<PlayerId, number> = Object.fromEntries(
    state.players.map((playerId) => [playerId, 0]),
  );

  const votes = state.votes ?? {};
  const voteEntries = Object.entries(votes) as readonly (readonly [PlayerId, number])[];

  const activeBaseIndex = submittedPlayers.indexOf(state.activePlayer);
  const realPromptIndex = shuffleOrder.indexOf(activeBaseIndex);

  let correctGuesses = 0;
  for (const [voterId, voteIndex] of voteEntries) {
    if (voteIndex === realPromptIndex) {
      scores[voterId]! += 3;
      correctGuesses += 1;
      continue;
    }

    const ownerId = submittedPlayers[shuffleOrder[voteIndex]!]!;
    scores[ownerId]! += 1;
  }

  const totalVotes = voteEntries.length;

  if (totalVotes > 0 && (correctGuesses === 0 || correctGuesses === totalVotes)) {
    for (const [voterId] of voteEntries) {
      scores[voterId]! += 2;
    }
  } else if (correctGuesses > 0 && correctGuesses < totalVotes) {
    scores[state.activePlayer]! += 3;
  }

  const newstate = { ...state, scores, phase: "scoring" } as ValidRoundState;

  await roundGateway.saveRoundState(newstate);
  logger?.info?.("Round entering scoring", {
    roundId: state.id,
    at,
    type: source,
    phase: newstate.phase,
  });

  await bus.publish(`round:${state.id}`, {
    type: "PhaseChanged",
    phase: newstate.phase,
    at,
  });

  const finstate = { ...newstate, phase: "finished", finishedAt: at } as ValidRoundState;
  await roundGateway.saveRoundState(finstate);

  logger?.info?.("Round finished", {
    roundId: state.id,
    at,
    type: source,
  });

  await bus.publish(`round:${state.id}`, {
    type: "PhaseChanged",
    phase: "finished",
    at,
  });

  await bus.publish(`round:${state.id}`, {
    type: "RoundFinished",
    roundId: state.id,
    at,
    scores,
  });

  const game = await gameGateway.loadGameState(state.gameId);
  await updateGameAfterRound(game, finstate.id, scores, at, ctx);
}

export async function updateGameAfterRound(
  game: GameState,
  roundId: RoundId,
  scores: Record<PlayerId, number>,
  at: TimePoint,
  ctx: CommandContext,
): Promise<void> {
  const { gameGateway, logger } = ctx;

  for (const [playerId, score] of Object.entries(scores)) {
    game.cumulativeScores[playerId] =
      (game.cumulativeScores[playerId] ?? 0) + score;
  }

  delete game.activeRoundId;
  game.currentRoundIndex += 1;

  const roundsRemaining = game.currentRoundIndex < game.config.totalRounds;

  if (!roundsRemaining) {
    game.phase = "finished";
  }

  await gameGateway.saveGameState(game);

  logger?.info?.("Game state updated after round", {
    type: "FinalizeRound",
    gameId: game.id,
    roundId,
    at,
    phase: game.phase,
  });

  if (roundsRemaining) {
    const command = new StartNextRound(game.id, at);
    await dispatchCommand(command, ctx);
  }
}
