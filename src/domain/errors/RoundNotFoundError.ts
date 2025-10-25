import type { RoundId } from "../typedefs.js";

export class RoundNotFoundError extends Error {
  constructor(roundId: RoundId) {
    super(`Round not found: ${roundId}`);
    this.name = "RoundNotFoundError";
  }
}
