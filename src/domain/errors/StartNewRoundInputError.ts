export class StartNewRoundInputError extends Error {
  constructor(message: string, public readonly issues: ReadonlyArray<string>) {
    super(message);
    this.name = "StartNewRoundInputError";
  }

  static because(issues: readonly string[]): StartNewRoundInputError {
    const message = issues.length === 0
      ? "Invalid start new round input"
      : issues.length === 1
        ? issues[0]!
        : `Invalid start new round input: ${issues.join("; ")}`;
    return new StartNewRoundInputError(message, issues);
  }
}
