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

