import test from 'node:test';
import assert from 'node:assert/strict';
import { isDriverLoadActive, filterDriverCompletedLoads } from '../../src/utils/driverCompletedLoads.js';

test('dispatch completion removes a load without POD from active work and preserves driver history', () => {
  const assigned = {
    id: 'LD-1', driver: 'DRV-1', status: 'In Transit', documents: [],
    currentMove: { driverId: 'DRV-1', status: 'In Transit' },
  };
  assert.equal(isDriverLoadActive(assigned), true);
  assert.deepEqual(filterDriverCompletedLoads([assigned], 'DRV-1'), []);
  const completed = { ...assigned, status: 'Completed' };
  assert.deepEqual([completed].filter(isDriverLoadActive), []);
  assert.deepEqual(filterDriverCompletedLoads([completed], 'DRV-1'), [completed]);
  assert.deepEqual(filterDriverCompletedLoads([completed], 'DRV-2'), []);
  assert.equal(isDriverLoadActive({ ...completed, status: 'Dispatched' }), true);
});

test('terminal statuses leave active work with or without paperwork', () => {
  for (const status of ['Completed', 'Delivered', 'Dropped', ' COMPLETED ']) {
    for (const documents of [[], [{ category: 'POD' }]]) {
      assert.equal(isDriverLoadActive({ status, documents }), false);
    }
  }
  for (const status of ['Dispatched', 'Arrived at Pickup', 'Loaded', 'In Transit']) {
    assert.equal(isDriverLoadActive({ status, documents: [] }), true);
  }
});
