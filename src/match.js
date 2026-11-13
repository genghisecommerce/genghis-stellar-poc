// Pure payment-matching rules. No network, no DOM, no floats.
// Amounts are decimal strings with at most 7 decimals and are compared in stroops (BigInt).

export const USDC_TESTNET_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const STROOP = /^\d+(\.\d{1,7})?$/;

export function toStroops(amount) {
  const s = String(amount).trim();
  if (!STROOP.test(s)) throw new Error(`Invalid amount: ${s}`);
  const [whole, frac = ""] = s.split(".");
  return BigInt(whole) * 10000000n + BigInt(frac.padEnd(7, "0"));
}

export function fromStroops(stroops) {
  const w = stroops / 10000000n;
  const f = (stroops % 10000000n).toString().padStart(7, "0");
  return `${w}.${f}`;
}

function paymentAsset(p) {
  return p.asset_type === "native" ? { code: "XLM", issuer: null } : { code: p.asset_code, issuer: p.asset_issuer };
}

// payment: a Horizon payment record with `memo` (the transaction memo) and `created_at`.
// order: { id, asset: "USDC" | "XLM", amount, issuer, expiresAt } (expiresAt in ms, optional).
// now: ms timestamp. Returns { decision: "deliver" | "hold" | "refund", reason, refund_difference? }.
export function evaluatePayment({ payment, order, now = Date.now() }) {
  const memo = payment?.memo;
  if (!memo) return { decision: "hold", reason: "no memo: manual reconciliation" };
  if (!order || order.id !== memo) return { decision: "hold", reason: "unknown memo: manual reconciliation" };

  const a = paymentAsset(payment);
  if (a.code !== order.asset) return { decision: "refund", reason: `wrong asset: paid ${a.code}, order wants ${order.asset}` };
  if (order.asset !== "XLM" && a.issuer !== order.issuer) return { decision: "refund", reason: "wrong issuer" };

  const expiresAt = order.expiresAt ?? Infinity;
  const paidAt = payment.created_at ? Date.parse(payment.created_at) : now;
  if (paidAt > expiresAt) return { decision: "refund", reason: "payment after expiry" };

  const paid = toStroops(payment.amount);
  const want = toStroops(order.amount);
  if (paid < want) {
    if (now > expiresAt) return { decision: "refund", reason: "underpayment, order expired" };
    return { decision: "hold", reason: "underpayment: order stays open until expiry" };
  }
  if (paid > want) {
    return { decision: "deliver", reason: "overpayment: deliver and refund the difference", refund_difference: fromStroops(paid - want) };
  }
  return { decision: "deliver", reason: "exact payment" };
}
