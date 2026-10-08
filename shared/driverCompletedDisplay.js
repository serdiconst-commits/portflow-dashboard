const normalized = value => String(value ?? '').trim().toLowerCase();

// This is a driver-facing projection only. Never change the saved load or ledger.
export function driverCompletedDisplay(load, driverId) {
  if (!['delivered', 'completed'].includes(normalized(load.status))) return load;
  const driver = normalized(driverId);
  const completed = (load.moves || []).filter(move =>
    driver && normalized(move.status) === 'completed' &&
    normalized(move.completedBy || move.driverId) === driver
  ).sort((a, b) => {
    const aTime = Date.parse(a.completedAt);
    const bTime = Date.parse(b.completedAt);
    if (Number.isFinite(aTime) && Number.isFinite(bTime) && aTime !== bTime) return bTime - aTime;
    return (Number(b.sequence) || 0) - (Number(a.sequence) || 0);
  });
  let currentMove = completed[0] ? { ...completed[0] } : null;
  // Older live deliveries can have pay only on the load. An explicit zero is valid.
  if (currentMove && !String(currentMove.driverRate ?? '').trim() && completed.length === 1 &&
      ['LIVE_DELIVERY', ''].includes(String(currentMove.moveType || '').toUpperCase()) &&
      normalized(load.driver) === driver) {
    currentMove.driverRate = load.driverRate;
  }
  return { ...load, currentMove };
}
