import { z } from "zod";
import { fetchOHLCBars } from "../market/bybit.js";
import { processCashData } from "../analysis/cash-data.js";
import { cashDataToCsv } from "../analysis/cash-csv.js";

const inputSchema = {
  symbol: z.string().describe("Base asset name, e.g. BTC"),
  timeframe: z.string().describe("Bybit interval: 1,3,5,15,30,60,120,240,360,720,D,W,M"),
  format: z
    .enum(["json", "csv"])
    .default("csv")
    .describe("Output format. csv returns node rows (timestamp,datetime,barIndex,price,classification,segmentPrice); json returns the full nodes/segments/meta object"),
};

export async function getCashDataHandler(
  args: { symbol: string; timeframe: string; format?: "json" | "csv" },
  _extra?: unknown,
) {
  try {
    const pair = args.symbol.toUpperCase() + "USDT";
    const bars = await fetchOHLCBars(pair, args.timeframe);
    const result = processCashData(bars, args.symbol.toUpperCase(), args.timeframe);
    const text = args.format === "json" ? JSON.stringify(result) : cashDataToCsv(result);
    return {
      content: [{ type: "text" as const, text }],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text" as const, text: JSON.stringify({ error: message }) }],
      isError: true,
    };
  }
}

export { inputSchema as getCashDataInputSchema };