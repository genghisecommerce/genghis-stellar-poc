# Genghis checkout on Stellar: testnet demo

A Genghis-branded purchase flow on Stellar testnet. Pick a live Genghis product, pay in **USDC** (the default) or **XLM** from a Stellar wallet, see the payment matched to the order and the product delivered in the same page.

**Try it:** https://genghisecommerce.github.io/genghis-stellar-poc/

You need Freighter, xBull, Albedo or Hana set to **Testnet**. An empty wallet can be funded from the page (Stellar Friendbot, free testnet XLM). No real money moves.

## Reviewer journey

1. Open the product page: India eSIM, Singapore eSIM or Amazon US gift card.
2. Choose a plan or a value. Prices are the live Genghis USD prices, read on 20 October 2026.
3. Choose USDC (shown first) or XLM. The XLM quote uses the live XLM/USD rate and expires after two minutes; the transaction expires with it.
4. Connect a wallet through Stellar Wallets Kit.
5. Approve the payment in the wallet. It settles on Stellar testnet in about five seconds.
6. See the order confirmation: the payment matched to the order by memo, asset and amount, the transaction link, and the delivered code.

## What is working, simulated and planned

| Working on testnet | Simulated in this demo | What the grant builds |
|---|---|---|
| Live Genghis products, values and USD prices | The order is created in the browser, not in the Genghis order system | This checkout inside genghis.pro, on mainnet |
| Wallet connection through Stellar Wallets Kit | The delivered code is a placeholder; no supplier is called | USDC received on a Genghis Stellar account, with the listener in the order system |
| USDC by default, XLM as the alternative, with an expiring XLM quote | The receiving account is a Genghis testnet account made for this demo | XLM through our current payment processor |
| A payment signed in the wallet and settled on Stellar testnet | A wallet with no testnet USDC pays in XLM, converted by the Stellar DEX in the same transaction, so Genghis still receives the exact USDC amount | The real code delivered the moment the payment settles |
| The listener: reads the Genghis account on Horizon and matches memo, asset and amount before anything is delivered | | Agent purchases through x402 on Stellar, paid in USDC |

## How the payment works

- **Order reference.** Each order gets a text memo (`GX` plus nine digits). The memo is how the listener attributes a payment to an order.
- **USDC.** Circle's testnet USDC (`GBBD47IF...LFLA5`). If the wallet holds enough, a plain `payment`; if not, a `pathPaymentStrictReceive` from XLM that delivers exactly the USDC price to Genghis.
- **XLM.** A plain `payment` at the quoted amount. On mainnet XLM goes through our current processor, which attributes deposits by memo.
- **Listener.** After settlement the page reads the payments received by the Genghis account (`/accounts/{id}/payments` on Horizon), finds the one with this order's memo, and checks asset and amount. A payment that does not match is not delivered.

Receiving account (testnet): `GAMXQ2KPDSVCBU7VCRJROBOUT3RM2VMIVCXVMAW3EYZKBO7TJEYBG4NN`, on [stellar.expert](https://stellar.expert/explorer/testnet/account/GAMXQ2KPDSVCBU7VCRJROBOUT3RM2VMIVCXVMAW3EYZKBO7TJEYBG4NN).

## Agent prototype

`agent/` holds the earlier agent prototype (25 September 2026): an agent finds a product through the Genghis MCP server, receives an HTTP 402 payment request and pays it on testnet in XLM with a memo. It predates the USDC-first decision; the grant moves agent payments to x402 on Stellar in USDC, received on the Genghis account.

## Run it locally

```bash
npm install
npx esbuild src/app.js --bundle --format=esm --outfile=dist/bundle.js --platform=browser --minify
python3 -m http.server 8899
```

Then open `http://localhost:8899`.

## Stack

- [Stellar Wallets Kit](https://stellarwalletskit.dev/) 2.7: Freighter, xBull, Albedo and Hana
- [Stellar SDK](https://github.com/stellar/js-stellar-sdk) 17: `payment` and `pathPaymentStrictReceive` with a text memo, submitted to Horizon testnet
- No framework, no backend

## Related

- [genghis-stellar-docs](https://github.com/genghisecommerce/genghis-stellar-docs): architecture
- [genghis-mcp-readonly](https://github.com/genghisecommerce/genghis-mcp-readonly): the Genghis catalogue for AI agents
- [genghis.pro](https://www.genghis.pro): the live marketplace
