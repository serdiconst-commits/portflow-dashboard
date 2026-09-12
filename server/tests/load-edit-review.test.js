import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getLoadEditChanges } from '../../src/utils/loadEditReview.js';
import { reconcileLoadMoves } from '../loadMovePlan.js';

test('review lists changed fields with before/after values and skips equivalent money formats', () => {
  const before = { workflowType: 'LIVE_DELIVERY', driverRate: '$100.00', driver: '', returnLocation: '', notes: 'Old' };
  const after = { ...before, workflowType: 'PRE_PULL_LIVE', driverRate: '100', notes: 'Updated', driver: 'JUAN' };
  assert.deepEqual(getLoadEditChanges(before, after, () => 'Juan'), [
    { key: 'driver', label: 'Driver', before: '(empty)', after: 'Juan' },
    { key: 'workflowType', label: 'Load flow', before: 'Live Delivery', after: 'Pre-Pull Live Load' },
    { key: 'notes', label: 'Notes', before: 'Old', after: 'Updated' },
  ]);
  assert.deepEqual(getLoadEditChanges({ streetTurn: 1 }, { streetTurn: true }), []);
});

test('review includes removed locations and changed pay, without treating a blank return as required', () => {
  assert.deepEqual(getLoadEditChanges({ returnLocation: 'Depot', driverRate: '100' }, { returnLocation: '', driverRate: '0' }), [
    { key: 'returnLocation', label: 'Return location', before: 'Depot', after: '(empty)' },
    { key: 'driverRate', label: 'Driver pay', before: '$100.00', after: '$0.00' },
  ]);
});

test('changing an active regular movement to pre-pull preserves its identity, driver and pay', () => {
  const existing = [{ id: 'MOVE', sequence: 1, status: 'In Transit', moveType: 'LIVE_DELIVERY', origin: 'Bayport', destination: 'Customer', driverId: 'Juan', driverRate: '100' }];
  const previous = { workflowType: 'LIVE_DELIVERY', driver: 'Juan', driverRate: '100' };
  const load = { ...previous, workflowType: 'PRE_PULL_LIVE' };
  const templates = [{ moveType: 'PRE_PULL', origin: 'Bayport', destination: '', status: 'Assigned', driverId: 'Juan', driverRate: '100' },
    { moveType: 'DELIVERY', origin: '', destination: 'Customer', status: 'Planned', driverId: '', driverRate: '' }];
  const plan = reconcileLoadMoves(load, existing, templates, previous);
  assert.equal(plan[0].id, 'MOVE');
  assert.equal(plan[0].moveType, 'PRE_PULL');
  assert.equal(plan[0].status, 'In Transit');
  assert.equal(plan[0].driverRate, '100');
  assert.equal(plan[1].driverId, '');
});

test('workflow edits retain completed movement identity, route and pay', () => {
  const done = { id: 'DROP', sequence: 1, status: 'Completed', moveType: 'DROP', origin: 'Bayport', destination: 'Plastics', driverId: 'Juan', driverRate: '100' };
  const result = reconcileLoadMoves({ workflowType: 'PRE_PULL_LIVE', driverRate: '200' }, [done],
    [{ moveType: 'PRE_PULL' }, { moveType: 'DELIVERY', status: 'Planned' }], { workflowType: 'DROP_AND_PICK', driverRate: '100' });
  assert.deepEqual(result[0], done);
});

for (const confirm of [false, true]) {
  test(`save handler ${confirm ? 'sends the reviewed payload after confirmation' : 'does not save when review is cancelled'}`, async () => {
    const source = await readFile(new URL('../../src/App.jsx', import.meta.url), 'utf8');
    const handler = source.slice(source.indexOf('const handleUpdateLoad ='), source.indexOf('const getPortHoustonSummary ='));
    const before = { id: 'LD-1', notes: 'Before', driver: '', returnLocation: '', workflowType: 'LIVE_DELIVERY', status: 'Pending', miles: '10' };
    const draft = { ...before, notes: 'After', workflowType: 'PRE_PULL_LIVE' };
    let writes = 0;
    let review;
    let sent;
    const noop = () => {};
    const context = { editingLoad: draft, editLoadBaseline: { current: before }, loadEditSaving: { current: false },
      getLoadEditChanges, getDriverLabel: (value) => value, loadsData: [before],
      alert: noop, console, setIsEditing: noop, getTodayDate: () => '2026-09-12', getDriverTruck: () => '',
      calculateLoadSettlement: () => 0, getPaperworkStatusFromDocuments: () => 'Pending',
      findDuplicateContainerLoad: () => null, getLoadMilesForSave: async () => '10',
      normalizeDriverForStorage: (value) => value || '', getStatusAfterDriverAssignment: (_driver, status) => status,
      setLoadEditReview: (value) => { review = value; assert.equal(writes, 0); value.resolve(confirm); },
      API_BASE: '/test', authToken: 'fake-test-token',
      fetch: async (_url, options) => { writes++; sent = JSON.parse(options.body); return { ok: true, json: async () => sent }; },
      setLoadsData: noop, setSelectedLoad: noop, setEditingLoad: noop, setCompletedEditingLoadId: noop,
      fetchSelectedLoadAuditLogs: async () => {},
    };
    const update = vm.runInNewContext(handler + '\nhandleUpdateLoad', context);
    await update({ preventDefault() {} });
    assert.equal(review.loadId, 'LD-1');
    assert.ok(review.changes.some((change) => change.key === 'workflowType' && change.after === 'Pre-Pull Live Load'));
    assert.equal(writes, confirm ? 1 : 0);
    if (confirm) { assert.equal(sent.driver, ''); assert.equal(sent.returnLocation, ''); assert.equal(sent.notes, 'After'); }
    assert.equal(context.loadEditSaving.current, false);
  });
}
