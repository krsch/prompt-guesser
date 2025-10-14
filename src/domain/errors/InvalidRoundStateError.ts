import type { RoundState } from "../ports/RoundGateway.js";

export class InvalidRoundStateError extends Error {
  constructor(
    public readonly reason: string,
    public readonly state: RoundState,
  ) {
    super(`Invalid round state: ${reason}`);
    this.name = "InvalidRoundStateError";
  }
}
