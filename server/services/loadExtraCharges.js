import { randomUUID } from 'node:crypto';
import { dbGet, dbRun } from './dbUtils.js';

// Update customer charges only: active driver/status changes must remain untouched.
export function createLoadExtraChargesHandler(db, audit) {
  return async (req, res) => {
    const charges = req.body?.charges;
    if (!Array.isArray(charges) || charges.length > 100 || charges.some(charge =>
      !charge || typeof charge !== 'object' || typeof charge.amount !== 'number' ||
      !Number.isFinite(charge.amount) || Math.abs(charge.amount) > 100000000)) {
      return res.status(400).json({ error: 'Enter valid extra charge amounts.' });
    }
    const normalized = charges.map(charge => ({
      id: String(charge.id || randomUUID()), type: String(charge.type || 'Other').trim(),
      description: String(charge.description || '').trim(), amount: Math.round(charge.amount * 100) / 100,
    }));
    const companyId = req.company.companyId;
    const id = String(req.params.id || '').trim();
    try {
      const previous = await dbGet(db, "SELECT customerExtraChargesJson FROM loads WHERE id=? AND companyId=? AND COALESCE(deletedAt,'')=''", [id, companyId]);
      if (!previous) return res.status(404).json({ error: 'Load not found.' });
      const json = JSON.stringify(normalized);
      const result = await dbRun(db, "UPDATE loads SET customerExtraChargesJson=? WHERE id=? AND companyId=? AND COALESCE(deletedAt,'')='' AND COALESCE(customerExtraChargesJson,'')=?", [json, id, companyId, previous.customerExtraChargesJson || '']);
      if (!result.changes) return res.status(409).json({ error: 'Charges changed while saving. Refresh and try again.' });
      audit(req, { action: 'CUSTOMER_EXTRA_CHARGES_UPDATED', entityType: 'LOAD', entityId: id, entityLabel: id,
        oldValue: { customerExtraChargesJson: previous.customerExtraChargesJson }, newValue: { customerExtraChargesJson: json } });
      return res.json({ id, customerExtraCharges: normalized, customerExtraChargesJson: json });
    } catch (error) {
      console.error('Failed to save extra charges:', error.message);
      return res.status(500).json({ error: 'Failed to save extra charges.' });
    }
  };
}
