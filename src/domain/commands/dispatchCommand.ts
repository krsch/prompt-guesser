import type { CommandContext, Command } from "./Command.js";

export async function dispatchCommand(
  command: Command,
  ctx: CommandContext,
): Promise<void> {
  const started = Date.now();

  try {
    ctx.logger?.info?.(`[CMD] ${command.type}`, { command });
    await command.execute(ctx);
    ctx.logger?.info?.(`[CMD OK] ${command.type}`, {
      ms: Date.now() - started,
    });
  } catch (error) {
    ctx.logger?.error?.(`[CMD ERR] ${command.type}`, { error });
    throw error;
  }
}
