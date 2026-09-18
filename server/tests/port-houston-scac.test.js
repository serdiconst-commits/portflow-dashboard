import test from 'node:test';
import assert from 'node:assert/strict';
import { getGateTransactionsByContainer, getGateTransactionsByNumbers } from '../integrations/portHouston.js';
import { requirePortHoustonScac, matchesPortHoustonScope, portHoustonDocumentMetadata, isPortHoustonDocumentVisible } from '../portHoustonScope.js';

const containerNumber = 'TEST1234567';
const credentials = scac => ({ username: 'test-company', password: 'test-secret', scac, containerNumber });
const row = (nbr, trkcoId, extra = {}) => ({ nbr, trkcoId, ctrId:containerNumber, subType:'DI', status:'COMPLETE', hasDocuments:true, ...extra });
function mockPort(t, records, shouldFail = () => false) {
  const queries = [];
  t.mock.method(globalThis, 'fetch', async (input, options) => {
    if (options?.method === 'POST') return Response.json({access_token:'test-token',expires_in:3600});
    const url = new URL(input);
    assert.equal(url.pathname.endsWith('/road/gatetransactions'), true);
    queries.push(url.searchParams);
    return shouldFail(url) ? Response.json({message:'Unsupported projection'}, {status:400}) : Response.json({content:records,paging:{}});
  });
  return queries;
}

test('server rejects foreign and unknown carriers even if the provider ignores predicates', async t => {
  const queries = mockPort(t,[row('10001','OTHER'),row('10002','LCTM'),row('10003',''),row('10004','LCTM',{ctrId:'OTHER1234567'}),row('10005','LCTM',{subType:'RM'})]);
  const result = await getGateTransactionsByContainer(containerNumber,credentials(' lctm '),'BCT');
  assert.deepEqual(result.transactions.map(r=>r.nbr).sort(),['10002','10005']);
  assert.equal(result.outEirTransaction.nbr,'10002');
  assert.equal(result.inEirTransaction.nbr,'10005');
  assert.equal(JSON.stringify(result.raw).includes('OTHER'),false);
  assert.ok(queries.length >= 2);
  for(const q of queries) assert.match(q.get('predicate'),/trkcoId=LCTM/);
});

test('a second company gets its own SCAC, never a Liberty default', async t => {
  mockPort(t,[row('10001','ABCD'),row('10002','LCTM')]);
  const result = await getGateTransactionsByContainer(containerNumber,credentials('ABCD'),'BPT');
  assert.deepEqual(result.transactions.map(r=>r.nbr),['10001']);
});

test('number and no-fields fallbacks retain SCAC and exact transaction/container checks', async t => {
  const queries = mockPort(t,[row('10001','ABCD'),row('10002','LCTM'),row('10003','LCTM')],url=>url.searchParams.has('fields'));
  const result = await getGateTransactionsByNumbers(['10001','10002'],credentials('LCTM'),'BPT');
  assert.deepEqual(result.transactions.map(r=>r.nbr),['10002']);
  assert.ok(queries.some(q=>!q.has('fields')));
  for(const q of queries) assert.match(q.get('predicate'),/trkcoId=LCTM/);
});

test('missing SCAC or malformed lookup cannot make a broad provider request', async t => {
  const fetch = t.mock.method(globalThis,'fetch',()=>{ throw new Error('Must not call provider'); });
  await assert.rejects(getGateTransactionsByContainer(containerNumber,credentials('')), /SCAC/);
  await assert.rejects(getGateTransactionsByContainer('TEST or trkcoId=OTHER',credentials('LCTM')), /Invalid container/);
  await assert.rejects(getGateTransactionsByNumbers(['10001'],credentials('')), /SCAC/);
  assert.equal(fetch.mock.callCount(),0);
  for(const scac of ['LCTM or true','123','A','ABCDE']) assert.throws(()=>requirePortHoustonScac(scac));
});

test('no matching SCAC yields no EIR and no foreign raw records', async t => {
  const queries = mockPort(t,[row('10001','ABCD')]);
  const result = await getGateTransactionsByContainer(containerNumber,credentials('LCTM'),'BPT');
  assert.equal(result.transactions.length,0);
  assert.equal(result.outEirTransaction,null);
  assert.equal(result.inEirTransaction,null);
  assert.deepEqual(result.raw,[]);
  for(const q of queries) assert.match(q.get('predicate'),/trkcoId=LCTM/);
});

