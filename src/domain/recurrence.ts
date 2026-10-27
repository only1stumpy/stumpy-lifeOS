export type RecurrenceIntervalUnit = "day" | "week" | "month" | "year";

type CalendarDate = { year: number; month: number; day: number };

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseIsoDate(value: string): CalendarDate {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("Дата должна иметь формат YYYY-MM-DD.");

  const [, yearValue, monthValue, dayValue] = match;
  const year = Number(yearValue);
  const month = Number(monthValue);
  const day = Number(dayValue);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new Error("Указана некорректная дата.");
  }
  return { year, month, day };
}

function toIsoDate({ year, month, day }: CalendarDate): string {
  if (year < 1 || year > 9999) throw new Error("Дата вышла за поддерживаемый диапазон.");
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function validateAnchorDay(day: number): void {
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error("День повторения должен быть целым числом от 1 до 31.");
  }
}

function validateAnchorMonth(month: number): void {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error("Месяц повторения должен быть целым числом от 1 до 12.");
  }
}

/** Advance a date-only recurrence without local-time or daylight-saving effects. */
export function advanceRecurrenceDate(
  dueDate: string,
  intervalUnit: RecurrenceIntervalUnit,
  intervalCount: number,
  anchorDay?: number,
  anchorMonth?: number,
): string {
  if (!Number.isSafeInteger(intervalCount) || intervalCount < 1) {
    throw new Error("Интервал повторения должен быть положительным целым числом.");
  }

  const current = parseIsoDate(dueDate);
  if (intervalUnit === "day" || intervalUnit === "week") {
    const daysToAdd = intervalCount * (intervalUnit === "week" ? 7 : 1);
    if (!Number.isSafeInteger(daysToAdd)) throw new Error("Интервал повторения слишком велик.");

    const date = new Date(0);
    date.setUTCHours(0, 0, 0, 0);
    date.setUTCFullYear(current.year, current.month - 1, current.day + daysToAdd);
    if (!Number.isFinite(date.getTime())) throw new Error("Дата вышла за поддерживаемый диапазон.");
    return toIsoDate({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  }

  const day = anchorDay ?? current.day;
  validateAnchorDay(day);

  if (intervalUnit === "month") {
    const targetMonthIndex = current.year * 12 + current.month - 1 + intervalCount;
    const year = Math.floor(targetMonthIndex / 12);
    const month = (targetMonthIndex % 12) + 1;
    return toIsoDate({ year, month, day: Math.min(day, daysInMonth(year, month)) });
  }

  if (intervalUnit === "year") {
    const month = anchorMonth ?? current.month;
    validateAnchorMonth(month);
    const year = current.year + intervalCount;
    return toIsoDate({ year, month, day: Math.min(day, daysInMonth(year, month)) });
  }

  throw new Error("Неизвестный интервал повторения.");
}
