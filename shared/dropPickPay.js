const isDropPick = load => load.workflowType === 'DROP_AND_PICK';
function amount(value, label) {
  const text = String(value ?? '').trim().replace(/^\$/, '').replaceAll(',', '');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw Object.assign(new Error(`Enter a non-negative ${label} amount (up to two decimals).`), {status:400});
  return text;
}
// Only new requests carrying the pair opt in. Legacy requests retain their rate.
export function prepareDropPickCreationPay(load) {
  if (!isDropPick(load) || (load.dropPay === undefined && load.pickupPay === undefined)) return load;
  const dropPay = amount(load.dropPay ?? load.driverRate, 'Drop Pay');
  const pickupPay = amount(load.pickupPay, 'Pickup / Return Pay');
  return {...load, dropPay, pickupPay, driverRate:dropPay};
}
export function dropPickDraftPay(load) {
  if (!isDropPick(load)) return {};
  const drop = (load.moves || []).find(move=>move.moveType === 'DROP' && move.status !== 'Cancelled');
  const pickup = (load.moves || []).find(move=>move.moveType === 'PICKUP_RETURN' && move.status !== 'Cancelled');
  const dropPay = drop?.driverRate ?? load.driverRate ?? '';
  return {
    dropPay,
    driverRate: dropPay,
    pickupPay: pickup?.driverRate ?? (Number(load.pickupPay)>0 ? load.pickupPay : ''),
  };
}
