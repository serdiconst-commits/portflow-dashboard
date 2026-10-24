export const getAccountingCustomerKey = (load) =>
  String(load.customer || '').trim().toLowerCase();

export function getUnpaidCustomerGroups(loads, invoices, getBillAmount, parseMoney) {
  const invoiceByLoad = new Map(invoices.map((invoice) => [String(invoice.loadId), invoice]));
  const groups = new Map();
  for (const load of loads) {
    const invoice = invoiceByLoad.get(String(load.id));
    if (String(invoice?.status || '').trim().toLowerCase() === 'paid') continue;
    const balance = Math.max(0, parseMoney(invoice?.amount ?? getBillAmount(load)) - parseMoney(invoice?.paidAmount));
    const key = getAccountingCustomerKey(load);
    const group = groups.get(key) || {
      key, name: String(load.customer || '').trim() || 'Unassigned customer', count: 0, balance: 0, loadIds: new Set(),
    };
    group.count += 1;
    group.balance += balance;
    group.loadIds.add(String(load.id));
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}
