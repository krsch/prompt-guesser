export class StartNextRoundInputError extends Error {
  constructor(
    message: string,
    public readonly issues: ReadonlyArray<string>,
  ) {
    super(message);
    this.name = "StartNextRoundInputError";
  }

  static because(issues: readonly string[]): StartNextRoundInputError {
    const message =
      issues.length === 0
        ? "Invalid start next round input"
        : issues.length === 1
          ? // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            issues[0]!
          : `Invalid start next round input: ${issues.join("; ")}`;
    return new StartNextRoundInputError(message, issues);
  }
}
