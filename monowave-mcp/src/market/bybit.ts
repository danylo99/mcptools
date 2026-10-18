import { DEFAULTS } from "../config.js";
import type { OHLCBar } from "../models/types.js";

const TF_MAP: Record<string, string> = {
  "1": "1", "3": "3", "5": "5", "15": "15", "30": "30",
  "60": "60", "120": "120", "240": "240", "360": "360", "720": "720",
  D: "D", "1D": "D",
  W: "W", "1W": "W",
  M: "M", "1M": "M",
};

export function normalizeBybitTimeframe(tf: string): string {
  const normalized = TF_MAP[tf];
  if (!normalized) {
    throw new Error(`Invalid timeframe: ${tf}. Valid values: 1,3,5,15,30,60,120,240,360,720,D,W,M`);
  }
  return normalized;
}

type BybitKlineEntry = [number, string, string, string, string, string, string];

export async function fetchOHLCBars(pair: string, timeframe: string): Promise<OHLCBar[]> {
  const normalizedTf = normalizeBybitTimeframe(timeframe);
  const url = `${DEFAULTS.BYBIT_BASE_URL}${DEFAULTS.BYBIT_KLINES_PATH}?category=${DEFAULTS.DEFAULT_CATEGORY}&symbol=${pair}&interval=${normalizedTf}&limit=${DEFAULTS.BAR_LIMIT}`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Bybit API returned HTTP ${response.status}: ${response.statusText}`);
  }

  const body = await response.json() as {
    retCode?: number;
    retMsg?: string;
    result?: { list?: BybitKlineEntry[] };
  };

  if (body.retCode !== undefined && body.retCode !== 0) {
    throw new Error(`Bybit API error: ${body.retMsg ?? "Unknown error"} (code ${body.retCode})`);
  }

  const list = body.result?.list;
  if (!list || list.length === 0) {
    throw new Error(`No data returned from Bybit for ${pair} at interval ${normalizedTf}`);
  }

  const bars = list.map((entry: BybitKlineEntry) => ({
    time: Number(entry[0]),
    open: parseFloat(entry[1]),
    high: parseFloat(entry[2]),
    low: parseFloat(entry[3]),
    close: parseFloat(entry[4]),
  }));

  // Ensure ascending chronological order (oldest first)
  bars.sort((a, b) => a.time - b.time);

  return bars;
}