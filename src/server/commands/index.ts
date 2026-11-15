import { AppError } from "../http";
import { debtsHandlers } from "./debts";
import { draftsHandlers } from "./drafts";
import { financeHandlers } from "./finance";
import { gymHandlers } from "./gym";
import { nutritionHandlers } from "./nutrition";
import { settingsHandlers } from "./settings";
import type { CommandContext, CommandHandlers, Handler, TransactionalCommand } from "./types";

/** Command type to handler; completeness is enforced by the `CommandHandlers` type. */
export const commandHandlers: CommandHandlers = {
  ...nutritionHandlers,
  ...financeHandlers,
  ...debtsHandlers,
  ...gymHandlers,
  ...draftsHandlers,
  ...settingsHandlers,
};

export async function dispatch(ctx: CommandContext, command: TransactionalCommand): Promise<void> {
  const handler = Object.hasOwn(commandHandlers, command.type)
    ? commandHandlers[command.type] as Handler<TransactionalCommand>
    : undefined;
  if (!handler) throw new AppError(400, `Неизвестная команда: ${(command as { type: string }).type}`);
  await handler(ctx, command);
}
