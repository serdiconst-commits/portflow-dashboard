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

// Shift calendar dates, avoiding timezone/DST changes and preserving custom ranges.
export function shiftPayrollPeriod(start, end, weeks) {
  if (![-1, 1].includes(weeks) || !start || !end || start > end) return null;
  const shift = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T12:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
    date.setUTCDate(date.getUTCDate() + weeks * 7);
    const result = date.toISOString().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
  };
  const nextStart = shift(start), nextEnd = shift(end);
  return nextStart && nextEnd ? {start:nextStart, end:nextEnd} : null;
}
