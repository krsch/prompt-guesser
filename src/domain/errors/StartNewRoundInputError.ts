export class StartNewRoundInputError extends Error {
  constructor(
    message: string,
    public readonly issues: ReadonlyArray<string>,
  ) {
    super(message);
    this.name = "StartNewRoundInputError";
  }

  static because(issues: readonly string[]): StartNewRoundInputError {
    const message =
      issues.length === 0
        ? "Invalid start new round input"
        : issues.length === 1
          ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            issues[0]!
          : `Invalid start new round input: ${issues.join("; ")}`;
    return new StartNewRoundInputError(message, issues);
  }
}
