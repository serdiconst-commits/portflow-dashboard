import test from 'node:test';
import assert from 'node:assert/strict';
import { initialDriverPushPermission } from '../../src/utils/driverPushPermission.js';
const storage = () => { const data = new Map(); return { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v) }; };

test('first sign-in asks once and subsequent checks respect a previous response', async () => {
  const store = storage(); let prompts = 0;
  const push = { checkPermissions: async () => ({receive:'prompt'}), requestPermissions: async () => { prompts++; return {receive:'denied'}; } };
  assert.equal((await initialDriverPushPermission(push, store)).receive, 'denied');
  await initialDriverPushPermission(push, store);
  assert.equal(prompts, 1);
});
test('existing grants and denials never trigger a new permission request', async () => {
  for (const receive of ['granted','denied']) {
    const result = await initialDriverPushPermission({checkPermissions:async()=>({receive}),requestPermissions:()=>assert.fail('must not prompt')},storage());
    assert.equal(result.receive, receive);
  }
});
test('concurrent mounts share the same OS prompt', async () => {
  const store = storage(); let prompts = 0, finish;
  const push = { checkPermissions:async()=>({receive:'prompt'}),requestPermissions:()=>{ prompts++; return new Promise(resolve=>{finish=resolve;}); } };
  const first = initialDriverPushPermission(push,store), second = initialDriverPushPermission(push,store);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(prompts,1);finish({receive:'granted'});
  assert.deepEqual(await Promise.all([first,second]),[{receive:'granted'},{receive:'granted'}]);
});
test('a failed OS request can retry later', async () => {
  const store=storage(); let attempts=0;
  const push={checkPermissions:async()=>({receive:'prompt'}),requestPermissions:async()=>{ if(++attempts===1)throw Error('unavailable'); return {receive:'granted'}; }};
  await assert.rejects(initialDriverPushPermission(push,store));
  assert.equal((await initialDriverPushPermission(push,store)).receive,'granted');
});
