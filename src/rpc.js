// Second payment source: Stellar RPC getEvents on the Stellar Asset Contract (SAC).
// Since protocol 23 a classic payment also emits a SAC `transfer` event, so this reads
// the same payment Horizon shows, through an independent service and data path.
// The network helpers take an injectable fetch; confirmFromEvent is pure.

import { Asset, Networks, Address, nativeToScVal, scValToNative, xdr } from "@stellar/stellar-sdk";
import { toStroops } from "./match.js";

export const RPC_URL = "https://soroban-testnet.stellar.org";

// Contract id of the SAC that wraps a classic asset. XLM is the native SAC.
export function sacContractId(assetCode, issuer, passphrase = Networks.TESTNET) {
  const asset = assetCode === "XLM" ? Asset.native() : new Asset(assetCode, issuer);
  return asset.contractId(passphrase);
}

// getEvents filter: SAC `transfer` events to `to`. Topics are [symbol "transfer", from, to, asset name].
export function transferFilter(contractId, to) {
  return {
    type: "contract",
    contractIds: [contractId],
    topics: [[
      nativeToScVal("transfer", { type: "symbol" }).toXDR("base64"),
      "*",
      new Address(to).toScVal().toXDR("base64"),
      "**",
    ]],
  };
}

export async function rpcCall(method, params, { fetchImpl = fetch, url = RPC_URL, signal } = {}) {
  const r = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal,
  });
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result;
}

// Decode one RPC event into plain values. Amount is BigInt stroops (SAC amounts have 7 decimals).
export function parseTransferEvent(event) {
  const topics = event.topic.map((t) => scValToNative(xdr.ScVal.fromXDR(t, "base64")));
  const value = scValToNative(xdr.ScVal.fromXDR(event.value, "base64"));
  const amount = typeof value === "bigint" ? value : value?.amount;
  return {
    fn: topics[0],
    from: topics[1],
    to: topics[2],
    amount: typeof amount === "bigint" ? amount : undefined,
    muxedId: value?.to_muxed_id,
    contractId: event.contractId,
    txHash: event.txHash,
    ledger: event.ledger,
  };
}

// order: { asset: "USDC" | "XLM", issuer, amount (decimal string), to (G... account), txHash? }
// Returns { match, reason, ledger?, txHash? }. Exact amount in stroops; contract fixes asset and issuer.
export function confirmFromEvent(event, order) {
  let ev;
  try {
    ev = parseTransferEvent(event);
  } catch {
    return { match: false, reason: "unreadable event" };
  }
  if (ev.fn !== "transfer") return { match: false, reason: "not a transfer event" };
  if (ev.contractId !== sacContractId(order.asset, order.issuer)) return { match: false, reason: "wrong asset contract" };
  if (ev.to !== order.to) return { match: false, reason: "wrong recipient" };
  if (ev.amount === undefined || ev.amount !== toStroops(order.amount)) return { match: false, reason: "amount differs" };
  if (order.txHash && ev.txHash !== order.txHash) return { match: false, reason: "different transaction" };
  return { match: true, reason: "transfer event matches", ledger: ev.ledger, txHash: ev.txHash };
}

// Looks for the transfer event of `order.txHash`. `ledgerHint` is the ledger Horizon reported.
// Polls until the event is found or `timeoutMs` passes (RPC can trail Horizon by a few seconds).
// Returns the confirmation. Throws on network failure or timeout so the caller can say "unavailable".
export async function findTransferConfirmation(order, { ledgerHint, timeoutMs = 8000, fetchImpl = fetch, url = RPC_URL } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const opts = { fetchImpl, url, signal: ctl.signal };
  try {
    const filter = transferFilter(sacContractId(order.asset, order.issuer), order.to);
    for (;;) {
      const latest = await rpcCall("getLatestLedger", undefined, opts);
      const start = ledgerHint ? Math.max(1, ledgerHint - 3) : Math.max(1, latest.sequence - 200);
      if (latest.sequence >= (ledgerHint ?? 0)) {
        const res = await rpcCall("getEvents", { startLedger: start, filters: [filter], pagination: { limit: 100 } }, opts);
        for (const e of res.events || []) {
          const c = confirmFromEvent(e, order);
          if (c.match) return c;
        }
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  } finally {
    clearTimeout(timer);
  }
}
