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

The server listens on **stdin/stdout** using the MCP stdio transport.

### HTTP server (Streamable HTTP transport, for Cloud Run)

```bash
PORT=3000 node dist/http-index.js
```

Starts an Express HTTP server using the MCP **Streamable HTTP** transport on port `3000`:
- `POST /mcp` — initialize session or send messages
- `GET /mcp` — establish SSE stream for server-to-client messages
- `DELETE /mcp` — terminate session

This is the modern MCP HTTP transport (protocol 2025-11-25) — the deprecated `SSEServerTransport` is not used.

### Development with hot reload

```bash
npm run dev
```

### Docker (local)

```bash
docker compose build
docker compose up
```

---

## Deploying to Production

### Deploying to Google Cloud Run via CI/CD

The server supports two transports:
- **stdio** (default) — local subprocess, used by `node dist/index.js`
- **Streamable HTTP** — deployed on Cloud Run, used by `node dist/http-index.js`

When deployed to Cloud Run, the container starts an Express HTTP server with the MCP Streamable HTTP transport (protocol 2025-11-25):
- `POST /mcp` — initialize session or send messages
- `GET /mcp` — establish SSE stream for server-to-client messages
- `DELETE /mcp` — terminate session

Cloud Run manages the container as a regular HTTP service — it handles scaling, health checks, and HTTPS.

#### 1. CI/CD pipeline (GitHub Actions → GCR → Cloud Run)

Create `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Cloud Run

on:
  push:
    branches: [main]

env:
  PROJECT_ID: YOUR_PROJECT_ID
  SERVICE_NAME: monowave-mcp
  REGION: us-central1

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - id: auth
        uses: google-github-actions/auth@v2
        with:
          credentials_json: ${{ secrets.GCP_SA_KEY }}

      - name: Set up Cloud SDK
        uses: google-github-actions/setup-gcloud@v2

      - name: Docker auth
        run: gcloud auth configure-docker

      - name: Build & push to GCR
        run: |
          docker build -t gcr.io/${{ env.PROJECT_ID }}/${{ env.SERVICE_NAME }}:${{ github.sha }} .
          docker push gcr.io/${{ env.PROJECT_ID }}/${{ env.SERVICE_NAME }}:${{ github.sha }}

      - name: Deploy to Cloud Run
        run: |
          gcloud run deploy ${{ env.SERVICE_NAME }} \
            --image gcr.io/${{ env.PROJECT_ID }}/${{ env.SERVICE_NAME }}:${{ github.sha }} \
            --region ${{ env.REGION }}
```

The Dockerfile exposes port `3000` and runs the HTTP entry point (`dist/http-index.js`). Cloud Run automatically provisions HTTPS for the service.

#### 2. Prerequisites

- Enable **Cloud Run** and **Container Registry** APIs in your GCP project.
- Create a service account, download its JSON key, and add it as `GCP_SA_KEY` in your GitHub repo secrets.
- Required scopes: `cloud-run`, `cloud-platform`, `container-registry`.

#### 3. Note the service URL

After deploying, get the Cloud Run service URL:

```bash
gcloud run services describe monowave-mcp --region us-central1 --format json | jq -r '.uri'
```

The URL will look like `https://monowave-mcp-xxxx-uc.a.run.app`. This is the endpoint your MCP client (Kilo, ChatGPT, etc.) connects to using the Streamable HTTP transport. Append `/mcp` for the MCP endpoint.

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

The server is stateless and single-threaded. In stdio mode (default) there is no HTTP port, no database, and no file storage. In Streamable HTTP mode (Cloud Run) it exposes a single HTTP port — no database or file storage needed.

---

## Using with Kilo

Kilo supports both local (stdio) and remote (HTTP) MCP servers. MCP config goes in `~/.config/kilo/kilo.json` (or the equivalent for your setup).

### Option 1: Local (stdio)

Run the server as a subprocess:

```json
{
  "mcp": {
    "monowave-mcp": {
      "type": "local",
      "command": ["node", "/path/to/monowave-mcp/dist/index.js"],
      "enabled": true
    }
  }
}
```

### Option 2: Remote via Cloud Run (Streamable HTTP)

After deploying to Cloud Run (see Deploying to Cloud Run above), point Kilo directly at the service URL:

```json
{
  "mcp": {
    "monowave-mcp": {
      "type": "remote",
      "url": "https://monowave-mcp-xxxx-uc.a.run.app/mcp",
      "enabled": true
    }
  }
}
```

Replace the URL with the one from your Cloud Run service. No local Docker or Node.js needed — Kilo connects over the internet to the Cloud Run endpoint.

> Note: If your Cloud Run service requires authentication, add an `"headers"` field with an `Authorization` token. For a public/internal service, no extra config is needed.

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
│   ├── index.ts                  # stdio entry point
│   ├── server.ts                 # shared server factory
│   ├── http-index.ts              # Streamable HTTP entry point (Cloud Run)
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
| `npm start`       | Run the compiled stdio server          |
| `npm run start:http` | Run the compiled Streamable HTTP server |
| `npm run dev`     | Auto-restart stdio on source changes   |
| `npm run dev:http` | Auto-restart HTTP on source changes     |
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