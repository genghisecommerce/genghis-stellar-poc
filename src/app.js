// Genghis on Stellar — testnet proof of concept
//
// Scope: this page reproduces Flow A of ARCHITECTURE.md end to end, on
// Stellar testnet, entirely client side. In production the deposit
// address/memo issuance and the payment listener live in the Genghis
// order API (a server); here the page plays both parts so the whole
// path can be verified from a browser with no backend of our own.
//
// No real money moves. The buyer pays testnet XLM, funded for free by
// Stellar's Friendbot. The "merchant" account below is a disposable
// testnet account, funded the same way, that exists only for this demo.

import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import {
  TransactionBuilder,
  Account,
  Networks as SdkNetworks,
  Operation,
  Asset,
  Memo,
  BASE_FEE,
} from "@stellar/stellar-sdk";

const HORIZON_TESTNET = "https://horizon-testnet.stellar.org";
// Disposable testnet account, funded by Friendbot on 2026-09-25 for this
// demo only. Stands in for the per-order deposit address a payment
// processor would issue in production (see ARCHITECTURE.md, section 2).
const MERCHANT_ADDRESS =
  "GBBATDYWQWD4EPQNQQSTUABAF3COF2RZAOY6NHVOI5JU4PU4DDBPS673";
const PAY_AMOUNT = "5"; // testnet XLM

StellarWalletsKit.init({
  network: Networks.TESTNET,
  modules: [new FreighterModule(), new xBullModule()],
});

const els = {
  connectBtn: document.getElementById("connect-btn"),
  address: document.getElementById("address"),
  payBtn: document.getElementById("pay-btn"),
  status: document.getElementById("status"),
  result: document.getElementById("result"),
};

let buyerAddress = null;

function setStatus(text) {
  els.status.textContent = text;
}

function randomMemo() {
  // Stands in for the memo a processor issues per order (ARCHITECTURE.md
  // section 3): the only field a memo-based processor uses to attribute
  // a deposit, since it issues one shared deposit address.
  return "GX" + Math.floor(1e8 + Math.random() * 9e8).toString();
}

els.connectBtn.addEventListener("click", async () => {
  setStatus("Opening wallet selector...");
  try {
    const { address } = await StellarWalletsKit.authModal();
    buyerAddress = address;
    els.address.textContent = address;
    els.payBtn.disabled = false;
    setStatus("Wallet connected. Ready to pay on testnet.");
  } catch (err) {
    setStatus("Stopped.");
    els.result.innerHTML = `<p class="error">${err.message || err}</p>`;
  }
});

els.payBtn.addEventListener("click", async () => {
  if (!buyerAddress) return;
  els.payBtn.disabled = true;
  els.result.textContent = "";
  const memo = randomMemo();

  try {
    setStatus("Loading your testnet account...");
    const accountResp = await fetch(
      `${HORIZON_TESTNET}/accounts/${buyerAddress}`
    );
    if (!accountResp.ok) {
      throw new Error(
        "This wallet has no funded testnet account yet. Fund it at " +
          "https://friendbot.stellar.org/?addr=" +
          buyerAddress
      );
    }
    const accountData = await accountResp.json();
    const account = new Account(buyerAddress, accountData.sequence);

    setStatus(
      `Building a ${PAY_AMOUNT} XLM payment to Genghis with memo ${memo}...`
    );
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: SdkNetworks.TESTNET,
    })
      .addOperation(
        Operation.payment({
          destination: MERCHANT_ADDRESS,
          asset: Asset.native(),
          amount: PAY_AMOUNT,
        })
      )
      .addMemo(Memo.text(memo))
      .setTimeout(120)
      .build();

    setStatus("Waiting for your wallet to sign...");
    const { signedTxXdr } = await StellarWalletsKit.signTransaction(
      tx.toXDR(),
      { address: buyerAddress, networkPassphrase: SdkNetworks.TESTNET }
    );

    setStatus("Submitting the signed payment to Stellar testnet...");
    const submitResp = await fetch(`${HORIZON_TESTNET}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: "tx=" + encodeURIComponent(signedTxXdr),
    });
    const submitData = await submitResp.json();
    if (!submitResp.ok || submitData.status === "ERROR") {
      throw new Error(
        "Stellar rejected the transaction: " +
          JSON.stringify(submitData.extras?.result_codes || submitData)
      );
    }

    setStatus("Payment settled. Confirming the memo landed on Genghis...");
    // Stands in for the processor's confirmation notification
    // (ARCHITECTURE.md section 3): we read the transaction straight back
    // from Stellar rather than waiting on a webhook, since there is no
    // processor in front of this testnet account.
    const confirmResp = await fetch(
      `${HORIZON_TESTNET}/transactions/${submitData.hash}`
    );
    const confirmData = await confirmResp.json();
    if (confirmData.memo !== memo) {
      throw new Error("Memo mismatch: the deposit cannot be attributed.");
    }

    const code = "GENGHIS-TESTNET-" + memo.slice(2);
    setStatus("Delivered.");
    els.result.innerHTML = `
      <p><strong>Payment confirmed on Stellar testnet.</strong></p>
      <p>Your code: <code>${code}</code></p>
      <p>Transaction: <a href="https://stellar.expert/explorer/testnet/tx/${submitData.hash}" target="_blank" rel="noopener">${submitData.hash}</a></p>
      <p>This is the synchronous path the grant brings to Genghis on mainnet, for people and, through the x402 memo bridge, for agents (see ARCHITECTURE.md, flows A and B).</p>
    `;
  } catch (err) {
    setStatus("Stopped.");
    els.result.innerHTML = `<p class="error">${err.message || err}</p>`;
  } finally {
    els.payBtn.disabled = false;
  }
});
