import { eq, sql } from "drizzle-orm";
import type { Transaction } from "@/db/client";
import * as s from "@/db/schema";
import { dateKey, isValidTimeZone } from "@/domain/math";
import { USAGE_MODES } from "@/domain/notifications";
import { APP_VERSION } from "@/domain/release";
import { HEALTH_CONSENT_VERSION, PRIVACY_POLICY_VERSION } from "@/domain/privacy";
import { AppError } from "../http";
import { decimal, macroStrings, ensureBaseCurrency } from "./shared";
import { saveProfile } from "./nutrition";
import type { CommandHandlers } from "./types";

/**
 * Permanently removes the owner's profile and, through foreign-key cascades, all of their data.
 * Rate-limit counters are keyed by Telegram ID rather than by owner, so they are removed explicitly.
 */
export async function deleteOwnerData(tx: Transaction, owner: { id: string; telegramUserId: string }): Promise<void> {
  await tx.delete(s.rateLimitCounters).where(sql`${s.rateLimitCounters.key} like ${"%:" + owner.telegramUserId}`);
  await tx.delete(s.ownerSettings).where(eq(s.ownerSettings.id, owner.id));
}

export const settingsHandlers = {
  "settings.save": async ({ tx, owner }, command) => {
    if (!isValidTimeZone(command.timeZone)) throw new AppError(400, "Неизвестный часовой пояс.");
    await tx.update(s.ownerSettings).set({ timezone: command.timeZone, ...(command.target ? { profileOnboardingCompleted: true } : {}), updatedAt: new Date() }).where(eq(s.ownerSettings.id, owner.id));
    const effectiveFrom = dateKey(new Date(), command.timeZone);
    if (command.target) await tx.insert(s.nutritionTargets).values({ ownerId: owner.id, effectiveFrom, ...macroStrings(command.target) }).onConflictDoUpdate({ target: [s.nutritionTargets.ownerId, s.nutritionTargets.effectiveFrom], set: macroStrings(command.target) });
  },
  "modules.save": async ({ tx, owner }, command) => {
    await tx.update(s.ownerSettings).set({ enabledModules: command.modules, modulesConfigured: true, ...(command.disabledFeatures ? { disabledFeatures: command.disabledFeatures } : {}), updatedAt: new Date() }).where(eq(s.ownerSettings.id, owner.id));
  },
  "onboarding.complete": async ({ tx, owner: storedOwner }, command) => {
    let owner = storedOwner;
    if (command.timeZone !== undefined && !isValidTimeZone(command.timeZone)) throw new AppError(400, "Неизвестный часовой пояс.");
    // The new zone applies to everything this command writes (today's date for the profile weight and target).
    if (command.timeZone !== undefined) owner = { ...owner, timezone: command.timeZone };
    const preset = USAGE_MODES[command.usage];
    const nutritionOn = command.modules.includes("nutrition");
    await tx.update(s.ownerSettings).set({
      enabledModules: command.modules,
      modulesConfigured: true,
      notificationsConfigured: true,
      dailySummaryEnabled: preset.dailySummary,
      weeklySummaryEnabled: preset.weeklySummary,
      weightReminderEnabled: preset.weightReminder && nutritionOn,
      profileOnboardingCompleted: true,
      ...(command.timeZone !== undefined ? { timezone: command.timeZone } : {}),
      lastSeenVersion: owner.lastSeenVersion ?? APP_VERSION,
      updatedAt: new Date(),
    }).where(eq(s.ownerSettings.id, owner.id));
    if (nutritionOn && command.profile && command.target) await saveProfile(tx, owner, command.profile, command.target);
    if (command.account && command.modules.includes("finance")) {
      const existing = await tx.select({ id: s.financeAccounts.id }).from(s.financeAccounts).where(eq(s.financeAccounts.ownerId, owner.id)).limit(1);
      if (!existing.length) {
        await tx.insert(s.financeAccounts).values({ ownerId: owner.id, name: "Основной", currency: command.account.currency, isDefault: true, openingBalance: decimal(command.account.openingBalanceMinor) });
        await ensureBaseCurrency(tx, owner.id, command.account.currency);
      }
    }
  },
  "personalization.save": async ({ tx, owner }, command) => {
    const { settings } = command;
    await tx.update(s.ownerSettings).set({ enabledModules: command.modules, modulesConfigured: true, disabledFeatures: command.disabledFeatures, notificationsConfigured: true, dailySummaryEnabled: settings.dailySummary, weeklySummaryEnabled: settings.weeklySummary, weightReminderEnabled: settings.weightReminder, summaryTime: settings.summaryTime, updatedAt: new Date() }).where(eq(s.ownerSettings.id, owner.id));
  },
  "notifications.save": async ({ tx, owner }, command) => {
    const { settings } = command;
    await tx.update(s.ownerSettings).set({ notificationsConfigured: true, dailySummaryEnabled: settings.dailySummary, weeklySummaryEnabled: settings.weeklySummary, weightReminderEnabled: settings.weightReminder, summaryTime: settings.summaryTime, updatedAt: new Date() }).where(eq(s.ownerSettings.id, owner.id));
  },
  "privacy.accept": async ({ tx, owner }, command) => {
    if (command.version !== PRIVACY_POLICY_VERSION) throw new AppError(409, "Версия политики устарела. Откройте приложение заново.");
    if (command.healthVersion !== undefined && command.healthVersion !== HEALTH_CONSENT_VERSION) throw new AppError(409, "Версия согласия на данные о здоровье устарела. Откройте приложение заново.");
    const now = new Date();
    await tx.update(s.ownerSettings).set({
      privacyAcceptedAt: now,
      privacyPolicyVersion: command.version,
      ...(command.healthVersion ? { healthConsentAt: now, healthConsentVersion: command.healthVersion } : {}),
      updatedAt: now,
    }).where(eq(s.ownerSettings.id, owner.id));
  },
  "privacy.health.accept": async ({ tx, owner }, command) => {
    if (command.version !== HEALTH_CONSENT_VERSION) throw new AppError(409, "Версия согласия на данные о здоровье устарела. Откройте приложение заново.");
    const now = new Date();
    await tx.update(s.ownerSettings).set({ healthConsentAt: now, healthConsentVersion: command.version, updatedAt: now }).where(eq(s.ownerSettings.id, owner.id));
  },
  "privacy.health.revoke": async ({ tx, owner }) => {
    await tx.update(s.ownerSettings).set({ healthConsentAt: null, healthConsentVersion: null, updatedAt: new Date() }).where(eq(s.ownerSettings.id, owner.id));
  },
  "account.delete": async ({ tx, owner }) => {
    await deleteOwnerData(tx, owner);
  },
  "version.seen": async ({ tx, owner }, command) => {
    await tx.update(s.ownerSettings).set({ lastSeenVersion: command.version, updatedAt: new Date() }).where(eq(s.ownerSettings.id, owner.id));
  },
  "profile.skip": async ({ tx, owner }) => {
    await tx.update(s.ownerSettings).set({ profileOnboardingCompleted: true, updatedAt: new Date() }).where(eq(s.ownerSettings.id, owner.id));
  },
} satisfies Partial<CommandHandlers>;
