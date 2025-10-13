/**
 * Core domain typedefs used throughout the game.
 * These are simple aliases for now; you can later evolve them into
 * branded types for stronger compile-time safety.
 */

/** Unique identifier of a round */
export type RoundId = string;

/** Unique identifier of a player */
export type PlayerId = string;

/** Absolute time point in milliseconds since Unix epoch */
export type TimePoint = number;

/** Round phase enumeration */
export type RoundPhase =
  | "prompt"
  | "guessing"
  | "voting"
  | "scoring"
  | "finished";

/** Configuration that defines the rules and pacing of the game */
export interface GameConfig {
  /** Minimum number of players required to start a round */
  minPlayers: number;
  /** Maximum number of players allowed in a round */
  maxPlayers: number;
  /** How long players have to submit prompts once the round begins */
  promptDurationMs: number;
}

