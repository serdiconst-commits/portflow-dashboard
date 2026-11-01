// An explicit return to dispatch review takes precedence over an existing invoice.
export function isReadyForAccounting(load, invoices = []) {
  const status = String(load?.billingStatus || '').trim().toLowerCase();
  if (status === 'needs review') return false;
  return status === 'ready to bill' || invoices.some((invoice) => invoice.loadId === load?.id);
}
