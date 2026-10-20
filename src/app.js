// Genghis checkout on Stellar: testnet demo
//
// One static page that walks a reviewer through the purchase the grant
// brings to genghis.pro: pick a live product, pay in USDC (default) or
// XLM from a Stellar wallet, see the payment matched to the order and
// the product delivered in the same page.
//
// What is real: the products, values and USD prices (read from the live
// Genghis catalogue on 2026-10-20), the wallet connection (Stellar
// Wallets Kit), the signed payment and its settlement on Stellar
// testnet, and the listener that matches the payment to the order by
// memo, asset and amount from Horizon.
// What is simulated: the order is created in the browser, the code is a
// placeholder, and the receiving account is a testnet account made for
// this demo. In production the order system issues the memo, runs the
// listener and calls the supplier (see genghis-stellar-docs).

import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";
import { HanaModule } from "@creit.tech/stellar-wallets-kit/modules/hana";
import {
  TransactionBuilder,
  Account,
  Networks as SdkNetworks,
  Operation,
  Asset,
  Memo,
  BASE_FEE,
} from "@stellar/stellar-sdk";

const HORIZON = "https://horizon-testnet.stellar.org";
const EXPLORER = "https://stellar.expert/explorer/testnet";
// Genghis testnet receiving account for this demo, created 2026-10-20,
// with a trustline to testnet USDC. Stands in for the Genghis mainnet
// account that receives USDC in production.
const MERCHANT = "GAMXQ2KPDSVCBU7VCRJROBOUT3RM2VMIVCXVMAW3EYZKBO7TJEYBG4NN";
// Circle's USDC on Stellar testnet.
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const QUOTE_SECONDS = 120; // an XLM quote expires; the transaction times out with it

// Live Genghis catalogue, read 2026-10-20 (WooCommerce, published, in stock).
const PRODUCTS = [
  {
    id: "esim-india",
    kind: "eSIM",
    name: "India eSIM",
    title: "Buy India eSIM with crypto",
    img: "assets/esim-india-800x615-1.webp",
    optLabel: "Plan",
    facts: ["1 GB to 20 GB plans for India", "Instant delivery", "Pay with USDC or XLM on Stellar"],
    spec: [
      ["Country", "India"],
      ["Network", "Airtel"],
      ["Type", "Data only, no phone number"],
      ["Validity", "Starts at first connection"],
    ],
    options: [
      ["1 GB / 7 days", 5.08], ["3 GB / 15 days", 11.16], ["3 GB / 30 days", 11.68],
      ["5 GB / 30 days", 16.61], ["10 GB / 30 days", 29.92], ["20 GB / 30 days", 49.06],
    ],
    deliver: (code) => `
      <p><strong>Your eSIM is ready.</strong> Scan the QR code in your phone's eSIM settings.</p>
      <div class="qr" aria-hidden="true"></div>
      <p>Activation code: <code>${code}</code></p>`,
  },
  {
    id: "esim-singapore",
    kind: "eSIM",
    name: "Singapore eSIM",
    title: "Buy Singapore eSIM with crypto",
    img: "assets/esim-singapore-800x615-1.webp",
    optLabel: "Plan",
    facts: ["1 GB to 20 GB plans for Singapore", "Instant delivery", "Pay with USDC or XLM on Stellar"],
    spec: [
      ["Country", "Singapore"],
      ["Type", "Data only, no phone number"],
      ["Validity", "Starts at first connection"],
    ],
    options: [
      ["1 GB / 7 days", 3.92], ["3 GB / 15 days", 9.12], ["3 GB / 30 days", 9.40],
      ["5 GB / 30 days", 11.99], ["10 GB / 30 days", 18.74], ["20 GB / 30 days", 29.83],
    ],
    deliver: (code) => `
      <p><strong>Your eSIM is ready.</strong> Scan the QR code in your phone's eSIM settings.</p>
      <div class="qr" aria-hidden="true"></div>
      <p>Activation code: <code>${code}</code></p>`,
  },
  {
    id: "amazon-us",
    kind: "Gift card",
    name: "Amazon US gift card",
    title: "Buy Amazon US gift card with crypto",
    img: "assets/amazon-us.webp",
    optLabel: "Value",
    facts: ["50 to 100 USD", "Instant delivery", "Pay with USDC or XLM on Stellar"],
    spec: [
      ["Country", "United States"],
      ["Redeem on", "amazon.com, US accounts"],
      ["Currency", "USD"],
    ],
    options: [["50 USD", 50.2], ["70 USD", 71.73], ["75 USD", 76.85], ["100 USD", 100.4]],
    deliver: (code) => `
      <p><strong>Your gift card is ready.</strong> Redeem it at amazon.com/redeem.</p>
      <p>Claim code: <code>${code}</code></p>`,
  },
];

