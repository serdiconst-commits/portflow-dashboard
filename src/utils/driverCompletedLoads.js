const normalized = (value) => String(value || '').trim().toLowerCase();

export function getDriverCompletion(load, driverId, timeZone = 'America/Chicago') {
  const candidates = (load.moves || []).filter((move) => normalized(move.status) === 'completed' &&
    normalized(move.completedBy || move.driverId) === normalized(driverId))
    .map((move) => move.completedAt).filter((value) => Number.isFinite(Date.parse(value)));
  const raw = candidates.sort((a, b) => Date.parse(b) - Date.parse(a))[0] || load.completedAt;
  const timestamp = Date.parse(raw);
  if (!Number.isFinite(timestamp)) return { timestamp: null, day: '', label: 'Completion date unavailable' };
  let day;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) day = raw;
  else {
    let formatter;
    try { formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }); }
    catch { formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }); }
    const parts = formatter.formatToParts(new Date(timestamp));
    day = ['year', 'month', 'day'].map((type) => parts.find((part) => part.type === type).value).join('-');
  }
  const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' })
    .format(new Date(`${day}T12:00:00Z`));
  return { timestamp, day, label };
}

export function filterDriverCompletedLoads(loads, driverId, from = '', to = '', timeZone = 'America/Chicago') {
  if (from && to && from > to) return [];
  return loads.filter((load) => ['delivered', 'completed'].includes(normalized(load.status)) &&
    normalized(load.driver) === normalized(driverId))
    .map((load) => ({ load, date: getDriverCompletion(load, driverId, timeZone) }))
    .filter(({ date }) => (!from && !to) || (date.day && (!from || date.day >= from) && (!to || date.day <= to)))
    .sort((a, b) => (b.date.timestamp ?? -Infinity) - (a.date.timestamp ?? -Infinity) ||
      String(b.load.id).localeCompare(String(a.load.id), undefined, { numeric: true }))
    .map(({ load }) => load);
}
