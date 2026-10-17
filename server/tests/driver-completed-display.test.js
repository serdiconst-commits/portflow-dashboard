import test from 'node:test';
import assert from 'node:assert/strict';
import { driverCompletedDisplay } from '../../shared/driverCompletedDisplay.js';
const delivery = { id:'done', moveType:'LIVE_DELIVERY', status:'Completed', driverId:'DRV-A', driverRate:'275', origin:'Bayport', destination:'Carmine', completedAt:'2026-10-07T15:00:00Z', sequence:1 };
const pending = { id:'pending', moveType:'RETURN', status:'Planned', origin:'Carmine', destination:'Bayport', driverRate:'', sequence:2 };
const fixture = () => ({id:'LD-0562',status:'Delivered',driver:'DRV-A',driverRate:'275',pickup:'Bayport',delivery:'Carmine',returnLocation:'Bayport',moves:[{...delivery},{...pending}],currentMove:{...pending}});
test('completed driver history uses their completed delivery instead of a planned unpaid return',()=>{
 const load=fixture(), before=structuredClone(load), result=driverCompletedDisplay(load,'drv-a');
 assert.equal(result.currentMove.origin,'Bayport');assert.equal(result.currentMove.destination,'Carmine');assert.equal(result.currentMove.driverRate,'275');
 assert.deepEqual(load,before);assert.notEqual(result.currentMove,load.moves[0]);
});
test('active driver work is unchanged',()=>{
 const load={...fixture(),status:'In Transit'};assert.equal(driverCompletedDisplay(load,'DRV-A'),load);
});
test('another driver completed movement and cancelled or pending moves cannot replace own history',()=>{
 const load=fixture();load.moves.push({...delivery,id:'foreign',driverId:'DRV-B',sequence:3,completedAt:'2026-10-08T00:00:00Z',driverRate:'999'});
 assert.equal(driverCompletedDisplay(load,'DRV-A').currentMove.id,'done');
 load.moves[0].status='Cancelled';assert.equal(driverCompletedDisplay(load,'DRV-A').currentMove,null);
});
test('legacy completed loads ignore pending currentMove and retain load-level route and pay',()=>{
 const result=driverCompletedDisplay({...fixture(),moves:[pending]},'DRV-A');
 assert.equal(result.currentMove,null);assert.equal(result.pickup,'Bayport');assert.equal(result.driverRate,'275');
});
test('missing live-delivery pay can use saved load pay but explicit zero and separate-leg pay remain intact',()=>{
 for(const [rate,expected] of [['','275'],[0,0],['0','0'],['125','125']]) {
  const load=fixture();load.moves[0].driverRate=rate;assert.equal(driverCompletedDisplay(load,'DRV-A').currentMove.driverRate,expected);
 }
 const load=fixture();load.moves[0]={...delivery,moveType:'PRE_PULL',driverRate:''};assert.equal(driverCompletedDisplay(load,'DRV-A').currentMove.driverRate,'');
});
test('a genuinely completed return uses its own route and pay, and completion owner wins',()=>{
 const load=fixture();load.moves.push({...pending,status:'Completed',completedBy:'DRV-A',driverId:'DRV-B',completedAt:'2026-10-07T18:00:00Z',driverRate:'80'});
 const result=driverCompletedDisplay(load,'DRV-A');assert.equal(result.currentMove.moveType,'RETURN');assert.equal(result.currentMove.driverRate,'80');
});
