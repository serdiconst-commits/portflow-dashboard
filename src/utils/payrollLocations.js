export function payrollLocationOptions(locations = [], kind) {
  const types = kind === 'pickup' ? ['', 'pickup', 'port', 'yard', 'warehouse'] : ['', 'delivery', 'warehouse'];
  return [...new Set(locations
    .filter(location => types.includes(String(location.type || '').trim().toLowerCase()))
    .map(location => {
      const address = [location.address, location.city, location.state, location.zip].map(value => String(value || '').trim()).filter(Boolean).join(', ');
      const name = String(location.name || '').trim();
      return name && address && name !== address ? `${name} — ${address}` : name || address;
    }).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
