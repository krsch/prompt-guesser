import type { RoundId, PlayerId, TimePoint, RoundPhase } from "../typedefs.js";

/**
 * The authoritative domain snapshot of a single round of the game.
 * Fields may be partially populated depending on the current phase.
 */
export interface RoundState {
  /** Unique round identifier */
  id: RoundId;

  /** All participating players */
  players: PlayerId[];

  /** The player providing the real prompt (active player) */
  activePlayer: PlayerId;

  /** Current phase of this round */
  phase: RoundPhase;

  /**
   * Prompts (real + decoy) submitted by players.
   * Present from guessing phase onward.
   */
  prompts?: Record<PlayerId, string>;

  /**
   * Player votes, each pointing to an index in the derived shuffled prompt list.
   * Present during voting and later phases.
   */
  votes?: Record<PlayerId, number>;

  /**
   * Per-player scores, computed at the scoring phase.
   * Persisted to make results queryable without recomputation.
   */
  scores?: Record<PlayerId, number>;

  /**
   * Deterministic permutation describing the order prompts should be revealed in voting.
   * Each entry points to an index in the submitted prompt list derived from {@link prompts}.
   */
  shuffleOrder?: number[];

  /** Numeric seed used to derive deterministic randomness for this round. */
  seed: number;

  /** When the round started */
  startedAt: TimePoint;

  /** Generated image URL shared during the guessing phase */
  imageUrl?: string;

  /** When the round was completed and finalized */
  finishedAt?: TimePoint;
}

// -----------------------------------------------------------------------------
//  ValidRoundState — Phase-dependent refinement of RoundState
// -----------------------------------------------------------------------------

export type ValidRoundState =
  | (RoundState & {
      phase: "prompt";
      prompts: Record<PlayerId, string>;
    })
  | (RoundState & {
      phase: "guessing";
      prompts: Record<PlayerId, string>;
      imageUrl: string;
    })
  | (RoundState & {
      phase: "voting";
      prompts: Record<PlayerId, string>;
      imageUrl: string;
      shuffleOrder: number[];
    })
  | (RoundState & {
      phase: "scoring" | "finished";
      prompts: Record<PlayerId, string>;
      imageUrl: string;
      shuffleOrder: number[];
      votes: Record<PlayerId, number>;
      scores: Record<PlayerId, number>;
    });

/**
 * Static metadata describing which RoundState fields may change concurrently.
 * Adapters can use this to build atomic updates and enforce mutability rules.
 */
export type MutableRoundFields =
  | "prompts"
  | "votes"
  | "phase"
  | "shuffleOrder"
  | "scores"
  | "finishedAt";

/**
 * Persistence abstraction for managing the lifecycle of one game round.
 * Implementations must handle atomicity, concurrency, and consistency internally.
 */
export interface PromptAppendResult {
  /** Whether a new prompt was inserted. False when the submission was a duplicate. */
  inserted: boolean;

  /** Snapshot of all prompts after the append operation. */
  prompts: Record<PlayerId, string>;
}

export interface VoteAppendResult {
  /** Whether the vote was newly inserted. */
  inserted: boolean;

  /** Snapshot of all votes after the append operation. */
  votes: Record<PlayerId, number>;
}

export interface RoundGateway {
  /** Load the full round state */
  loadRoundState(roundId: RoundId): Promise<ValidRoundState>;

  /**
   * Persist a complete round snapshot.
   * Implementations may use optimistic concurrency or diff-based merging.
   * Intended for phase transitions and finalization.
   */
  saveRoundState(state: RoundState): Promise<void>;

  /**
   * Append or update a player's prompt (real or decoy) atomically and
   * return the resulting snapshot of all prompts.
   */
  appendPrompt(
    roundId: RoundId,
    playerId: PlayerId,
    prompt: string,
  ): Promise<PromptAppendResult>;

  /**
   * Record a player's vote atomically and return the resulting snapshot of
   * all votes.
   */
  appendVote(
    roundId: RoundId,
    playerId: PlayerId,
    promptIndex: number,
  ): Promise<VoteAppendResult>;

  /**
   * Count how many players have submitted prompts.
   * Adapters may cache or compute this efficiently.
   */
  countSubmittedPrompts(roundId: RoundId): Promise<number>;

  /**
   * Initialize and persist a new round with given players.
   * The adapter generates a new round ID and returns the created state.
   */
  startNewRound(
    players: PlayerId[],
    activePlayer: PlayerId,
    startedAt: TimePoint,
  ): Promise<RoundState>;
}