StellarWalletsKit.init({
  network: Networks.TESTNET,
  modules: [new FreighterModule(), new xBullModule(), new AlbedoModule(), new HanaModule()],
});

const $ = (id) => document.getElementById(id);
const els = {
  picker: $("picker"), crumb: $("crumb-product"), kind: $("p-kind"), title: $("p-title"),
  facts: $("p-facts"), img: $("p-img"), spec: $("p-spec"), optLabel: $("opt-label"),
  options: $("options"), price: $("price"), usdcQuote: $("usdc-quote"), xlmQuote: $("xlm-quote"),
  assetNote: $("asset-note"), walletLine: $("wallet-line"), fundBtn: $("fund-btn"),
  connectBtn: $("connect-btn"), payBtn: $("pay-btn"), status: $("status"), error: $("error"),
  buyPanel: $("buy-panel"), confirm: $("confirm"), cTitle: $("c-title"), timeline: $("timeline"),
  delivery: $("delivery"), receipt: $("receipt"), againBtn: $("again-btn"),
};

const state = {
  product: PRODUCTS[0],
  option: 0,
  asset: "USDC",
  buyer: null,
  buyerUsdc: 0, // testnet USDC balance, 0 when no trustline
  funded: false,
  xlmRate: null, // USD per XLM
  quoteAt: 0,
  busy: false,
};

const usd = (n) => "$" + n.toFixed(2);
const price = () => state.product.options[state.option][1];
const short = (a) => a.slice(0, 4) + "..." + a.slice(-4);
const setStatus = (t) => { els.status.textContent = t; };
const setError = (t) => { els.error.textContent = t || ""; };

// ---------- product page ----------

function renderPicker() {
  els.picker.innerHTML = PRODUCTS.map((p) => `
    <button class="pick${p === state.product ? " selected" : ""}" data-id="${p.id}">
      <img src="${p.img}" alt="" />
      <div><strong>${p.name}</strong><span>From ${usd(Math.min(...p.options.map((o) => o[1])))}</span></div>
    </button>`).join("");
}

function renderProduct() {
  const p = state.product;
  els.crumb.textContent = p.name;
  els.kind.textContent = p.kind;
  els.title.textContent = p.title;
  els.facts.innerHTML = p.facts.map((f) => `<li>${f}</li>`).join("");
  els.img.src = p.img;
  els.img.alt = p.name;
  els.spec.innerHTML = p.spec.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("");
  els.optLabel.textContent = p.optLabel;
  els.options.innerHTML = p.options.map(([name, pr], i) => `
    <button class="opt${i === state.option ? " selected" : ""}" data-i="${i}"><b>${name}</b><span>${usd(pr)}</span></button>`).join("");
  renderPrice();
}

function xlmAmount() {
  return state.xlmRate ? (price() / state.xlmRate).toFixed(7) : null;
}

function renderPrice() {
  els.price.textContent = usd(price());
  els.usdcQuote.textContent = `${price().toFixed(2)} USDC, fixed`;
  const x = xlmAmount();
  els.xlmQuote.textContent = x ? `${Number(x).toFixed(2)} XLM at ${state.xlmRate.toFixed(4)} USD` : "Rate unavailable";
  renderAssetNote();
  renderPayBtn();
}

function quoteLeft() {
  return Math.max(0, QUOTE_SECONDS - Math.floor((Date.now() - state.quoteAt) / 1000));
}

