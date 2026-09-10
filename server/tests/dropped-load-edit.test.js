import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../server.js', import.meta.url), 'utf8');
const start = source.indexOf("app.put('/api/loads/:id'");
const end = source.indexOf("app.put('/api/loads/:id/drop-hook'", start);

function editDroppedLoad(existingDriver, requestedDriver) {
  const existing = {
    id: 'LD-DROP', companyId: 'company-1', status: 'Dropped',
    workflowType: 'DROP_AND_PICK', driver: existingDriver,
    returnLocation: '', notes: 'Before', droppedBy: 'DRV-001',
  };
  let handler;
  let updated;
  let code = 200;
  let result;
  let synced = false;
  const context = {
    app: { put: (_path, _auth, callback) => { handler = callback; } },
    authenticate: () => {}, console: { log() {}, error() {} },
    findDuplicateContainerLoad: (_company, _container, _id, cb) => cb(null, null),
    normalizeLoadWorkflow: (value) => value,
    normalizeDriverAssignment: (_company, value, cb) => cb(null, value || ''),
    getStatusAfterDriverAssignment: (_driver, status, fallback) => status || fallback,
    isTruthy: (value) => value === true || value === 1,
    parseNumericField: (value) => Number(value) || 0,
    getChangedFields: () => ({}), writeAuditLog() {},
    syncLoadMoves: (_load, cb) => { synced = true; cb(null); },
    attachMovesToLoads: (loads, cb) => cb(null, loads),
    db: {
      get: (_sql, _args, cb) => cb(null, updated || existing),
      run(sql, args, cb) {
        const fields = sql.split('SET')[1].split('WHERE')[0].split(',').map((part) => part.split('=')[0].trim());
        updated = { ...existing };
        fields.forEach((field, index) => { updated[field] = args[index]; });
        cb.call({ changes: 1 }, null);
      },
    },
  };
  vm.runInNewContext(source.slice(start, end), context);
  const res = { status(value) { code = value; return this; }, json(value) { result = value; } };
  handler({ params: { id: existing.id }, company: { companyId: existing.companyId },
    body: { ...existing, driver: requestedDriver, notes: 'Edited without scheduling return' } }, res);
  return { code, result, updated, synced };
}

for (const driver of ['', 'DRV-001']) {
  test(`dropped load details save without return with ${driver || 'no driver'}`, () => {
    const { code, result, synced } = editDroppedLoad(driver, driver);
    assert.equal(code, 200);
    assert.equal(result.notes, 'Edited without scheduling return');
    assert.equal(result.status, 'Dropped');
    assert.equal(result.driver, driver);
    assert.equal(result.droppedBy, 'DRV-001');
    assert.equal(result.returnLocation, '');
    assert.equal(synced, true);
  });
}

for (const driver of ['', 'DRV-001']) {
  test(`assigning a new driver to a dropped load still requires Ready for Pickup (${driver || 'unassigned'})`, () => {
    const { code, result, updated, synced } = editDroppedLoad(driver, 'DRV-002');
    assert.equal(code, 409);
    assert.match(result.error, /Ready for Pickup/);
    assert.equal(updated, undefined);
    assert.equal(synced, false);
  });
}
