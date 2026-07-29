export const dispatchStatusColumns = [
  { key: 'available', label: 'Available' },
  { key: 'not-available', label: 'Not Available' },
  { key: 'dispatched', label: 'Dispatched' },
  { key: 'in-transit', label: 'In Transit' },
  { key: 'dropped', label: 'Dropped' },
  { key: 'delivered', label: 'Delivered' },
];

export const slugifyStatus = (status) =>
  String(status || '').trim().toLowerCase().replace(/\s+/g, '-');
