// Company scope comes from the authenticated tenant's settings, never a browser query.
export const normalizeScac = value => String(value || '').trim().toUpperCase();
export const requirePortHoustonScac = value => {
  const scac = normalizeScac(value);
  if (!/^[A-Z]{2,4}$/.test(scac)) {
    const error = new Error('Save your company SCAC in Settings → Port Houston before retrieving EIRs.');
    error.status = 422;
    error.code = 'PORT_HOUSTON_SCAC_REQUIRED';
    throw error;
  }
  return scac;
};
export const matchesPortHoustonScope = (transaction, scac, containerNumber) => {
  if (!/^[A-Z]{2,4}$/.test(normalizeScac(scac))) return false;
  const carrier = normalizeScac(transaction?.truckingCompany || transaction?.trkcoId);
  const container = normalizeScac(transaction?.containerNumber || transaction?.ctrId || transaction?.unitId);
  return carrier === normalizeScac(scac) && Boolean(containerNumber) && container === normalizeScac(containerNumber);
};
export const portHoustonDocumentMetadata = (transaction, scac, containerNumber) => {
  if (!matchesPortHoustonScope(transaction, scac, containerNumber)) throw new Error('EIR company or container could not be verified.');
  return JSON.stringify({source:'port-houston',scac:normalizeScac(scac),containerNumber:normalizeScac(containerNumber),transactionNumber:String(transaction.nbr || transaction.gkey || ''),verifiedAt:new Date().toISOString()});
};
export const isPortHoustonDocumentVisible = (doc = {}) => {
  let metadata = null;
  try { metadata = JSON.parse(doc.portHoustonMetadataJson || 'null'); } catch { return false; }
  if (metadata) return metadata.source === 'port-houston' && matchesPortHoustonScope(
    {truckingCompany:metadata.scac,containerNumber:metadata.containerNumber},doc.companyPortHoustonScac,doc.loadContainerNumber);
  // Retain legacy automatic files, but do not distribute them before a scoped refresh.
  const automaticName = /-(?:out|in)-eir-\d+(?:-portflow-summary)?\.(?:pdf|jpg)$/i.test(String(doc.name || ''));
  const legacyExternalEir = /^(?:OUT|IN) EIR$/i.test(String(doc.category || '').trim()) && /^https?:\/\//i.test(String(doc.filePath || ''));
  return !automaticName && !legacyExternalEir;
};
export const portHoustonDocumentScopeColumns = 'c.portHoustonScac AS companyPortHoustonScac, l.containerNumber AS loadContainerNumber';
