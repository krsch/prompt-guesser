import { Command, type CommandContext } from "./Command.js";
import { transitionToGuessing } from "./PhaseTransitions.js";
import type { PlayerId, RoundId, TimePoint } from "../typedefs.js";

export class SubmitPrompt extends Command {
  readonly type = "SubmitPrompt" as const;

  constructor(
    public readonly roundId: RoundId,
    public readonly playerId: PlayerId,
    public readonly prompt: string,
    public readonly at: TimePoint,
  ) {
    super();
  }

  async execute({ gateway, bus, imageGenerator, logger, config }: CommandContext): Promise<void> {
    const state = await gateway.loadRoundState(this.roundId);

    if (state.phase !== "prompt") {
      throw new Error("Cannot submit prompt when round is not in prompt phase");
    }

    if (state.activePlayer !== this.playerId) {
      throw new Error("Only the active player can submit the real prompt");
    }

    if (state.promptDeadline && this.at >= state.promptDeadline) {
      throw new Error("Cannot submit prompt after the deadline has passed");
    }

    const { inserted, prompts } = await gateway.appendPrompt(
      this.roundId,
      this.playerId,
      this.prompt,
    );

    if (prompts[this.playerId] !== this.prompt) {
      throw new Error("Failed to persist active player's prompt");
    }

    if (!inserted) {
      logger?.info?.("Prompt submission ignored; already stored", {
        type: this.type,
        roundId: state.id,
        playerId: this.playerId,
        at: this.at,
      });
      return;
    }

    const imageUrl = await imageGenerator.generate(this.prompt);

    state.prompts = prompts;

    await bus.publish(`round:${state.id}`, {
      type: "ImageGenerated",
      roundId: state.id,
      imageUrl,
      guessingDeadline: this.at + config.guessingDurationMs,
    });

    logger?.info?.("Prompt submitted", {
      type: this.type,
      roundId: state.id,
      at: this.at,
    });

    await transitionToGuessing(state, this.at, imageUrl, {
      gateway,
      bus,
      logger,
      config,
    });
  }
}
