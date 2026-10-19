import express from "express";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { createServer } from "./server.js";

const app = express();
app.use(express.json());

const transports: Map<string, SSEServerTransport> = new Map();

app.get("/sse", async (req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);

  res.on("close", () => {
    transports.delete(transport.sessionId);
  });

  const server = createServer();
  await server.connect(transport);
});

app.post("/messages", async (req, res) => {
  const sessionId = req.query.sessionId as string;
  const transport = transports.get(sessionId);
  if (transport) {
    await transport.handlePostMessage(req, res, req.body);
  } else {
    res.status(400).json({ error: "No transport found for sessionId" });
  }
});

const PORT = parseInt(process.env.PORT || "3000", 10);
app.listen(PORT, () => {
  console.log(`Monowave MCP SSE server listening on port ${PORT}`);
  console.log("  GET  /sse          - Establish SSE stream");
  console.log("  POST /messages     - Send messages to server");
});