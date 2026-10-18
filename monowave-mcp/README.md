# Monowave MCP Server

MCP server that replicates the **Neely Cash Data — Adaptive Speed Baseline** Pine Script indicator. Fetches OHLC data from Bybit, processes cash lines (monowaves), classifies each segment as directional or non-directional based on adaptive speed thresholds, and exposes results via a single MCP tool `get_cash_data`.

---

## Tool: `get_cash_data`

### Input

| Field      | Type   | Description                              | Example      |
|------------|--------|------------------------------------------|--------------|
| `symbol`   | string | Base asset name (`USDT` appended internally) | `"BTC"`      |
| `timeframe`| string | Bybit kline interval                     | `"240"`      |

Supported timeframes: `1`, `3`, `5`, `15`, `30`, `60`, `120`, `240`, `360`, `720`, `D`, `W`, `M`

### Output

JSON with three sections:

- **`nodes`** — extremum points of the cash line polyline, each with timestamp, price, bar index, and classification (the first node has `null` classification).
- **`segments`** — edges connecting consecutive nodes, with direction (`1`/`-1`), speed (price range ÷ bars elapsed), and classification.
- **`meta`** — symbol, timeframe, bar count, speed moving-average length (10), speed multiplier (0.2), average speed across all completed segments, and the adaptive threshold (`avgSpeed × 0.2`).

### Classification Logic

Each segment is classified as:
- **`directional_up`** — fast upward price move (speed ≥ threshold)
- **`directional_down`** — fast downward price move (speed ≥ threshold)
- **`non_directional`** — slow move (speed < threshold)

The threshold is adaptive: `threshold = rollingAvgSpeed × 0.2`, where `rollingAvgSpeed` is the mean speed of the last 10 completed monowave segments. The first segment is always directional since no history exists yet.

---

## Installation

```bash
cd monowave-mcp
npm install
npm run build
```

### Requirements

- Node.js ≥ 18
- No API keys required — Bybit public API is used

---

## Running

### Direct (stdio)

```bash
node dist/index.js
```

The server listens on **stdin/stdout** using the MCP stdio transport. It does not expose an HTTP port.

### Development with hot reload

```bash
npm run dev
```

### Docker

```bash
docker compose build
docker compose up
```

---

## Deploying to Production

### As a systemd service

Create `/etc/systemd/system/monowave-mcp.service`:

```ini
[Unit]
Description=Monowave MCP Server
After=network.target

[Service]
ExecStart=/usr/bin/node /opt/monowave-mcp/dist/index.js
WorkingDirectory=/opt/monowave-mcp
Restart=always
User=youruser

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now monowave-mcp
```

### Using MCP Inspector (for testing)

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

### Resources

The server is stateless and single-threaded — you only need to ensure the process stays running. No database, no HTTP ports, no file storage.

---

## Using with Kilo

Add the server to your Kilo agent configuration (`~/.config/kilo/agent-manager.json` or equivalent):

```json
{
  "mcpServers": {
    "monowave-mcp": {
      "command": "node",
      "args": ["/path/to/monowave-mcp/dist/index.js"]
    }
  }
}
```

Then in Kilo, you can ask:

> "Get BTC cash data for the 4-hour timeframe"

The agent will call `get_cash_data` with `symbol: "BTC"` and `timeframe: "240"` and receive structured cash-line data for analysis.

---

## Using with ChatGPT Desktop

In the ChatGPT desktop app, go to **Settings → Advanced → MCP Servers** and add:

```json
{
  "mcpServers": {
    "monowave-mcp": {
      "command": "node",
      "args": ["/path/to/monowave-mcp/dist/index.js"]
    }
  }
}
```

ChatGPT can then use the `get_cash_data` tool during conversations about cryptocurrency markets.

---

## Using with Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "monowave-mcp": {
      "command": "node",
      "args": ["/path/to/monowave-mcp/dist/index.js"]
    }
  }
}
```

---

## Using with any MCP Client (CLI)

Any MCP client can connect via stdio:

```bash
# Example using the MCP CLI tool
npx @modelcontextprotocol/cli --server "node /path/to/monowave-mcp/dist/index.js"
```

Or programmatically (TypeScript):

```typescript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["/path/to/monowave-mcp/dist/index.js"],
});

const client = new Client(
  { name: "my-app", version: "1.0.0" },
  { capabilities: {} },
);

await client.connect(transport);

const result = await client.callTool({
  name: "get_cash_data",
  arguments: { symbol: "BTC", timeframe: "240" },
});

console.log(result.content[0].text);
```

---

## Project Structure

```
monowave-mcp/
├── src/
│   ├── index.ts                  # MCP server entry point
│   ├── config.ts                 # Constants (speed MA length, Bybit URL, etc.)
│   ├── models/
│   │   └── types.ts              # TS interfaces (OHLCBar, CashNode, etc.)
│   ├── market/
│   │   └── bybit.ts              # Bybit OHLC fetcher
│   ├── analysis/
│   │   ├── cash-data.ts          # Cash line generation + rolling speed
│   │   └── segment-label.ts      # directional / non-directional classification
│   └── tools/
│       └── get-cash-data.ts      # Tool definition + handler
├── Dockerfile
├── docker-compose.yml
├── package.json
└── tsconfig.json
```

---

## Scripts

| Command           | Description                            |
|-------------------|----------------------------------------|
| `npm run build`   | Compile TypeScript to `dist/`          |
| `npm start`       | Run the compiled server                |
| `npm run dev`     | Auto-restart on source changes (tsx)   |
| `npm run typecheck` | Type-check without emitting           |
| `npm run test`    | Run tests (vitest)                     |

---

## Algorithm Summary

1. **Fetch** 1000 OHLC bars from Bybit public API.
2. **Auto-detect** the operational timeframe based on the bar interval (e.g., 1m→1h, 1h→1d, 4h→1w).
3. **Group** bars by operational timeframe — each group becomes one timeframe bar.
4. **Track** the high and low of each timeframe bar as it is completed.
5. **Build segments** connecting consecutive extremum points: `lastPoint → firstExtremum → secondExtremum`.
6. **Calculate speed** for each segment: `|priceChange| / barElapsed`.
7. **Maintain** a rolling speed history (max 10 segments).
8. **Classify** each segment as directional or non-directional using: `threshold = avgSpeed × 0.2`.
9. **Return** the full node/segment arrays with meta information.

---

## License

MIT