import { DEFAULTS } from "../config.js";
import { classifySegment } from "./segment-label.js";
import type { OHLCBar, CashNode, CashSegment, CashDataResult } from "../models/types.js";

const TF_TO_MINUTES: Record<string, number> = {
  "1": 1, "3": 3, "5": 5, "15": 15, "30": 30,
  "60": 60, "120": 120, "240": 240, "360": 360, "720": 720,
  D: 1440, "1D": 1440,
  W: 10080, "1W": 10080,
  M: 43200, "1M": 43200,
};

function timeframeToMinutes(tf: string): number {
  const mins = TF_TO_MINUTES[tf];
  if (mins === undefined) {
    throw new Error(`Unknown timeframe: ${tf}`);
  }
  return mins;
}

function autoDetectTF(chartInMinutes: number): string {
  if (chartInMinutes <= 5) return "60";
  if (chartInMinutes < 60) return "240";
  if (chartInMinutes < 240) return "D";
  if (chartInMinutes < 1440) return "W";
  return "M";
}

const MS_DAY = 86_400_000;
const MS_WEEK = 7 * MS_DAY;
// Monday 00:00:00 UTC (1970-01-05) as the weekly boundary epoch.
// Bybit W candles open Monday 00:00 UTC, matching TradingView's
// timeframe.change("W") boundaries for crypto symbols.
const MONDAY_EPOCH = 4 * MS_DAY;

// Maps a bar timestamp to the calendar-aligned period bucket of the
// operational timeframe, instead of anchoring the grid to the first bar.
function periodIndexOf(time: number, opTf: string, opTfMinutes: number): number {
  if (opTf === "1M" || opTf === "M") {
    const d = new Date(time);
    return d.getUTCFullYear() * 12 + d.getUTCMonth();
  }
  if (opTf === "1W" || opTf === "W") {
    return Math.floor((time - MONDAY_EPOCH) / MS_WEEK);
  }
  // Daily, hourly and minute timeframes align to 00:00 UTC boundaries.
  return Math.floor(time / (opTfMinutes * 60 * 1000));
}

function calcSpeed(
  x1: number, y1: number,
  x2: number, y2: number,
  chartInMinutes: number,
): number {
  const timeDiff = Math.abs(x2 - x1);
  const priceDiff = Math.abs(y2 - y1);
  const barsDiff = timeDiff / (chartInMinutes * 60 * 1000);
  return barsDiff > 0 ? priceDiff / barsDiff : 0.0;
}

function computeAvg(speedHistory: number[]): number | null {
  return speedHistory.length > 0
    ? speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length
    : null;
}

