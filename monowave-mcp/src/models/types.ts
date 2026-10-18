export interface OHLCBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type Classification =
  | "directional_up"
  | "directional_down"
  | "non_directional";

export interface CashNode {
  timestamp: number;
  barIndex: number;
  price: number;
  classification: Classification | null;
  segmentPrice: number;
}

export interface CashSegment {
  startTimestamp: number;
  endTimestamp: number;
  startBarIndex: number;
  endBarIndex: number;
  startPrice: number;
  endPrice: number;
  direction: 1 | -1;
  speed: number;
  classification: Classification;
}

export interface CashDataResult {
  nodes: CashNode[];
  segments: CashSegment[];
  meta: {
    symbol: string;
    timeframe: string;
    barsFetched: number;
    speedMaLen: number;
    speedMult: number;
    avgSpeed: number;
    threshold: number;
  };
}