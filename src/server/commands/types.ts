import type { Transaction } from "@/db/client";
import type * as s from "@/db/schema";
import type { AppCommand } from "@/domain/commands";

export type OwnerRow = typeof s.ownerSettings.$inferSelect;

export interface CommandContext {
  tx: Transaction;
  owner: OwnerRow;
}

export type Handler<C> = (ctx: CommandContext, command: C) => Promise<void>;

/** Commands handled inside the owner transaction; `analyze` runs before it. */
export type TransactionalCommand = Exclude<AppCommand, { type: "analyze" }>;

/** One handler per command type: a missing handler is a compile error. */
export type CommandHandlers = {
  [K in TransactionalCommand["type"]]: Handler<Extract<TransactionalCommand, { type: K }>>;
};
