import type { GameState, PlayerId, RoundState } from "./types.js";

export interface VisibleRoundState {
  readonly id: RoundState["id"];
  readonly players: RoundState["players"];
  readonly activePlayer: RoundState["activePlayer"];
  readonly phase: RoundState["phase"];
  readonly imageUrl?: RoundState["imageUrl"];
  readonly prompts?: Record<PlayerId, string | null> | undefined;
  readonly votes?: Record<PlayerId, number | null> | undefined;
  readonly scores?: RoundState["scores"];
  readonly shuffleOrder?: RoundState["shuffleOrder"];
}

export interface VisibleGameState {
  readonly id: GameState["id"];
  readonly lobby: GameState["lobby"];
  readonly currentRound?: {
    readonly id: string;
    readonly state: VisibleRoundState;
  };
}

export function projectVisibleState(state: GameState): VisibleGameState {
  const currentRound = state.currentRound;
  if (!currentRound) {
    return {
      id: state.id,
      lobby: state.lobby,
    };
  }

  return {
    id: state.id,
    lobby: state.lobby,
    currentRound: {
      id: currentRound.id,
      state: projectVisibleRound(currentRound.state),
    },
  };
}

function projectVisibleRound(round: RoundState): VisibleRoundState {
  const {
    id,
    players,
    activePlayer,
    phase,
    imageUrl,
    scores,
    shuffleOrder,
  } = round;

  return {
    id,
    players,
    activePlayer,
    phase,
    imageUrl,
    prompts: redactedPrompts(round),
    votes: redactedVotes(round),
    scores,
    shuffleOrder,
  };
}

function redactMapValues<T>(
  phase: RoundState["phase"],
  entries: Record<PlayerId, T> | undefined,
): Record<PlayerId, T | null> | undefined {
  if (!entries) return undefined;
  if (phase === "finished") return entries as Record<PlayerId, T>;
  return Object.fromEntries(Object.keys(entries).map((key) => [key, null])) as Record<
    PlayerId,
    T | null
  >;
}

function redactedPrompts(round: RoundState): Record<PlayerId, string | null> | undefined {
  return redactMapValues(round.phase, round.prompts);
}

function redactedVotes(round: RoundState): Record<PlayerId, number | null> | undefined {
  return redactMapValues(round.phase, round.votes);
}
