import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { commandSchema } from "@/domain/commands";
import { commandHandlers, dispatch } from "@/server/commands";
import { AppError } from "@/server/http";
import type { CommandContext } from "@/server/commands/types";

describe("реестр обработчиков команд", () => {
  test("есть обработчик для каждого типа команды, кроме analyze", () => {
    const types = commandSchema.options.map((option) => option.shape.type.value as string);
    assert.ok(types.length > 30);
    assert.deepEqual(Object.keys(commandHandlers).sort(), [...types].sort());
  });

  test("неизвестная команда даёт AppError 400", async () => {
    const ctx = {} as CommandContext;
    for (const type of ["no.such.command", "constructor"]) {
      await assert.rejects(dispatch(ctx, { type } as never), (error: unknown) => error instanceof AppError && error.status === 400);
    }
  });
});
