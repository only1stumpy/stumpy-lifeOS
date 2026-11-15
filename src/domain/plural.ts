/** Russian plural form for a count: «1 запись», «2 записи», «5 записей». Fractions use the integer part. */
export function plural(value: number, one: string, few: string, many: string): string {
  const integer = Math.abs(Math.trunc(value));
  const lastTwo = integer % 100;
  if (lastTwo > 10 && lastTwo < 20) return many;
  const last = integer % 10;
  if (last === 1) return one;
  if (last > 1 && last < 5) return few;
  return many;
}
