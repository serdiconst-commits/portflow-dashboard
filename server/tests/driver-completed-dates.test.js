import test from 'node:test';
import assert from 'node:assert/strict';
import { filterDriverCompletedLoads, getDriverCompletion } from '../../src/utils/driverCompletedLoads.js';
const load = (id, date, extra = {}) => ({ id, driver: 'Juan', status: 'Delivered', moves: date ? [{ status: 'Completed', completedBy: 'Juan', completedAt: date }] : [], ...extra });
const loads = [load('LD-1', '2026-09-12T18:00:00Z'), load('LD-2', '2026-09-14T03:00:00Z'), load('LD-3', '2026-09-13T06:00:00Z'), load('LD-4', null, { appointmentTime: '2026-09-30T12:00:00Z' })];
test('completed history uses actual completion newest first and leaves missing dates last', () => {
 assert.deepEqual(filterDriverCompletedLoads(loads, 'Juan').map(l=>l.id), ['LD-2','LD-3','LD-1','LD-4']);
 assert.equal(getDriverCompletion(loads[3], 'Juan').day, '');
 assert.equal(loads[0].id, 'LD-1');
});
test('same-day calendar search includes the whole company-local day across UTC midnight', () => {
 assert.deepEqual(filterDriverCompletedLoads(loads, 'Juan', '2026-09-13','2026-09-13').map(l=>l.id), ['LD-2','LD-3']);
 assert.equal(getDriverCompletion(loads[1], 'Juan').day, '2026-09-13');
});
test('ranges are inclusive, allow one open end, clear to all, and reject reversed dates', () => {
 assert.equal(filterDriverCompletedLoads(loads,'Juan','2026-09-12','2026-09-13').length,3);
 assert.equal(filterDriverCompletedLoads(loads,'Juan','','2026-09-12').length,1);
 assert.equal(filterDriverCompletedLoads(loads,'Juan','2026-09-13','').length,2);
 assert.equal(filterDriverCompletedLoads(loads,'Juan','','').length,4);
 assert.equal(filterDriverCompletedLoads(loads,'Juan','2026-09-14','2026-09-12').length,0);
});
test('only the current driver completed loads appear; unrelated movements do not set their dates', () => {
 const own=load('OWN','2026-09-12T18:00:00Z');own.moves.push({status:'Completed',completedBy:'Pedro',completedAt:'2026-09-15T18:00:00Z'});
 assert.equal(getDriverCompletion(own,'Juan').day,'2026-09-12');
 assert.deepEqual(filterDriverCompletedLoads([own,load('FOREIGN',null,{driver:'Pedro'}),load('ACTIVE',null,{status:'Dispatched'}),load('COMPLETE',null,{status:'Completed',completedAt:'2026-09-11'})],'Juan').map(l=>l.id),['OWN','COMPLETE']);
});
