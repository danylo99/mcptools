import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getCashDataHandler, getCashDataInputSchema } from "./tools/get-cash-data.js";

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: "monowave-mcp",
      version: "1.0.0",
    },
    {
      capabilities: { tools: {} },
    },
  );

  server.tool(
    "get_cash_data",
    "Fetch cash data (monowaves) for an asset from Bybit and classify segments as directional or non-directional",
    getCashDataInputSchema,
    getCashDataHandler,
  );

  return server;
}