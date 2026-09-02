import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractGateTransactionNumbersFromHistory,
  getPortHoustonEirCategoryFromSubType,
} from '../integrations/portHouston.js';

test('classifies Port Houston EIR transaction directions', () => {
  assert.equal(getPortHoustonEirCategoryFromSubType('DI'), 'OUT EIR');
  assert.equal(getPortHoustonEirCategoryFromSubType('DE'), 'IN EIR');
  assert.equal(getPortHoustonEirCategoryFromSubType('RM'), 'IN EIR');
  assert.equal(getPortHoustonEirCategoryFromSubType('RE'), 'OUT EIR');
});

test('extracts gate transaction nbr from equipment history batch number', () => {
  assert.deepEqual(
    extractGateTransactionNumbersFromHistory({
      events: [
        { relatedBatchNbr: '21343189', eventTypeId: 'UNIT_OUT_GATE' },
        { relatedBatchNbr: 'not-a-number' },
      ],
    }),
    ['21343189']
  );
});

test('normalizes subtype casing and rejects unknown EIR subtypes', () => {
  assert.equal(getPortHoustonEirCategoryFromSubType(' di '), 'OUT EIR');
  assert.equal(getPortHoustonEirCategoryFromSubType(''), '');
  assert.equal(getPortHoustonEirCategoryFromSubType('UNKNOWN'), '');
});
