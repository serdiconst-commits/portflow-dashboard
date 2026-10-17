import test from 'node:test';
import assert from 'node:assert/strict';
import sqlite3 from 'sqlite3';
import { dbRun, dbGet } from '../services/dbUtils.js';
import { createLoadExtraChargesHandler } from '../services/loadExtraCharges.js';

async function fixture(t) {
  const db = new sqlite3.Database(':memory:');
  t.after(() => new Promise(resolve => db.close(resolve)));
  await dbRun(db, `CREATE TABLE loads(id TEXT, companyId TEXT, status TEXT, driver TEXT, rate TEXT, driverRate TEXT, deletedAt TEXT, customerExtraChargesJson TEXT, PRIMARY KEY(id,companyId))`);
  for (const [id, status] of [['ACTIVE','In Transit'],['DONE','Completed']]) {
    await dbRun(db, `INSERT INTO loads VALUES(?, 'A', ?, 'DRV-1', '1000', '250', '', '[]')`, [id,status]);
  }
  const events = [];
  const handler = createLoadExtraChargesHandler(db, (_req, event) => events.push(event));
  const save = async (id, charges, companyId = 'A', extra = {}) => {
    let status = 200, body;
    await handler({params:{id},company:{companyId},body:{charges,...extra}}, {
      status(code){status=code;return this;}, json(value){body=value;return this;},
    });
    return {status,body};
  };
  return {db,events,save};
}

test('active and completed loads save customer charges without changing operations or driver pay', async t => {
  const {db,events,save}=await fixture(t);
  for (const id of ['ACTIVE','DONE']) {
    const before = await dbGet(db,'SELECT * FROM loads WHERE id=?',[id]);
    const result = await save(id,[{type:'Storage Charge',description:'Two days',amount:80.25}], 'A', {status:'Completed',driver:'OTHER',driverRate:'0'});
    assert.equal(result.status,200);
    const after=await dbGet(db,'SELECT * FROM loads WHERE id=?',[id]);
    assert.deepEqual({...after,customerExtraChargesJson:before.customerExtraChargesJson},before);
    assert.equal(JSON.parse(after.customerExtraChargesJson)[0].amount,80.25);
    assert.equal(Number(after.rate)+result.body.customerExtraCharges[0].amount,1080.25);
    assert.equal((await save(id,[])).status,200);
    assert.equal((await dbGet(db,'SELECT customerExtraChargesJson FROM loads WHERE id=?',[id])).customerExtraChargesJson,'[]');
  }
  assert.equal(events.length,4);
  assert.equal(events[0].action,'CUSTOMER_EXTRA_CHARGES_UPDATED');
});

test('extra charges reject cross-company, deleted, and invalid requests', async t => {
  const {db,save,events}=await fixture(t);
  assert.equal((await save('ACTIVE',[], 'B')).status,404);
  for (const bad of [null,{},[{amount:'bad'}],[{amount:null}],[{amount:Infinity}]]) {
    assert.equal((await save('ACTIVE',bad)).status,400);
  }
  await dbRun(db,"UPDATE loads SET deletedAt='2026-10-01' WHERE id='ACTIVE'");
  assert.equal((await save('ACTIVE',[])).status,404);
  assert.equal(events.length,0);
});
