const text = value => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
export const validateBookingNumber = value => /^[A-Za-z0-9][A-Za-z0-9._/-]{0,63}$/.test(text(value));

// N4 nominal height NOM96 means 9 ft 6 in; NOM86 means 8 ft 6 in.
export function bookingEquipment(item = {}) {
  const size = text(item.eqSize).toUpperCase();
  const height = text(item.eqHeight).toUpperCase();
  const group = text(item.eqIsoGroup).toUpperCase();
  const length = { NOM20: '20', NOM40: '40', NOM45: '45' }[size];
  const type = { GP: height === 'NOM96' ? 'HC' : 'ST', RT: 'RF', UT: 'UP', TN: 'TK' }[group];
  const known = length && type && ['NOM86', 'NOM96'].includes(height) && !item.isOog;
  const containerSize = known ? `${length} ${type}${['RF', 'UP'].includes(type) && length === '40' ? (height === 'NOM96' ? ' HC' : ' ST') : ''}` : '';
  return { containerSize, label: containerSize || [size, group, height].filter(Boolean).join(' / ') || 'Size not returned' };
}

export function normalizeBookings(records, bookingNumber) {
  const seen = new Set();
  return records.filter(record => record && text(record.nbr) === bookingNumber && record.subType === 'BOOK').map(record => {
    // The query's facility can be ignored by EVP. Only use the vessel visit's facility.
    const terminal = text(record.visit?.facilityId).toUpperCase();
    const equipment = [...new Map((Array.isArray(record.items) ? record.items : []).map(item => {
      const option = bookingEquipment(item);
      return [option.label, option];
    })).values()];
    return {
      bookingNumber, shipLine: text(record.lineId) || text(record.lineScac),
      lineScac: text(record.lineScac), terminal,
      terminalName: { BPT: 'Bayport Container Terminal', BCT: 'Barbours Cut Terminal' }[terminal] || '',
      vesselName: text(record.visit?.carrierName), equipment,
    };
  }).filter(record => {
    const key = JSON.stringify(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
