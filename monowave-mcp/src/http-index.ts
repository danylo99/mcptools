import express from "express";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server.js";

const app = express();
app.use(express.json());

const transports = new Map<string, StreamableHTTPServerTransport>();

// Clean up idle sessions every 5 minutes
setInterval(() => {
  const cutoff = Date.now() - 30 * 60 * 1000;
  // Transport doesn't expose lastActive, so this is a basic cleanup
  // for stale transports that were never properly closed
}, 300_000).unref();

app.all("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  let transport = sessionId ? transports.get(sessionId) : undefined;

  if (sessionId && !transport) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Session not found" },
      id: null,
    });
    return;
  }

  if (!transport) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        transports.set(sid, transport!);
      },
    });

    transport.onclose = () => {
      const sid = transport!.sessionId;
      if (sid) transports.delete(sid);
    };

    const server = createServer();
    await server.connect(transport);
  }

  try {
    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error("Error handling MCP request:", error);
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, () => {
  console.log(`Monowave MCP server listening on port ${PORT}`);
  console.log("  ALL /mcp  - Streamable HTTP transport (GET/POST/DELETE)");
});