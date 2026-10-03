// Document dates are calendar labels: do not shift them through the browser's
// timezone (which can turn a midnight date into the previous day).
export function formatDocumentDate(value, fallback = '—') {
  const raw = String(value ?? '').trim();
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/);
  const us = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!iso && !us) return fallback;
  const [year, month, day] = (iso ? iso.slice(1) : [us[3],us[1],us[2]]).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return fallback;
  return `${month}/${day}/${year}`;
}

export function formatDocumentAppointment(value) {
  const date = formatDocumentDate(value, '-');
  const time = String(value ?? '').match(/[T\s](\d{2}):(\d{2})/);
  if (date === '-' || !time) return date;
  return `${date} ${time[1]}:${time[2]}`;
}
