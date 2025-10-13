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
   * Randomized list of all prompts (real + decoys).
   * Present when transitioning to voting phase.
   */
  shuffledPrompts?: string[];

  /**
   * Owners corresponding to each shuffled prompt.
   * Mirrors the indices of {@link shuffledPrompts} for scoring.
   */
  shuffledPromptOwners?: PlayerId[];

  /**
   * Player votes, each pointing to an index in shuffledPrompts.
   * Present during voting and later phases.
   */
  votes?: Record<PlayerId, number>;

  /**
   * Per-player scores, computed at the scoring phase.
   * Persisted to make results queryable without recomputation.
   */
  scores?: Record<PlayerId, number>;

  /** When the round started */
  startedAt: TimePoint;

  /** Deadline for the active player to submit the real prompt */
  promptDeadline?: TimePoint;

  /** Deadline for players to submit decoy prompts */
  guessingDeadline?: TimePoint;

  /** Deadline for players to vote */
  votingDeadline?: TimePoint;

  /** Generated image URL shared during the guessing phase */
  imageUrl?: string;

  /** When the round was completed and finalized */
  finishedAt?: TimePoint;
}

/**
 * Static metadata describing which RoundState fields may change concurrently.
 * Adapters can use this to build atomic updates and enforce mutability rules.
 */
export type MutableRoundFields =
  | "prompts"
  | "votes"
  | "phase"
  | "shuffledPrompts"
  | "shuffledPromptOwners"
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
  loadRoundState(roundId: RoundId): Promise<RoundState>;

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
    prompt: string
  ): Promise<PromptAppendResult>;

  /**
   * Record a player's vote atomically and return the resulting snapshot of
   * all votes.
   */
  appendVote(
    roundId: RoundId,
    playerId: PlayerId,
    promptIndex: number
  ): Promise<VoteAppendResult>;

  /**
   * Count how many players have submitted prompts.
   * Adapters may cache or compute this efficiently.
   */
  countSubmittedPrompts(roundId: RoundId): Promise<number>;

  /**
   * Initialize and persist a new round with given players and deadlines.
   * The adapter generates a new round ID and returns the created state.
   */
  startNewRound(
    players: PlayerId[],
    activePlayer: PlayerId,
    startedAt: TimePoint,
    promptDeadline: TimePoint,
  ): Promise<RoundState>;

  /**
   * Schedule a timeout for a specific phase. Infrastructure is responsible for
   * delivering the matching {@link PhaseTimeout} command at the provided time.
   */
  scheduleTimeout(roundId: RoundId, phase: RoundPhase, at: TimePoint): Promise<void>;

  /**
   * Produce a deterministic shuffle for prompts to avoid leaking bias. The
   * returned collection must be the same length as the input and preserve the
   * association between prompt text and player.
   */
  shufflePrompts(
    roundId: RoundId,
    prompts: readonly (readonly [PlayerId, string])[],
  ): Promise<readonly (readonly [PlayerId, string])[]>;
}
