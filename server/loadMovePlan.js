const text = (value) => String(value ?? '').trim();
const finished = (move) => ['Completed', 'Cancelled'].includes(move.status);
const activeStatuses = ['Assigned', 'Arrived at Pickup', 'Loaded', 'In Transit'];

export function movementPickupOrigin(move, moves) {
  if (move.moveType !== 'PICKUP_RETURN' || finished(move)) return move.origin;
  const drop = moves.filter((row) => row.moveType === 'DROP' && row.status === 'Completed' &&
    Number(row.sequence) < Number(move.sequence)).sort((a, b) => b.sequence - a.sequence)[0];
  return text(drop?.destination) || move.origin;
}

// Reconcile planned work without replacing the IDs used by settlements or
// rebuilding a second driver's route from the load's original port.
export function reconcileLoadMoves(load, existing, templates, previous) {
  if (!existing.length) {
    // Editing a historical load must not invent an unpaid first movement.
    if (['Delivered', 'Completed'].includes(load.status)) return [];
    if (load.workflowType === 'DROP_AND_PICK' && load.status === 'Dropped' && (previous || !text(load.driver))) {
      return templates.slice(1).map((move, index) => ({ ...move, sequence: index + 2 }));
    }
    return templates.map((move, index) => ({ ...move, sequence: index + 1 }));
  }
  if (!previous) return existing;
  const changed = (key) => text(load[key]) !== text(previous[key]);
  const workflowChanged = changed('workflowType');
  let result = existing.map((move) => ({ ...move }));
  if (workflowChanged) {
    const protectedMoves = existing.filter(finished);
    const lastProtected = Math.max(0, ...protectedMoves.map((move) => Number(move.sequence)));
    result = [
      ...protectedMoves,
      ...templates.slice(lastProtected).map((template, index) => {
        const sequence = lastProtected + index + 1;
        const matching = existing.find((move) => Number(move.sequence) === sequence && !finished(move));
        return matching ? {
          ...matching, moveType: template.moveType,
          origin: matching.origin || template.origin, destination: template.destination,
          status: matching.status === 'Waiting Customer' && matching.moveType !== template.moveType ? template.status : matching.status,
        } : { ...template, sequence };
      }),
    ];
  } else {
    const lastSequence = Math.max(...existing.map((move) => Number(move.sequence)));
    result.push(...templates.slice(lastSequence).map((move, index) => ({ ...move, sequence: lastSequence + index + 1 })));
  }
  const current = result.find((move) => activeStatuses.includes(move.status)) ||
    result.find((move) => move.status === 'Planned');
  for (const move of result) {
    if (finished(move)) continue;
    if (move === current) {
      if (changed('driverRate')) move.driverRate = text(load.driverRate);
      if (changed('driver')) {
        move.driverId = text(load.driver);
        if (['Assigned', 'Planned'].includes(move.status)) move.status = move.driverId ? 'Assigned' : 'Planned';
      }
      if (changed('pickup')) move.origin = text(load.pickup);
      if (changed('delivery') && move.moveType !== 'PRE_PULL' && move.moveType !== 'PICKUP_RETURN') move.destination = text(load.delivery);
    }
    if (changed('dropLocation') && load.workflowType === 'PRE_PULL_LIVE') {
      if (move.moveType === 'PRE_PULL') move.destination = text(load.dropLocation);
      if (move.moveType === 'DELIVERY') move.origin = text(load.dropLocation);
    }
    if (changed('delivery') && ['PICKUP_RETURN', 'RETURN'].includes(move.moveType) && !activeStatuses.includes(move.status)) {
      // Once dropped, the actual drop location is the pickup origin.
      move.origin = text(load.dropLocation || load.delivery);
    }
    if (changed('returnLocation') && ['PICKUP_RETURN', 'RETURN'].includes(move.moveType)) move.destination = text(load.returnLocation);
    move.origin = movementPickupOrigin(move, result);
  }
  return result;
}
