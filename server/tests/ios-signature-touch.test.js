import test from 'node:test';
import assert from 'node:assert/strict';
import { bindIosSignatureTouch } from '../../src/utils/iosSignatureTouch.js';

function fixture() {
  const surface = new EventTarget();
  surface.getBoundingClientRect = () => ({ left: 10, top: 20, width: 200, height: 100 });
  const strokes = [];
  let locked = false;
  const cleanup = bindIosSignatureTouch(surface, {
    disabled: () => locked,
    start: p => strokes.push([p]),
    move: p => strokes.at(-1).push(p),
  });
  const send = (type, id = 1, x = 110, y = 70) => {
    const event = new Event(type, { cancelable: true });
    event.changedTouches = [{ identifier: id, clientX: x, clientY: y }];
    surface.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { strokes, send, cleanup, lock: () => { locked = true; } };
}

test('iOS signing cancels scroll and preserves separate normalized strokes', () => {
  const { strokes, send } = fixture();
  assert.equal(send('touchmove'), false);
  assert.equal(send('touchstart'), true);
  assert.equal(send('touchmove', 1, 500, -20), true);
  assert.equal(send('touchend'), true);
  assert.equal(send('touchmove'), false);
  send('touchstart', 2);
  send('touchend', 2);
  assert.deepEqual(strokes, [[{ x: .5, y: .5 }, { x: 1, y: 0 }], [{ x: .5, y: .5 }]]);
});

test('extra fingers do not join or end the active stroke; cancellation allows a fresh stroke', () => {
  const { strokes, send } = fixture();
  send('touchstart');
  send('touchstart', 2);
  send('touchmove', 2);
  send('touchend', 2);
  send('touchmove');
  send('touchcancel');
  send('touchmove');
  send('touchstart', 3);
  assert.deepEqual(strokes.map(s => s.length), [2, 1]);
});

test('locked signatures and unmounted surfaces cannot receive new strokes', () => {
  const { strokes, send, lock, cleanup } = fixture();
  send('touchstart');
  lock();
  send('touchmove');
  assert.equal(send('touchstart', 2), false);
  cleanup();
  assert.equal(send('touchmove'), false);
  assert.equal(send('touchstart'), false);
  assert.equal(strokes.length, 1);
  assert.equal(strokes[0].length, 1);
});
