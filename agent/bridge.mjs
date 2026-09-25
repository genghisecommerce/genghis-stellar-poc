// Genghis x402 memo bridge: testnet prototype.
//
// A priced HTTP endpoint for AI agents, per ARCHITECTURE.md section 4.
// GET /buy without payment -> 402 with the payment requirements, including
// the memo the processor needs to attribute the deposit. Retry with an
// X-PAYMENT header carrying a signed classic Stellar payment -> the server
// verifies destination, asset, amount, memo and expiry, submits it to
// testnet, and returns the code in the response body.
//
// Testnet only. Prices come from the live Genghis catalogue (prices.json,
// read through the Genghis MCP server); the XLM amount uses the live
// XLM/USD rate. The "merchant" address stands in for the processor's
// shared deposit address, as in the browser proof of concept.

import http from "node:http";
import fs from "node:fs";
import crypto from "node:crypto";
import {
  TransactionBuilder, Networks, Asset, Horizon,
} from "@stellar/stellar-sdk";

const PORT = 4020;
const HORIZON = "https://horizon-testnet.stellar.org";
const MERCHANT = "GBBATDYWQWD4EPQNQQSTUABAF3COF2RZAOY6NHVOI5JU4PU4DDBPS673";
const PER_ORDER_CAP_USD = 500; // server-side cap, ARCHITECTURE.md section 7
const prices = JSON.parse(fs.readFileSync("prices.json", "utf8"));
const horizon = new Horizon.Server(HORIZON);
const orders = new Map(); // memo -> order (one memo, one order, used once)

async function xlmUsd() {
  const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd");
  return (await r.json()).stellar.usd;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body, null, 2));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/buy") return send(res, 404, { error: "not found" });

  const variation = url.searchParams.get("variation");
  const item = prices[variation];
  if (!item) return send(res, 404, { error: "unknown product" });
  if (item.price_usd > PER_ORDER_CAP_USD) return send(res, 403, { error: "over the per-order cap" });

  const payment = req.headers["x-payment"];
  if (!payment) {
    // First call: the server sets the price and issues a fresh memo.
    const rate = await xlmUsd();
    const amount = (item.price_usd / rate).toFixed(7);
    const memo = "GX" + crypto.randomInt(1e8, 1e9);
    orders.set(memo, { variation, amount, rate, used: false, expires: Date.now() + 120_000 });
    return send(res, 402, {
      x402Version: 1,
      error: "Payment required",
      accepts: [{
        scheme: "exact",
        network: "stellar-testnet",
        asset: "native",
        maxAmountRequired: amount,
        payTo: MERCHANT,
        resource: url.href,
        description: `${item.name}, $${item.price_usd.toFixed(2)} at ${rate} USD/XLM`,
        maxTimeoutSeconds: 120,
        extra: { memo, memoType: "text" },
      }],
    });
  }

  // Retry: verify the signed transaction before submitting it.
  try {
    const { payload } = JSON.parse(Buffer.from(payment, "base64").toString());
    const tx = TransactionBuilder.fromXDR(payload.transaction, Networks.TESTNET);
    const memo = tx.memo.type === "text" ? Buffer.from(tx.memo.value).toString("utf8") : null;
    const order = orders.get(memo);
    const op = tx.operations[0];
    const checks = {
      known_memo: !!order,
      memo_unused: order && !order.used,
      not_expired: order && Date.now() < order.expires,
      single_payment: tx.operations.length === 1 && op.type === "payment",
      destination: op.destination === MERCHANT,
      asset: op.asset && Asset.native().equals(op.asset),
      amount: order && Number(op.amount) === Number(order.amount),
      not_our_account: tx.source !== MERCHANT,
    };
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
    if (failed.length) return send(res, 402, { error: "payment refused", failed });

    order.used = true; // idempotency: a memo buys once
    const result = await horizon.submitTransaction(tx);
    const code = `GENGHIS-TESTNET-${memo.slice(2)}`;
    const receipt = { success: true, transaction: result.hash, network: "stellar-testnet" };
    return send(res, 200, {
      product: item.name,
      price_usd: item.price_usd,
      paid_xlm: order.amount,
      memo,
      transaction: result.hash,
      code,
    }, { "X-PAYMENT-RESPONSE": Buffer.from(JSON.stringify(receipt)).toString("base64") });
  } catch (err) {
    return send(res, 400, { error: "invalid payment", detail: err.message });
  }
});

server.listen(PORT, () => console.log(`bridge listening on :${PORT}`));
