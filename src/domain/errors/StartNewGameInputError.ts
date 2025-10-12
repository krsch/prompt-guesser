export class StartNewGameInputError extends Error {
  constructor(message: string, public readonly issues: ReadonlyArray<string>) {
    super(message);
    this.name = "StartNewGameInputError";
  }

  static because(issues: readonly string[]): StartNewGameInputError {
    const message = issues.length === 0
      ? "Invalid start new game input"
      : issues.length === 1
        ? issues[0]!
        : `Invalid start new game input: ${issues.join("; ")}`;
    return new StartNewGameInputError(message, issues);
  }
}
