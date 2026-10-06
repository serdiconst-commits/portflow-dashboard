// Port Houston terminal dates are displayed and edited in Houston time.
export function normalizePortDateTime(value) {
  const raw = String(value ?? '').trim();
  // EVP returns epoch milliseconds; form inputs and saved loads use ISO text.
  const isEpoch = typeof value === 'number' || /^\d{13}$/.test(raw);
  if (isEpoch && (!Number.isSafeInteger(Number(value)) || Number(value) <= 0)) return '';
  if (!isEpoch && !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) return '';
  const date = new Date(isEpoch ? Number(value) : raw);
  if (Number.isNaN(date.getTime())) return '';
  if (!isEpoch && !/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return raw.replace(' ', 'T').slice(0, 16);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23',
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export function formatPortDateTime(value) {
  const local = normalizePortDateTime(value);
  if (!local) return '—';
  const [year, month, day, hour, minute] = local.split(/[-T:]/);
  return `${Number(month)}/${Number(day)}/${year} ${Number(hour) % 12 || 12}:${minute} ${Number(hour) >= 12 ? 'PM' : 'AM'}`;
}