function renderAssetNote() {
  if (state.asset === "USDC") {
    if (state.buyer && state.buyerUsdc < price()) {
      els.assetNote.textContent =
        "Your wallet has no testnet USDC for this amount, so it pays in testnet XLM and the Stellar DEX converts it in the same transaction. Genghis receives exactly " +
        price().toFixed(2) + " USDC.";
    } else {
      els.assetNote.textContent = "Priced in dollars, paid in dollars: the amount cannot move between quote and payment.";
    }
  } else {
    const left = quoteLeft();
    els.assetNote.textContent = state.xlmRate
      ? `Quote valid for ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}. In production XLM goes through our current payment processor.`
      : "XLM rate unavailable right now: pay in USDC.";
  }
}

function renderPayBtn() {
  const b = els.payBtn;
  if (state.busy) return;
  if (!state.buyer) { b.disabled = true; b.textContent = "Connect a wallet to pay"; return; }
  if (!state.funded) { b.disabled = true; b.textContent = "Fund your testnet wallet first"; return; }
  if (state.asset === "XLM" && !state.xlmRate) { b.disabled = true; b.textContent = "XLM rate unavailable"; return; }
  b.disabled = false;
  b.textContent = state.asset === "USDC"
    ? `Pay ${price().toFixed(2)} USDC`
    : `Pay ${Number(xlmAmount()).toFixed(2)} XLM`;
}

