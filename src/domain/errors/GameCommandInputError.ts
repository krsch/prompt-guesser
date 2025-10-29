export class GameCommandInputError extends Error {
  constructor(message: string, public readonly issues: ReadonlyArray<string>) {
    super(message);
    this.name = "GameCommandInputError";
  }

  static because(issues: readonly string[]): GameCommandInputError {
    const message =
      issues.length === 0
        ? "Invalid game command input"
        : issues.length === 1
          ? issues[0]!
          : `Invalid game command input: ${issues.join("; ")}`;
    return new GameCommandInputError(message, issues);
  }
}
