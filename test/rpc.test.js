import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { confirmFromEvent, sacContractId, parseTransferEvent, findTransferConfirmation } from "../src/rpc.js";
import { USDC_TESTNET_ISSUER } from "../src/match.js";

// Recorded from Stellar testnet RPC getEvents (no network in tests).
const fx = (n) => JSON.parse(readFileSync(new URL(`./fixtures/${n}`, import.meta.url), "utf8"));
const usdcEv = fx("usdc-transfer-event.json"); // 1.50 USDC to the Genghis testnet account
const xlmEv = fx("xlm-transfer-event.json");   // 341.4292419 XLM to the Genghis testnet account
const TO = "GAMXQ2KPDSVCBU7VCRJROBOUT3RM2VMIVCXVMAW3EYZKBO7TJEYBG4NN";
const usdcOrder = { asset: "USDC", issuer: USDC_TESTNET_ISSUER, amount: "1.50", to: TO };
const xlmOrder = { asset: "XLM", amount: "341.4292419", to: TO };

test("USDC contract id derives from the testnet asset", () => {
  assert.equal(sacContractId("USDC", USDC_TESTNET_ISSUER), "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA");
  assert.equal(usdcEv.contractId, sacContractId("USDC", USDC_TESTNET_ISSUER));
});

test("parses a recorded USDC transfer: amount in stroops, recipient, ledger", () => {
  const ev = parseTransferEvent(usdcEv);
  assert.equal(ev.fn, "transfer");
  assert.equal(ev.to, TO);
  assert.equal(ev.amount, 15000000n);
  assert.equal(ev.ledger, usdcEv.ledger);
});

test("exact USDC transfer matches, and carries ledger and hash", () => {
  const r = confirmFromEvent(usdcEv, { ...usdcOrder, txHash: usdcEv.txHash });
  assert.equal(r.match, true);
  assert.equal(r.ledger, usdcEv.ledger);
});

test("exact XLM transfer matches against the native contract", () => {
  assert.equal(confirmFromEvent(xlmEv, xlmOrder).match, true);
});

test("wrong amount does not match, even by one stroop", () => {
  assert.equal(confirmFromEvent(usdcEv, { ...usdcOrder, amount: "1.4999999" }).match, false);
  assert.equal(confirmFromEvent(usdcEv, { ...usdcOrder, amount: "1.5000001" }).match, false);
});

test("wrong asset or issuer does not match", () => {
  assert.equal(confirmFromEvent(usdcEv, { ...usdcOrder, asset: "XLM" }).match, false);
  assert.equal(confirmFromEvent(usdcEv, { ...usdcOrder, issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" }).match, false);
  assert.equal(confirmFromEvent(xlmEv, usdcOrder).match, false);
});

test("wrong recipient does not match", () => {
  const r = confirmFromEvent(usdcEv, { ...usdcOrder, to: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" });
  assert.equal(r.match, false);
  assert.match(r.reason, /recipient/);
});

test("a different transaction hash does not match", () => {
  assert.equal(confirmFromEvent(usdcEv, { ...usdcOrder, txHash: "0".repeat(64) }).match, false);
});

test("a malformed event does not match and does not throw", () => {
  assert.equal(confirmFromEvent({ topic: ["x"], value: "y" }, usdcOrder).match, false);
});

test("findTransferConfirmation uses a fake RPC and finds the event", async () => {
  const calls = [];
  const fetchImpl = async (_url, init) => {
    const { method } = JSON.parse(init.body);
    calls.push(method);
    const result = method === "getLatestLedger" ? { sequence: usdcEv.ledger + 1 } : { events: [usdcEv] };
    return { json: async () => ({ result }) };
  };
  const r = await findTransferConfirmation({ ...usdcOrder, txHash: usdcEv.txHash }, { ledgerHint: usdcEv.ledger, fetchImpl, timeoutMs: 2000 });
  assert.equal(r.match, true);
  assert.deepEqual(calls, ["getLatestLedger", "getEvents"]);
});

test("findTransferConfirmation rejects on an RPC error", async () => {
  const fetchImpl = async () => ({ json: async () => ({ error: { message: "boom" } }) });
  await assert.rejects(findTransferConfirmation(usdcOrder, { ledgerHint: 1, fetchImpl, timeoutMs: 500 }), /boom/);
});
