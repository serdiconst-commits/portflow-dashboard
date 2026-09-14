import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAvailability } from '../integrations/portHouston.js';

const sizes = {
  '22 GP': '20 ST', '22 UT': '20 UP', '22 RT': '20 RF', '22 TN': '20 TK',
  '42 GP': '40 ST', '42 RT': '40 RF ST', '42 UT': '40 UP ST',
  '45 GP': '40 HC', '45 10': '40 HC', '45 00': '40 HC', '45 RT': '40 RF HC',
  'L5 GP': '45 HC', 'L5 R1': '45 RF',
};
for (const [code, expected] of Object.entries(sizes)) {
  test(`Port Houston Smart Lookup maps ${code} to ${expected}`, () => {
    for (const field of ['eqtypeId', 'ctrTypeId', 'equipmentType', 'isoGroup']) {
      for (const variant of [code, code.replaceAll(' ', ''), `  ${code.toLowerCase()}  `]) {
        const result = normalizeAvailability({ content: [{ unitId: 'TEST1234567', [field]: variant }] });
        assert.equal(result.containerSize, expected, `${field}: ${variant}`);
      }
    }
  });
}
test('existing size mappings remain supported', () => {
  const existing = { '45G1': '40 HC', '42G1': '40 ST', '22G1': '20 ST', '40HC': '40 HC', '40HQ': '40 HC', '40ST': '40 ST', '20ST': '20 ST', '40RF': '40 RF' };
  for (const [eqtypeId, expected] of Object.entries(existing)) {
    assert.equal(normalizeAvailability({ content: [{ eqtypeId }] }).containerSize, expected);
  }
});
test('unknown or missing codes are not guessed', () => {
  assert.equal(normalizeAvailability({ content: [{ eqtypeId: 'UNKNOWN' }] }).containerSize, 'UNKNOWN');
  assert.equal(normalizeAvailability({ content: [{}] }).containerSize, '');
});
