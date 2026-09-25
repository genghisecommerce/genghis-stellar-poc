# Genghis on Stellar — testnet proof of concept

A minimal, live demo of Flow A from [ARCHITECTURE.md](https://github.com/genghisecommerce/genghis-stellar-docs/blob/main/ARCHITECTURE.md): a buyer connects a Stellar wallet, pays with a memo-tagged testnet payment, and gets a code back in the same page, with no redirect.

**Try it:** https://genghisecommerce.github.io/genghis-stellar-poc/ (needs Freighter or xBull, set to **Testnet**, with a funded testnet account — fund one free at https://friendbot.stellar.org/?addr=YOUR_ADDRESS)

No real money moves. Everything runs on Stellar testnet.

## What this proves

- A live frontend using the Stellar Wallets Kit (Freighter and xBull), built for this grant.
- A signed Stellar payment, submitted straight to testnet Horizon, that carries the memo a payment processor uses to attribute a deposit (see `ARCHITECTURE.md`, section 2, on why the memo matters).
- The buyer gets a code back inside the same page the moment the payment settles, the synchronous pattern this grant brings to production.

## What is simplified for this static demo

There is no backend here, so this page plays the part of both the storefront and the order API described in the architecture:

- The "merchant" address is a disposable testnet account funded by Friendbot for this demo, standing in for a processor-issued deposit address.
- Confirmation is read straight back from Horizon testnet instead of arriving as a processor webhook.
- The delivered "code" is generated client side rather than looked up in a catalogue.

In production these three pieces are the Genghis order API, described in `ARCHITECTURE.md`.

## Run it locally

```bash
npm install
npx esbuild src/app.js --bundle --format=esm --outfile=dist/bundle.js --platform=browser
python3 -m http.server 8899
```

Then open `http://localhost:8899`.

## Stack

- [Stellar Wallets Kit](https://stellarwalletskit.dev/) 2.7, Freighter and xBull modules
- [Stellar SDK](https://github.com/stellar/js-stellar-sdk) 17.1, classic Payment operation with a text memo
- No framework, no build step beyond bundling the two libraries above

## Related

- [genghis-stellar-docs](https://github.com/genghisecommerce/genghis-stellar-docs) — the technical architecture this demo implements a slice of
- [genghis-mcp-readonly](https://github.com/genghisecommerce/genghis-mcp-readonly) — the agent discovery layer, live in production
- https://www.genghis.pro — the live marketplace
