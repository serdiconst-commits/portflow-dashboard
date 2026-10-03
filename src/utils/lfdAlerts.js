const text = (value) => String(value ?? '').trim();

export function hasAssignedDriver(load = {}) {
  const driver = text(load.driver);
  return Boolean(driver && !/^(?:-+\s*)?(?:no driver|assign later|select driver|not assigned|unassigned)(?:\s*-+)?$/i.test(driver));
}

export function lfdCalendarDate(value) {
  const raw = text(value);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!iso && !us) return '';
  const [year, month, day] = iso ? iso.slice(1) : [us[3], us[1].padStart(2, '0'), us[2].padStart(2, '0')];
  const date = `${year}-${month}-${day}`;
  const parsed = new Date(`${date}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : '';
}

export function companyCalendarDate(now = new Date(), timeZone = 'America/Chicago') {
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const parts = formatter.formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type).value).join('-');
}

export function getLfdTodayAlerts(loads = [], now = new Date(), timeZone = 'America/Chicago') {
  const today = companyCalendarDate(now, timeZone);
  return loads.filter(load => !load.deletedAt &&
    !['completed', 'delivered', 'cancelled', 'canceled'].includes(text(load.status).toLowerCase()) &&
    !hasAssignedDriver(load) &&
    lfdCalendarDate(text(load.lastFreeDay) || load.lfd) === today);
}

// Compare calendar days, rather than elapsed hours, across daylight-saving changes.
export function getLfdPriorityAlerts(loads = [], now = new Date(), timeZone = 'America/Chicago') {
  const today = Date.parse(`${companyCalendarDate(now, timeZone)}T12:00:00Z`);
  return loads.flatMap(load => {
    const date = lfdCalendarDate(text(load.lastFreeDay) || load.lfd);
    if (!date || load.deletedAt || hasAssignedDriver(load) ||
      ['completed', 'delivered', 'cancelled', 'canceled'].includes(text(load.status).toLowerCase())) return [];
    const days = Math.round((Date.parse(`${date}T12:00:00Z`) - today) / 86400000);
    if (days > 1) return [];
    return [{ load, date, days, priority: days < 0 ? 'overdue' : days === 0 ? 'today' : 'tomorrow' }];
  }).sort((a, b) => a.days - b.days || text(a.load.containerNumber || a.load.id).localeCompare(text(b.load.containerNumber || b.load.id)));
}
