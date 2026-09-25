// Agent side of the demo: find the gift card over MCP, pay the x402 memo
// bridge on Stellar testnet, get the code back. Every step is real and is
// written to transcript.json, which the video scene replays.
//
// The person's request and the Amazon product are the scripted part of the
// story (the scene labels them as such). The catalogue lookups, the 402,
// the signed payment, the testnet transaction and the code are real.

import fs from "node:fs";
import { execFileSync } from "node:child_process";
import {
  Keypair, TransactionBuilder, Networks, Operation, Asset, Memo, BASE_FEE, Horizon,
} from "@stellar/stellar-sdk";

const BRIDGE = "http://localhost:4020";
const CART_TOTAL_USD = 64.87;  // keyboard $59.99 plus estimated tax and shipping (scripted)
const SPEND_LIMIT_USD = 80;    // approved by the person (scripted)
const key = JSON.parse(fs.readFileSync(".agent_key.json", "utf8"));
const agent = Keypair.fromSecret(key.secret);
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const log = [];
const step = (kind, data) => { log.push({ t: new Date().toISOString(), kind, ...data }); console.log(kind, JSON.stringify(data).slice(0, 200)); };

function mcp(tool, args) {
  const out = execFileSync("./.venv/bin/python", ["mcp_client.py", tool, JSON.stringify(args)], { stdio: ["ignore", "pipe", "ignore"] });
  return JSON.parse(out.toString());
}

// 1. Discovery over MCP, against the live catalogue.
const search = mcp("search_products", { query: "amazon", country: "us", limit: 5 });
const hit = search.results.find(r => r.name === "Amazon USD");
step("mcp.search_products", { args: { query: "amazon", country: "us" }, result: search.results.map(r => ({ name: r.name, from_usd: r.price_from_usd, url: r.url })) });
const product = mcp("get_product", { slug: hit.slug });
const denoms = product.denominations.filter(d => d.in_stock).sort((a, b) => a.price_usd - b.price_usd);
step("mcp.get_product", { slug: hit.slug, denominations: denoms.map(d => ({ name: d.name, price_usd: d.price_usd, variation_id: d.variation_id })) });

// 2. Pick the smallest card that covers the cart, within the limit.
const face = d => Number(d.name.match(/(\d+) USD$/)[1]);
const pick = denoms.find(d => face(d) >= CART_TOTAL_USD && d.price_usd <= SPEND_LIMIT_USD);
step("agent.choose", { cart_total_usd: CART_TOTAL_USD, spend_limit_usd: SPEND_LIMIT_USD, chosen: pick.name, price_usd: pick.price_usd });

// 3. Ask to buy: the bridge answers 402 with the payment requirements.
const url = `${BRIDGE}/buy?variation=${pick.variation_id}`;
const r402 = await fetch(url);
const req = (await r402.json()).accepts[0];
step("http.402", { status: r402.status, requirements: req });
if (Number(req.maxAmountRequired) <= 0) throw new Error("bad amount");

// 4. Sign a classic Stellar payment carrying the memo, and retry.
const account = await horizon.loadAccount(agent.publicKey());
const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({ destination: req.payTo, asset: Asset.native(), amount: req.maxAmountRequired }))
  .addMemo(Memo.text(req.extra.memo))
  .setTimeout(req.maxTimeoutSeconds)
  .build();
tx.sign(agent);
step("agent.sign", { from: agent.publicKey(), to: req.payTo, amount_xlm: req.maxAmountRequired, memo: req.extra.memo });
const header = Buffer.from(JSON.stringify({ x402Version: 1, scheme: "exact", network: "stellar-testnet", payload: { transaction: tx.toXDR() } })).toString("base64");
const r200 = await fetch(url, { headers: { "X-PAYMENT": header } });
const body = await r200.json();
step("http.200", { status: r200.status, body });

fs.writeFileSync("transcript.json", JSON.stringify({ cart_total_usd: CART_TOTAL_USD, spend_limit_usd: SPEND_LIMIT_USD, agent: agent.publicKey(), steps: log }, null, 2));
console.log("done", body.code, body.transaction);
