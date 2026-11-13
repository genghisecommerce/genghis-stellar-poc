import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePayment, toStroops, USDC_TESTNET_ISSUER } from "../src/match.js";

const T0 = Date.parse("2026-11-13T10:00:00Z");
const order = { id: "G-ABC123", asset: "USDC", amount: "12.50", issuer: USDC_TESTNET_ISSUER, expiresAt: T0 + 600000 };
const usdc = (over = {}) => ({
  memo: "G-ABC123", asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: USDC_TESTNET_ISSUER,
  amount: "12.5000000", created_at: "2026-11-13T10:01:00Z", ...over,
});
const run = (payment, o = order, now = T0 + 120000) => evaluatePayment({ payment, order: o, now });

test("happy path: USDC, memo, issuer, exact amount before expiry delivers", () => {
  assert.equal(run(usdc()).decision, "deliver");
});

test("no memo holds for manual reconciliation", () => {
  assert.equal(run(usdc({ memo: undefined })).decision, "hold");
});

test("unknown memo holds for manual reconciliation", () => {
  assert.equal(run(usdc({ memo: "G-ZZZZZZ" })).decision, "hold");
  assert.equal(evaluatePayment({ payment: usdc(), order: null, now: T0 }).decision, "hold");
});

test("wrong asset refunds", () => {
  assert.equal(run(usdc({ asset_code: "EURC" })).decision, "refund");
});

test("wrong issuer refunds", () => {
  const r = run(usdc({ asset_issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" }));
  assert.equal(r.decision, "refund");
  assert.match(r.reason, /issuer/);
});

test("XLM sent directly to a USDC order refunds", () => {
  assert.equal(run(usdc({ asset_type: "native", asset_code: undefined, asset_issuer: undefined })).decision, "refund");
});

test("underpayment holds until expiry", () => {
  assert.equal(run(usdc({ amount: "12.4999999" })).decision, "hold");
});

test("underpayment after expiry refunds", () => {
  assert.equal(run(usdc({ amount: "12.4999999" }), order, T0 + 700000).decision, "refund");
});

test("overpayment delivers and reports the difference to refund", () => {
  const r = run(usdc({ amount: "13.2500000" }));
  assert.equal(r.decision, "deliver");
  assert.equal(r.refund_difference, "0.7500000");
});

test("payment after expiry with a known memo refunds", () => {
  const r = run(usdc({ created_at: "2026-11-13T10:11:00Z" }), order, T0 + 700000);
  assert.equal(r.decision, "refund");
});

test("XLM order paid in XLM delivers (the demo's second asset)", () => {
  const xlm = { id: "G-ABC123", asset: "XLM", amount: "83.3333333", expiresAt: T0 + 600000 };
  const p = usdc({ asset_type: "native", asset_code: undefined, asset_issuer: undefined, amount: "83.3333333" });
  assert.equal(run(p, xlm).decision, "deliver");
});

test("float trap: 0.1 + 0.2 style amounts are compared exactly in stroops", () => {
  assert.notEqual(0.1 + 0.2, 0.3);
  const o = { ...order, amount: "0.3000000" };
  assert.equal(run(usdc({ amount: "0.3000000" }), o).decision, "deliver");
  // one stroop short: a float comparison with a 1e-7 tolerance would wrongly accept it
  assert.equal(run(usdc({ amount: "0.2999999" }), o).decision, "hold");
  assert.equal(toStroops("0.1") + toStroops("0.2"), toStroops("0.3"));
  assert.throws(() => toStroops(String(0.1 + 0.2)));
});
