const text = value => String(value ?? '').trim();
export const DRIVER_ALERT_FIELDS = ['pickup', 'delivery', 'returnLocation', 'dropLocation', 'appointmentTime', 'hookReadyAt', 'notes', 'driverRate', 'pickupNumber', 'returnNumber', 'reservationNumber', 'referenceNumber', 'bookingNumber', 'poNumber', 'containerNumber', 'chassisNumber', 'workflowType'];
export function driverLoadChanges(before, after) {
  const changed = DRIVER_ALERT_FIELDS.filter(field => text(before?.[field]) !== text(after?.[field]));
  for (const field of ['id', 'origin', 'destination', 'driverRate', 'notes', 'moveType']) {
    if (text(before?.currentMove?.[field]) !== text(after?.currentMove?.[field])) changed.push(`movement.${field}`);
  }
  return changed;
}
export function newerVersion(current, latest) {
  const parse = value => /^\d+(\.\d+){0,3}$/.test(text(value)) ? text(value).split('.').map(Number) : null;
  const a = parse(current), b = parse(latest);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((b[i] || 0) !== (a[i] || 0)) return (b[i] || 0) > (a[i] || 0);
  }
  return false;
}
export function safeStoreUrl(value, platform) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === (platform === 'ios' ? 'apps.apple.com' : 'play.google.com') ? url.href : '';
  } catch { return ''; }
}
