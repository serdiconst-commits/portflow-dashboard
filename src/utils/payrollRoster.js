// Display unscheduled drivers without creating settlements or inventing pay totals.
export function payrollRoster(drivers, settlements, periodStart, periodEnd) {
  const represented = new Set(settlements.map(row => String(row.driverId)));
  const names = new Map(drivers.map(driver => [String(driver.id), driver.name || driver.id]));
  const rows = settlements.map(row => ({ ...row, driverName: row.driverName || names.get(String(row.driverId)) || row.driverId }));
  for (const driver of drivers) {
    if (!driver.id || represented.has(String(driver.id))) continue;
    represented.add(String(driver.id));
    rows.push({ id: `unprepared:${driver.id}`, driverId: driver.id, driverName: driver.name || driver.id,
      periodStart, periodEnd, status: 'Not prepared', unprepared: true });
  }
  return rows.sort((a, b) => String(a.driverName).localeCompare(String(b.driverName)));
}