export function processCashData(
  bars: OHLCBar[],
  symbol: string,
  timeframe: string,
): CashDataResult {
  const chartInMinutes = timeframeToMinutes(timeframe);
  const opTfStr = autoDetectTF(chartInMinutes);
  const opTfMinutes = timeframeToMinutes(opTfStr);

  let currHighTime: number | null = null;
  let currHighVal: number | null = null;
  let currHighBarIdx: number | null = null;
  let currLowTime: number | null = null;
  let currLowVal: number | null = null;
  let currLowBarIdx: number | null = null;
  let currOpenVal: number | null = null;
  let currCloseVal: number | null = null;
  let currCloseBarIdx: number | null = null;

  let lastPointTime: number | null = null;
  let lastPointVal: number | null = null;
  let lastPointBarIdx: number | null = null;

  const speedHistory: number[] = [];
  const nodes: CashNode[] = [];
  const segments: CashSegment[] = [];

  let prevPeriodIndex: number | null = null;

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i];
    const periodIndex = periodIndexOf(bar.time, opTfStr, opTfMinutes);

    const isNewTF = prevPeriodIndex === null || periodIndex > prevPeriodIndex;

    if (isNewTF) {
      const pHighTime = currHighTime;
      const pHighVal = currHighVal;
      const pHighBarIdx = currHighBarIdx;
      const pLowTime = currLowTime;
      const pLowVal = currLowVal;
      const pLowBarIdx = currLowBarIdx;
      const pOpenVal = currOpenVal;
      const pCloseVal = currCloseVal;
      const pCloseBarIdx = currCloseBarIdx;

      currHighTime = bar.time;
      currHighVal = bar.high;
      currHighBarIdx = i;
      currLowTime = bar.time;
      currLowVal = bar.low;
      currLowBarIdx = i;
      currOpenVal = bar.open;
      currCloseVal = bar.close;
      currCloseBarIdx = i;

      if (pHighTime !== null && pLowTime !== null) {
        let highFirst: boolean;
        if (pHighTime < pLowTime) {
          highFirst = true;
        } else if (pLowTime < pHighTime) {
          highFirst = false;
        } else {
          highFirst = pCloseVal! < pOpenVal!;
        }

        const firstTime = highFirst ? pHighTime : pLowTime;
        const firstVal = highFirst ? pHighVal! : pLowVal!;
        const firstBarIdx = highFirst ? pHighBarIdx! : pLowBarIdx!;
        const secondTime = highFirst ? pLowTime : pHighTime;
        const secondVal = highFirst ? pLowVal! : pHighVal!;
        const secondBarIdx = highFirst ? pLowBarIdx! : pHighBarIdx!;

        if (lastPointTime === null) {
          lastPointTime = firstTime;
          lastPointVal = firstVal;
          lastPointBarIdx = firstBarIdx;
          nodes.push({
            timestamp: lastPointTime,
            barIndex: lastPointBarIdx,
            price: lastPointVal,
            classification: null,
            segmentPrice: lastPointVal,
          });
        }

        if (lastPointTime !== firstTime || lastPointVal !== firstVal) {
          const speed1 = calcSpeed(lastPointTime!, lastPointVal!, firstTime, firstVal, chartInMinutes);
          const dir1: 1 | -1 = firstVal >= lastPointVal! ? 1 : -1;
          const avg1 = computeAvg(speedHistory);
          const thresh1 = (avg1 ?? 0) * DEFAULTS.SPEED_MULT;
          const class1 = classifySegment(speed1, avg1, thresh1, dir1);

          speedHistory.push(speed1);
          if (speedHistory.length > DEFAULTS.SPEED_MA_LEN) {
            speedHistory.shift();
          }

          segments.push({
            startTimestamp: lastPointTime!,
            endTimestamp: firstTime,
            startBarIndex: lastPointBarIdx!,
            endBarIndex: firstBarIdx,
            startPrice: lastPointVal!,
            endPrice: firstVal,
            direction: dir1,
            speed: speed1,
            classification: class1,
          });

          nodes.push({
            timestamp: firstTime,
            barIndex: firstBarIdx,
            price: firstVal,
            classification: class1,
            segmentPrice: firstVal,
          });
        }

        if (firstTime !== secondTime || firstVal !== secondVal) {
          const speed2 = calcSpeed(firstTime, firstVal, secondTime, secondVal, chartInMinutes);
          const dir2: 1 | -1 = secondVal >= firstVal ? 1 : -1;
          const avg2 = computeAvg(speedHistory);
          const thresh2 = (avg2 ?? 0) * DEFAULTS.SPEED_MULT;
          const class2 = classifySegment(speed2, avg2, thresh2, dir2);

          speedHistory.push(speed2);
          if (speedHistory.length > DEFAULTS.SPEED_MA_LEN) {
            speedHistory.shift();
          }

          segments.push({
            startTimestamp: firstTime,
            endTimestamp: secondTime,
            startBarIndex: firstBarIdx,
            endBarIndex: secondBarIdx,
            startPrice: firstVal,
            endPrice: secondVal,
            direction: dir2,
            speed: speed2,
            classification: class2,
          });

          nodes.push({
            timestamp: secondTime,
            barIndex: secondBarIdx,
            price: secondVal,
            classification: class2,
            segmentPrice: secondVal,
          });
        }

        lastPointTime = secondTime;
        lastPointVal = secondVal;
        lastPointBarIdx = secondBarIdx;
      }

      prevPeriodIndex = periodIndex;
    } else {
      if (currHighVal === null || bar.high >= currHighVal) {
        currHighVal = bar.high;
        currHighTime = bar.time;
        currHighBarIdx = i;
      }
      if (currLowVal === null || bar.low <= currLowVal) {
        currLowVal = bar.low;
        currLowTime = bar.time;
        currLowBarIdx = i;
      }
      currCloseVal = bar.close;
      currCloseBarIdx = i;
    }
  }

  const avgSpeed = speedHistory.length > 0
    ? speedHistory.reduce((a, b) => a + b, 0) / speedHistory.length
    : 0;
  const threshold = avgSpeed * DEFAULTS.SPEED_MULT;

  return {
    nodes,
    segments,
    meta: {
      symbol,
      timeframe,
      barsFetched: bars.length,
      speedMaLen: DEFAULTS.SPEED_MA_LEN,
      speedMult: DEFAULTS.SPEED_MULT,
      avgSpeed,
      threshold,
    },
  };
}