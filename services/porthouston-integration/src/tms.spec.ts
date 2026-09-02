import test from "node:test";
import assert from "node:assert/strict";
import { getEirCategoryFromSubType } from "./tms.js";

test("classifies Port Houston EIR transaction directions", () => {
  assert.equal(getEirCategoryFromSubType("DI"), "OUT EIR");
  assert.equal(getEirCategoryFromSubType("DE"), "IN EIR");
  assert.equal(getEirCategoryFromSubType("RM"), "IN EIR");
  assert.equal(getEirCategoryFromSubType("RE"), "OUT EIR");
});

test("normalizes casing and rejects unknown EIR subtypes", () => {
  assert.equal(getEirCategoryFromSubType(" re "), "OUT EIR");
  assert.equal(getEirCategoryFromSubType("UNKNOWN"), "");
});
