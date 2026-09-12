const labels = {
  loadDate: 'Load date', customer: 'Customer', referenceNumber: 'Reference #',
  poNumber: 'PO #', pickupNumber: 'Pickup #', reservationNumber: 'Reservation #',
  returnNumber: 'Return #', pod: 'POD', driver: 'Driver', truck: 'Truck',
  pickup: 'Pickup location', delivery: 'Delivery location', deliveryType: 'Delivery type',
  workflowType: 'Load flow', appointmentTime: 'Appointment', eta: 'ETA',
  returnLocation: 'Return location', nextMoveType: 'Next move', dropType: 'Drop type',
  dropLocation: 'Drop / yard location', droppedBy: 'Dropped by', dropDateTime: 'Drop time',
  containerNumber: 'Container #', streetTurn: 'Street turn', bookingNumber: 'Booking #',
  shipLine: 'Ship line', chassisNumber: 'Chassis #', sealNumber: 'Seal #', containerSize: 'Container size',
  rate: 'Customer rate', driverRate: 'Driver pay', status: 'Status', availabilityStatus: 'Availability',
  paperwork: 'Paperwork', detention: 'Detention', lumper: 'Lumper', fuelAdvance: 'Fuel advance',
  settlement: 'Settlement', notes: 'Notes', customerExtraChargesJson: 'Customer extra charges',
  lastFreeDay: 'Last free day', miles: 'Miles', billingStatus: 'Billing status',
};
const moneyFields = new Set(['rate', 'driverRate', 'detention', 'lumper', 'fuelAdvance', 'settlement']);
const workflows = { LIVE_DELIVERY: 'Live Delivery', PRE_PULL_LIVE: 'Pre-Pull Live Load', DROP_AND_PICK: 'Drop & Pick' };
const normalized = (key, value) => {
  if (moneyFields.has(key)) return (Number(String(value ?? '').replace(/[^0-9.-]/g, '')) || 0).toFixed(2);
  if (key === 'miles') return String(Number(value) || 0);
  if (key === 'streetTurn') return [true, 1, '1'].includes(value) ? 'Yes' : 'No';
  if (key === 'workflowType') return workflows[value || 'LIVE_DELIVERY'] || String(value);
  if (key === 'customerExtraChargesJson') return value || '[]';
  return String(value ?? '');
};

export function getLoadEditChanges(before, after, driverLabel = (value) => value) {
  return Object.entries(labels).flatMap(([key, label]) => {
    const oldValue = normalized(key, before[key]);
    const newValue = normalized(key, after[key]);
    if (oldValue === newValue) return [];
    const display = (value) => !value ? '(empty)' : moneyFields.has(key) ? `$${value}` :
      ['driver', 'droppedBy'].includes(key) ? driverLabel(value) : value;
    return [{ key, label, before: display(oldValue), after: display(newValue) }];
  });
}