test('stored automatic EIRs are checked against current company and container', () => {
  const transaction = {nbr:'10002',truckingCompany:'LCTM',containerNumber};
  const doc={name:'eir.pdf',portHoustonMetadataJson:portHoustonDocumentMetadata(transaction,'LCTM',containerNumber),companyPortHoustonScac:'LCTM',loadContainerNumber:containerNumber};
  assert.equal(isPortHoustonDocumentVisible(doc),true);
  assert.equal(isPortHoustonDocumentVisible({...doc,companyPortHoustonScac:'ABCD'}),false);
  assert.equal(isPortHoustonDocumentVisible({...doc,companyPortHoustonScac:''}),false);
  assert.equal(isPortHoustonDocumentVisible({...doc,loadContainerNumber:'OTHER1234567'}),false);
  assert.throws(()=>portHoustonDocumentMetadata(transaction,'ABCD',containerNumber));
  assert.equal(matchesPortHoustonScope(transaction,'LCTM',''),false);
});

test('legacy automatic files wait for verification while ordinary paperwork stays available', () => {
  for(const name of ['TEST1234567-out-eir-10001-portflow-summary.pdf','LD-001-in-eir-10002.pdf']) {
    assert.equal(isPortHoustonDocumentVisible({name}),false);
  }
  assert.equal(isPortHoustonDocumentVisible({name:'ticket.pdf',category:'OUT EIR',filePath:'https://example.com/eir'}),false);
  assert.equal(isPortHoustonDocumentVisible({name:'signed-POD.pdf',category:'POD'}),true);
  assert.equal(isPortHoustonDocumentVisible({name:'manual-port-ticket.pdf',category:'OUT EIR'}),true);
});

test('reported EIR 21416143 / TCKU6053101 / JVXC is excluded for Liberty', async t => {
  mockPort(t,[row('21416143','JVXC',{ctrId:'TCKU6053101',subType:'DM',handled:'2026-09-10T17:26:00-05:00'})]);
  const result = await getGateTransactionsByContainer('TCKU6053101',credentials('LCTM'),'BPT');
  assert.deepEqual(result.transactions,[]);
  assert.equal(result.outEirTransaction,null);
  assert.equal(result.inEirTransaction,null);
});

test('document download rejects unverified or foreign transactions before HTTP', async t => {
  const { downloadGateTransactionDocument } = await import('../integrations/portHouston.js');
  const fetch = t.mock.method(globalThis,'fetch',()=>{ throw new Error('Must not call provider'); });
  await assert.rejects(downloadGateTransactionDocument('21416143',credentials('LCTM'),{nbr:'21416143',truckingCompany:'JVXC',containerNumber}));
  await assert.rejects(downloadGateTransactionDocument('21416143',credentials('LCTM')));
  assert.equal(fetch.mock.callCount(),0);
});

for (const method of ['container', 'transaction numbers']) {
  test(`Return Export RE is selected as IN EIR by ${method}, preserving OUT and SCAC isolation`, async t => {
    const records = [
      row('10001','LCTM',{subType:'DI'}),
      row('10002','LCTM',{subType:'RE'}),
      row('10003','OTHER',{subType:'RE'}),
    ];
    mockPort(t,records);
    const result = method === 'container'
      ? await getGateTransactionsByContainer(containerNumber,credentials('LCTM'),'BPT')
      : await getGateTransactionsByNumbers(['10001','10002','10003'],credentials('LCTM'),'BPT');
    assert.equal(result.inEirTransaction.nbr,'10002');
    assert.equal(result.inEirTransaction.eirType,'IN EIR');
    assert.equal(result.outEirTransaction.nbr,'10001');
    assert.equal(result.outEirTransaction.eirType,'OUT EIR');
    assert.deepEqual(result.transactions.map(item=>item.nbr).sort(),['10001','10002']);
  });
}

test('an RE-only container has an IN EIR and no OUT EIR', async t => {
  mockPort(t,[row('10002','LCTM',{subType:'RE'})]);
  const result = await getGateTransactionsByContainer(containerNumber,credentials('LCTM'),'BCT');
  assert.equal(result.inEirTransaction.nbr,'10002');
  assert.equal(result.outEirTransaction,null);
});
