import { z } from "zod";
import { fetchOHLCBars } from "../market/bybit.js";
import { processCashData } from "../analysis/cash-data.js";

const inputSchema = {
  symbol: z.string().describe("Base asset name, e.g. BTC"),
  timeframe: z.string().describe("Bybit interval: 1,3,5,15,30,60,120,240,360,720,D,W,M"),
};

export async function getCashDataHandler(
  args: { symbol: string; timeframe: string },
  _extra?: unknown,
) {
  try {
    const pair = args.symbol.toUpperCase() + "USDT";
    const bars = await fetchOHLCBars(pair, args.timeframe);
    const result = processCashData(bars, args.symbol.toUpperCase(), args.timeframe);
    return {
      content: [{ type: "text" as const, text: JSON.stringify(result) }],
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