async function loadRate() {
  state.xlmRate = null;
  for (let i = 0; i < 3 && !state.xlmRate; i++) {
    try {
      const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=stellar&vs_currencies=usd");
      if (r.ok) state.xlmRate = (await r.json()).stellar.usd;
    } catch { /* retry below */ }
    if (!state.xlmRate) await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  state.quoteAt = Date.now();
  renderPrice();
}

setInterval(() => {
  if (state.asset !== "XLM" || state.busy) return;
  if (quoteLeft() === 0) loadRate(); else renderAssetNote();
}, 1000);

els.picker.addEventListener("click", (e) => {
  const b = e.target.closest(".pick");
  if (!b || state.busy) return;
  state.product = PRODUCTS.find((p) => p.id === b.dataset.id);
  state.option = 0;
  showBuy();
  renderPicker();
  renderProduct();
});

els.options.addEventListener("click", (e) => {
  const b = e.target.closest(".opt");
  if (!b || state.busy) return;
  state.option = Number(b.dataset.i);
  renderProduct();
});

document.querySelector(".assets").addEventListener("click", (e) => {
  const b = e.target.closest(".asset");
  if (!b || state.busy) return;
  state.asset = b.dataset.asset;
  document.querySelectorAll(".asset").forEach((x) => {
    x.classList.toggle("selected", x === b);
    x.setAttribute("aria-checked", String(x === b));
  });
  if (state.asset === "XLM" && quoteLeft() < 60) loadRate();
  renderPrice();
});

// ---------- wallet ----------

async function loadBuyer() {
  const r = await fetch(`${HORIZON}/accounts/${state.buyer}`);
  if (!r.ok) { state.funded = false; state.buyerUsdc = 0; return null; }
  const data = await r.json();
  state.funded = true;
  const bal = data.balances.find((b) => b.asset_code === USDC.code && b.asset_issuer === USDC.issuer);
  state.buyerUsdc = bal ? Number(bal.balance) : 0;
  return data;
}

function renderWallet() {
  if (!state.buyer) return;
  els.connectBtn.textContent = short(state.buyer);
  els.connectBtn.classList.add("connected");
  els.walletLine.textContent = state.funded
    ? `Connected on testnet: ${short(state.buyer)}. Test USDC balance: ${state.buyerUsdc.toFixed(2)}.`
    : `Connected: ${short(state.buyer)}. This wallet has no testnet account yet.`;
  els.fundBtn.hidden = state.funded;
  renderAssetNote();
  renderPayBtn();
}

async function connect() {
  setError("");
  setStatus("Opening the wallet selector...");
  try {
    const { address } = await StellarWalletsKit.authModal();
    let passphrase = null;
    try { passphrase = (await StellarWalletsKit.getNetwork()).networkPassphrase; } catch { /* Albedo cannot report it; the network is set when signing */ }
    if (passphrase && passphrase !== SdkNetworks.TESTNET) {
      setStatus("");
      setError("Your wallet is on the wrong network. Switch it to Testnet (in Freighter: Settings, Network, Testnet) and connect again.");
      return;
    }
    state.buyer = address;
    await loadBuyer();
    setStatus("");
    renderWallet();
  } catch (err) {
    setStatus("");
    setError(err?.message || String(err));
  }
}
els.connectBtn.addEventListener("click", connect);

els.fundBtn.addEventListener("click", async () => {
  els.fundBtn.disabled = true;
  setStatus("Asking Friendbot for free testnet XLM...");
  try {
    await fetch(`https://friendbot.stellar.org/?addr=${state.buyer}`);
    await loadBuyer();
    setStatus(state.funded ? "Funded with 10,000 testnet XLM." : "");
    if (!state.funded) setError("Friendbot did not fund the account. Try again in a minute.");
  } catch (err) {
    setError(err?.message || String(err));
  } finally {
    els.fundBtn.disabled = false;
    renderWallet();
  }
});

// ---------- payment ----------

function newOrderId() {
  // Text memo the order system issues per order: the key the listener
  // uses to attribute the payment to this order.
  return "GX" + Math.floor(1e8 + Math.random() * 9e8).toString();
}

async function buildOperation() {
  const amount = price().toFixed(2);
  if (state.asset === "XLM") {
    return { op: Operation.payment({ destination: MERCHANT, asset: Asset.native(), amount: xlmAmount() }), mode: "XLM payment" };
  }
  if (state.buyerUsdc >= price()) {
    return { op: Operation.payment({ destination: MERCHANT, asset: USDC, amount }), mode: "USDC payment" };
  }
  // No testnet USDC in the wallet: pay XLM, deliver exactly the USDC
  // amount to Genghis through the Stellar DEX in one transaction.
  const q = new URLSearchParams({
    source_assets: "native",
    destination_asset_type: "credit_alphanum4",
    destination_asset_code: USDC.code,
    destination_asset_issuer: USDC.issuer,
    destination_amount: amount,
  });
  const r = await fetch(`${HORIZON}/paths/strict-receive?${q}`);
  const rec = (await r.json())?._embedded?.records?.[0];
  if (!rec) throw new Error("No testnet route from XLM to USDC right now. Get test USDC at faucet.circle.com (Stellar testnet), or pay in XLM.");
  const sendMax = (Number(rec.source_amount) * 1.05).toFixed(7);
  const path = rec.path.map((a) => (a.asset_type === "native" ? Asset.native() : new Asset(a.asset_code, a.asset_issuer)));
  return {
    op: Operation.pathPaymentStrictReceive({ sendAsset: Asset.native(), sendMax, destination: MERCHANT, destAsset: USDC, destAmount: amount, path }),
    mode: `USDC via the Stellar DEX (up to ${Number(sendMax).toFixed(2)} XLM)`,
  };
}

// The listener: reads Genghis's account on Horizon and finds the payment
// that carries this order's memo, then checks asset and amount.
async function matchPayment(orderId, hash, wantAsset, wantAmount) {
  for (let i = 0; i < 10; i++) {
    const r = await fetch(`${HORIZON}/accounts/${MERCHANT}/payments?order=desc&limit=20&join=transactions`);
    const recs = (await r.json())?._embedded?.records || [];
    const hit = recs.find((p) => p.transaction_hash === hash && p.transaction?.memo === orderId);
    if (hit) {
      const code = hit.asset_type === "native" ? "XLM" : hit.asset_code;
      const okAsset = code === wantAsset && (code === "XLM" || hit.asset_issuer === USDC.issuer);
      const okAmount = Number(hit.amount) + 1e-7 >= Number(wantAmount);
      return { hit, code, ok: okAsset && okAmount };
    }
    await new Promise((res) => setTimeout(res, 1000));
  }
  return null;
}

function step(text, live) {
  const li = document.createElement("li");
  li.className = live ? "" : "sim";
  li.innerHTML = `<span class="dot"></span><span class="what">${text}</span><span class="badge ${live ? "badge-live" : "badge-sim"}">${live ? "Testnet" : "Simulated"}</span>`;
  els.timeline.appendChild(li);
}

function showBuy() {
  els.confirm.hidden = true;
  els.buyPanel.hidden = false;
}

els.payBtn.addEventListener("click", async () => {
  if (state.busy || !state.buyer) return;
  setError("");
  state.busy = true;
  els.payBtn.disabled = true;
  const p = state.product;
  const optName = p.options[state.option][0];
  const orderId = newOrderId();
  const wantAsset = state.asset;
  const wantAmount = wantAsset === "USDC" ? price().toFixed(2) : xlmAmount();

  try {
    els.payBtn.textContent = "Preparing payment...";
    const acc = await loadBuyer();
    if (!acc) throw new Error("This wallet has no testnet account yet. Use the funding link above.");
    const { op, mode } = await buildOperation();
    const tx = new TransactionBuilder(new Account(state.buyer, acc.sequence), {
      fee: BASE_FEE,
      networkPassphrase: SdkNetworks.TESTNET,
    })
      .addOperation(op)
      .addMemo(Memo.text(orderId))
      .setTimeout(wantAsset === "XLM" ? Math.max(30, quoteLeft()) : 120)
      .build();

    els.payBtn.textContent = "Approve in your wallet...";
    setStatus(`Order ${orderId}: ${mode}, memo ${orderId}.`);
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(tx.toXDR(), {
      address: state.buyer,
      networkPassphrase: SdkNetworks.TESTNET,
    });

    els.payBtn.textContent = "Settling on Stellar...";
    const t0 = performance.now();
    const sub = await fetch(`${HORIZON}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "tx=" + encodeURIComponent(signedTxXdr),
    });
    const subData = await sub.json();
    if (!sub.ok || !subData.hash) {
      const codes = subData?.extras?.result_codes;
      throw new Error("Stellar rejected the payment" + (codes ? ": " + JSON.stringify(codes) : "."));
    }
    const settled = ((performance.now() - t0) / 1000).toFixed(1);

    setStatus("Payment settled. Matching it to the order...");
    const m = await matchPayment(orderId, subData.hash, wantAsset, wantAmount);
    if (!m || !m.ok) throw new Error("The payment settled but could not be matched to the order (memo, asset or amount). Nothing would be delivered.");

    const code = (p.kind === "eSIM" ? "LPA-TEST-" : "TEST-") + orderId.slice(2, 6) + "-" + orderId.slice(6);
    els.cTitle.textContent = `${p.name}, ${optName}`;
    els.timeline.innerHTML = "";
    els.buyPanel.hidden = true;
    els.confirm.hidden = false;
    const steps = [
      [`Order ${orderId} created, ${usd(price())}`, false],
      [`Payment signed in your wallet and settled in ${settled} s`, true],
      [`Matched to the order: memo ${orderId}, ${Number(m.hit.amount).toFixed(2)} ${m.code} received by Genghis`, true],
      ["Code requested from the supplier and delivered", false],
      ["Copy sent by email", false],
    ];
    for (const [t, live] of steps) { step(t, live); await new Promise((r) => setTimeout(r, 220)); }
    els.delivery.innerHTML = p.deliver(code) + '<p class="muted small">Placeholder code: on mainnet this is the real code from the supplier.</p>';
    els.receipt.innerHTML = `
      <dt>Order</dt><dd>${orderId}</dd>
      <dt>Paid</dt><dd>${Number(m.hit.amount).toFixed(2)} ${m.code}${m.hit.type === "path_payment_strict_receive" ? ` (from ${Number(m.hit.source_amount).toFixed(2)} XLM)` : ""}</dd>
      <dt>Network</dt><dd>Stellar testnet</dd>
      <dt>Transaction</dt><dd><a href="${EXPLORER}/tx/${subData.hash}" target="_blank" rel="noopener">${short(subData.hash)}</a></dd>
      <dt>Received by</dt><dd><a href="${EXPLORER}/account/${MERCHANT}" target="_blank" rel="noopener">${short(MERCHANT)}</a></dd>`;
    setStatus("");
    await loadBuyer();
  } catch (err) {
    setStatus("");
    setError(err?.message || String(err));
  } finally {
    state.busy = false;
    renderWallet();
    renderPayBtn();
  }
});

els.againBtn.addEventListener("click", () => {
  showBuy();
  renderPrice();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

renderPicker();
renderProduct();
loadRate();
