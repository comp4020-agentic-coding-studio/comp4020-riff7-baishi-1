// Pure helper behind the calendar page's starting point, kept out of the
// component so spec/crit-7.test.ts can assert it directly.

// Which teaching week to open on: the one containing `today`, else the
// nearest (first week before the semester, last week after it). Returns
// that week's Monday.
export function initialMonday(weeks: Array<{ week: number; monday: string }>, today: string): string {
  const t = Date.parse(`${today}T00:00:00Z`);
  let best = weeks[0]?.monday ?? today;
  for (const w of weeks) {
    if (Date.parse(`${w.monday}T00:00:00Z`) <= t) best = w.monday;
  }
  return best;
}
