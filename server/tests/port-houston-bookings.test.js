import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bookingEquipment, normalizeBookings, validateBookingNumber } from '../portHoustonBookings.js';

const booking = { nbr: '276944584', subType: 'BOOK', lineId: 'MAE', lineScac: 'MAEU', visit: {facilityId: 'BPT', carrierName: 'MAERSK SUPERIOR'}, items: [{eqSize:'NOM40',eqIsoGroup:'GP',eqHeight:'NOM96',isOog:false}] };
test('real EVP booking maps Maersk, 40 HC and the full return terminal', () => {
  const [result] = normalizeBookings([booking], booking.nbr);
  assert.equal(result.shipLine, 'MAE');
  assert.equal(result.terminalName, 'Bayport Container Terminal');
  assert.equal(result.vesselName, 'MAERSK SUPERIOR');
  assert.equal(result.equipment[0].containerSize, '40 HC');
});
test('ignores unrelated orders and duplicate results; never substitutes scope for vessel terminal', () => {
  assert.equal(normalizeBookings([booking, booking, {...booking,nbr:'other'}, {...booking,subType:'ERO'}],booking.nbr).length,1);
  const [result] = normalizeBookings([{...booking,scope:{facility_id:'BCT'},visit:{}}],booking.nbr);
  assert.equal(result.terminalName,'');
});
test('retains multiple equipment choices and leaves unknown or OOG types manual', () => {
  const [result] = normalizeBookings([{...booking,items:[...booking.items,{eqSize:'NOM20',eqIsoGroup:'GP',eqHeight:'NOM86'}]}],booking.nbr);
  assert.deepEqual(result.equipment.map(x=>x.containerSize),['40 HC','20 ST']);
  assert.equal(bookingEquipment({eqSize:'NOM40',eqIsoGroup:'GP'}).containerSize,'');
  assert.equal(bookingEquipment({...booking.items[0],isOog:true}).containerSize,'');
  assert.equal(bookingEquipment({eqSize:'NOM40',eqIsoGroup:'UNKNOWN',eqHeight:'NOM96'}).containerSize,'');
});
test('rejects predicate injection, blank and oversized booking numbers', () => {
  for (const value of ['', '1 or nbr = 2', 'x"', 'a'.repeat(65), ['123']]) assert.equal(validateBookingNumber(value),false);
  for (const value of ['276944584','ABC-123/4','038NY1460969']) assert.equal(validateBookingNumber(value),true);
});
const source = await readFile(new URL('../server.js',import.meta.url),'utf8');
function route(extras) {
  let handler;
  let middleware;
  const context = { app:{get(_path,auth,fn){middleware=auth;handler=fn;}}, authenticate(){},validateBookingNumber,...extras };
  const start = source.indexOf("app.get('/api/port-houston/booking-lookup'");
  const end = source.indexOf("app.get('/api/port-houston/load-lookup'",start);
  new Function(...Object.keys(context),source.slice(start,end))(...Object.values(context));
  assert.equal(middleware,context.authenticate);
  return async bookingNumber => {
    let status=200,body;
    await handler({query:{bookingNumber},company:{companyId:'tenant-a'}},{status(v){status=v;return this;},json(v){body=v;}});
    return {status,body};
  };
}
test('authenticated route uses the current company credentials and returns only normalized results',async () => {
  const credentials={clientId:'private',clientSecret:'secret'};
  const call=route({getCompanyPortHoustonCredentials:async id=>{assert.equal(id,'tenant-a');return credentials;},getBookingInquiry:async(number,creds)=>{assert.equal(number,booking.nbr);assert.equal(creds,credentials);return {bookings:normalizeBookings([booking],number)};}});
  const result=await call(booking.nbr);
  assert.equal(result.status,200);
  assert.equal(result.body.bookings[0].terminal,'BPT');
  assert.equal(JSON.stringify(result).includes('secret'),false);
});
test('route validates before calling EVP and hides provider auth errors',async () => {
  const call=route({getCompanyPortHoustonCredentials:async()=>({}),getBookingInquiry:async()=>{throw Object.assign(new Error('private secret'),{status:403});}});
  assert.equal((await call('a or b')).status,400);
  const denied=await call(booking.nbr);
  assert.equal(denied.status,502);
  assert.match(denied.body.error,/authorize/);
  assert.equal(JSON.stringify(denied).includes('private secret'),false);
});
