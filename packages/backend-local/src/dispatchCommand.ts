import type { Command } from "@prompt-guesser/core/domain/commands/Command.js";
import type { CommandContext } from "@prompt-guesser/core/domain/commands/Command.js";

export async function dispatchCommand(
  command: Command,
  ctx: CommandContext,
): Promise<void> {
  const startedAt = Date.now();
  ctx.logger?.info?.("Dispatching command", {
    type: command.type,
    at: command.at,
  });

  try {
    await command.execute(ctx);
    ctx.logger?.info?.("Command completed", {
      type: command.type,
      elapsedMs: Date.now() - startedAt,
    });
  } catch (error) {
    ctx.logger?.error?.("Command failed", {
      type: command.type,
      error,
    });
    throw error;
  }
}
