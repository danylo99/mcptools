# MCP Server — Consolidated Prompt Examples

This document consolidates every example prompt from `docs/reports/01-bridge-inbound.md`
through `docs/reports/09-market-queries.md` into one categorized reference, updated to the
current MCP server tool set (26 tools: 8 market, 5 trading, 7 account, 6 bridge).

Prompt style is natural language; the assistant maps each prompt to the corresponding MCP
tool and fills in the required arguments (`marketAddress`, `trader`, `payer`, etc.).

## Market identifier resolution

Every tool that takes `marketAddress` accepts **either** a base58 market account address
**or** a token-pair string resolved through the token registry, e.g. `wAMB/USDT`,
`wAMB-USDT`, `wAMB:USDT`. So prompts like "swap 1 AMB to USDT" work without the user
having to look up a market address — the assistant resolves the pair to the market
automatically. Token symbol matching is case-insensitive (`wamb`, `WAMB`, `wAMB`, `usdt`,
`USDT` all work).

## Categories

### 1. Bridge — Inbound (source chain → Ambient)

- "Bridge 100 USDT from BSC to Ambient for wallet `<addr>`; quote fees then build tx and tell me when funds arrive."
- "Quote inbound bridge from Arbitrum 50 USDT to `<addr>`, then build tx with 0.5% slippage."
- "After broadcasting, check `get_global_balance` for `<addr>` until received."

### 2. Bridge — Outbound (Ambient → destination chain)

- "Bridge 25 hUSDT from Ambient to BSC recipient `<addr>`; quote then build outbound tx."
- "Build outbound bridge to Arbitrum for 10 USDT, payer `<addr>`."
- "Check my Ambient balance decreased after outbound bridge."

### 3. Bridge — Direct (BSC ↔ Ambient)

- "Direct bridge 1 USDT BSC → Ambient recipient `<addr>`."

### 4. Market Swap

- "Swap 1 AMB to USDT."
- "Sell 1 AMB to USDT."
- "Swap 2 AMB to USDT and build tx."

### 5. Place Limit Order

- "Buy 10 AMB at 1.25 USDT."
- "Place limit sell post-only 5 base at 1.30 with clientOrderId 42."
- "Cancel order 42."

### 6. Make Liquidity

- "Provide liquidity: bid 10 @ 1.24 and ask 10 @ 1.26 via batch update."
- "Post-only bid 5 @ 1.23 and ask 5 @ 1.27; build batch tx."
- "Cancel all my orders then place new two-sided liquidity."

### 7. Withdraw from Vault

- "Withdraw 5 USDT from vault to wallet."
- "Withdraw all balances."
- "Check vault balance after withdrawal."

### 8. Wrap / Unwrap

- "Wrap 2 AMB into vault via deposit."
- "Unwrap 2 AMB from vault via withdraw."

### 9. Check Balances (Vault & Global)

- "Show vault and global balances for `<trader>` for base and quote mints."
- "Check if I have enough vault balance to place order of 10 base."
- "Compare wallet vs vault balances."
- "What is my tradable and withdrawable balance?"
- "Global vault balance for `<trader>` in USDT."

### 10. Market Queries

- "Show best bid/ask for the AMB/USDT market."
- "Get orderbook for the AMB/USDT market."
- "List all markets and their base/quote tokens."
- "Recent fills for the AMB/USDT market, last 20."

## Tool reference

| Tool | Category | Key Args |
| --- | --- | --- |
| `list_markets` | Market | — |
| `get_pools` | Market | — |
| `get_market` | Market | `marketAddress` (address or pair) |
| `get_orderbook` | Market | `marketAddress` (address or pair) |
| `get_best_prices` | Market | `marketAddress` (address or pair) |
| `get_fills` | Market | `marketAddress` (address or pair), `limit`? |
| `get_balance` | Market | `marketAddress` (address or pair), `trader`, `mint`? |
| `find_market_by_pair` | Market | `baseSymbol`, `quoteSymbol` |
| `build_place_order_tx` | Trading | `marketAddress` (address or pair), `payer`, `numBaseTokens`, `tokenPrice`, `isBid`, `orderType` |
| `build_cancel_order_tx` | Trading | `marketAddress` (address or pair), `payer`, `clientOrderId` |
| `build_cancel_all_tx` | Trading | `marketAddress` (address or pair), `payer` |
| `build_swap_tx` | Trading | `marketAddress` (address or pair), `payer`, `outAtoms`, `isBaseIn`, `isExactIn`, `amount` (human, e.g. "1") |
| `build_batch_update_tx` | Trading | `marketAddress` (address or pair), `payer`, `placeParams[]`, `cancelParams[]`, `cancelAll` |
| `build_deposit_tx` | Account | `marketAddress` (address or pair), `payer`, `mint`, `amountTokens` |
| `build_withdraw_tx` | Account | `marketAddress` (address or pair), `payer`, `mint`, `amountTokens` |
| `build_withdraw_all_tx` | Account | `marketAddress` (address or pair), `payer` |
| `wrap_amb` | Account | `marketAddress` (address or pair), `payer`, `amountTokens` |
| `unwrap_amb` | Account | `marketAddress` (address or pair), `payer`, `amountTokens` |
| `get_global_balance` | Account | `marketAddress` (address or pair), `trader`, `mint` |
| `unified_balance` | Account | `marketAddress` (address or pair), `trader` |
| `quote_bridge` | Bridge | `route` (inbound/outbound/direct), `params` |
| `build_inbound_bridge_tx` | Bridge | `sourceChain`, `amount`, `recipientAddress` |
| `build_outbound_bridge_tx` | Bridge | `destinationChain`, `amount`, `recipientAddress`, `payer` |
| `build_direct_bridge_tx` | Bridge | `direction`, `amount`, `recipientAddress` |
| `get_bridge_config` | Bridge | `chain` |
| `check_bridge_delivery` | Bridge | `marketAddress` (address or pair), `trader`, `mint` |

## Notes

- The server does **not** sign transactions; it returns base64-encoded unsigned
  transactions for the client to sign and send.
- `get_balance` accepts an optional `mint` to query a specific mint's global balance
  (e.g. post-bridge delivery check for `hUSDT`).
- `build_outbound_bridge_tx` requires `payer` because the Ambient-side clearinghouse
  transaction needs a Solana fee payer regardless of destination chain.
- `build_swap_tx` takes a human-readable `amount` (e.g. `"1"`) and converts it
  internally using the input mint's decimals. `outAtoms` is the minimum output
  amount in atoms (e.g. `1000000000` = 1 USDT at 9 decimals). Token symbol
  matching is case-insensitive (`wamb`, `WAMB`, `wAMB`, `usdt`, `USDT` all work).