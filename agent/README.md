# Agent path: x402 memo bridge, testnet prototype

A working slice of flow B in [ARCHITECTURE.md](https://github.com/genghisecommerce/genghis-stellar-docs/blob/main/ARCHITECTURE.md): an AI agent finds a product in the live Genghis catalogue over MCP, asks to buy it, gets an HTTP 402 with the payment requirements (amount, deposit address, memo), signs a Stellar payment carrying the memo, retries, and gets the code back in the response.

- `bridge.mjs`: the priced endpoint. It sets the price server side from the live catalogue and the live XLM/USD rate, issues a fresh memo per order, and checks the signed transaction (known memo, used once, not expired, one payment, right destination, asset and amount) before it submits it to Stellar testnet.
- `agent.mjs`: the agent. It calls the Genghis MCP server, picks the gift card that covers the cart within the spending limit the person approved, pays and records every step.
- `mcp_client.py`: calls one tool on [genghis-mcp-readonly](https://github.com/genghisecommerce/genghis-mcp-readonly) over the MCP stdio protocol.

First recorded run, 25 September 2026: Amazon USD 70 USD card ($71.73) for a $64.87 cart, 325.79 testnet XLM, memo GX681871822, [transaction 9705c4f2...0a97](https://stellar.expert/explorer/testnet/tx/9705c4f2789a499efb101d12aa37e9f76d09b69250df61e6629ee6318e710a97).

Testnet only. The deposit address is a disposable testnet account standing in for the payment processor's shared deposit address.

## Run it

```bash
npm install @stellar/stellar-sdk
python3 -m venv .venv && .venv/bin/pip install "mcp>=1.2" httpx
# put genghis_catalog.py from genghis-mcp-readonly next to these files
# write prices.json from the MCP get_product result, and .agent_key.json with a Friendbot-funded testnet key
node bridge.mjs &
node agent.mjs
```
