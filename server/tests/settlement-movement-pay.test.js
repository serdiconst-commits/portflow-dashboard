import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const getter = source.slice(source.indexOf('  const getSettlementPayValue ='), source.indexOf('  const getSettlementPayTotal ='));
const normalize = value => String(value || '').trim().toLowerCase();
const load = { id: 'LOAD-1', driverRate: '80', moves: [
  { driverId: 'juan', completedBy: 'juan', driverRate: '125', status: 'Completed' },
  { driverId: 'pedro', completedBy: 'pedro', driverRate: '80', status: 'Completed' },
] };
function pay(driver, value = load, drafts = {}) {
  const fn = new Function('activeSettlementDriverId', 'settlementPayDrafts', 'normalizeDriverForStorage', 'parseMoney', 'formatMoney', `${getter}; return getSettlementPayValue;`)(driver, drafts, normalize, v => Number(v || 0), v => v.toFixed(2));
  return Number(fn(value, 'driverRate'));
}
test('settlement sheet, review and exports use each driver movement pay', () => {
  assert.equal(pay('juan'), 125);
  assert.equal(pay('pedro'), 80);
});
test('movement pay preserves zero and sums both legs for the same driver', () => {
  assert.equal(pay('juan', { ...load, moves: [{ ...load.moves[0], driverRate: '0' }] }), 0);
  assert.equal(pay('juan', { ...load, moves: load.moves.map(m => ({ ...m, driverId: 'juan', completedBy: 'juan' })) }), 205);
});
test('legacy loads retain their pay and stale general drafts cannot replace movement pay', () => {
  assert.equal(pay('juan', { ...load, moves: [] }), 80);
  assert.equal(pay('juan', load, { 'LOAD-1': { driverRate: '80' } }), 125);
});

test('saving settlement adjustments preserves the load rate and does not overwrite a movement statement line', async () => {
  const start = source.indexOf('const handleSaveSettlementPay =');
  const handler = source.slice(start, source.indexOf('const handleDeleteLoad =', start));
  const requests = [];
  let refreshed = false;
  const noop = () => {};
  const context = {
    isActiveSettlementEditable: true, hasSettlementMovementPay: () => true,
    settlementPayDrafts: { 'LOAD-1': { driverRate: '999', lumper: '20' } },
    calculateLoadSettlement: () => 0, normalizeDriverForStorage: normalize,
    getDriverTruck: () => '', getPaperworkStatusFromDocuments: () => '',
    API_BASE: '', authToken: 'test',
    fetch: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { ok: true, json: async () => ({ ...load }) };
    },
    setLoadsData: noop, setSelectedLoad: noop, setEditingLoad: noop,
    activeBackendSettlement: { id: 'SETTLEMENT', statement: { loads: [{ loadId: load.id, settlementLoadId: 'DROP-LINE' }] } },
    activeSettlementDriverId: 'juan', setActiveBackendSettlement: noop,
    setSettlementBackendStatus: noop, handleResetSettlementPayDraft: noop,
    setSettlementPayStatus: noop, fetchActiveBackendSettlement: async () => { refreshed = true; },
  };
  const save = new Function(...Object.keys(context), `${handler}; return handleSaveSettlementPay;`)(...Object.values(context));
  await save(load);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.driverRate, '80');
  assert.equal(requests[0].body.lumper, '20');
  assert.equal(refreshed, true);
});

test('Quick Change Drop calls the driver status endpoint and reloads server movement state', async () => {
  const handler = source.slice(source.indexOf('const handleQuickStatusChange ='), source.indexOf('const handleSaveDropDetails ='));
  const calls = [];
  const context = {
    selectedLoad: { id: 'LOAD-1', driver: 'juan', driverRate: '125' },
    normalizeDriverForStorage: normalize, setDropDetailsDraft: () => {}, buildDropDetailsDraft: v => v,
    API_BASE: '', authToken: 'test',
    fetch: async (url, options) => { calls.push({ url, body: JSON.parse(options.body) }); return { ok: true }; },
    fetchLoads: async () => calls.push('refresh'), setEditingLoad: () => {},
    fetchSelectedLoadAuditLogs: async () => {}, alert: message => assert.fail(message),
  };
  const change = new Function(...Object.keys(context), `${handler}; return handleQuickStatusChange;`)(...Object.values(context));
  await change({ target: { value: 'Dropped' } });
  assert.equal(calls[0].url, '/api/loads/LOAD-1/status');
  assert.equal(calls[0].body.status, 'Dropped');
  assert.equal(calls[0].body.droppedBy, 'juan');
  assert.equal(calls[1], 'refresh');
});
