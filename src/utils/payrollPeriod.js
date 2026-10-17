// Use the company calendar date so the default does not depend on the device timezone.
export function previousPayrollPeriod(now = new Date(), timeZone = 'America/Chicago') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const part = type => Number(parts.find(item => item.type === type).value);
  const day = new Date(Date.UTC(part('year'), part('month') - 1, part('day')));
  day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7) - 7);
  const start = day.toISOString().slice(0, 10);
  day.setUTCDate(day.getUTCDate() + 4);
  return { start, end: day.toISOString().slice(0, 10) };
}
