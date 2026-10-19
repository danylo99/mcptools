import { describe, it, expect } from "vitest";
import { cashDataToCsv } from "../src/analysis/cash-csv.js";
import type { CashDataResult } from "../src/models/types.js";

const sample: CashDataResult = {
  nodes: [
    {
      timestamp: 1778068800000,
      barIndex: 3,
      price: 44.79,
      classification: null,
      segmentPrice: 44.79,
    },
    {
      timestamp: 1778169600000,
      barIndex: 10,
      price: 58,
      classification: "directional_down",
      segmentPrice: 41.88,
    },
    {
      timestamp: 1785657600000,
      barIndex: 530,
      price: 51.15,
      classification: "non_directional",
      segmentPrice: 51.15,
    },
  ],
  segments: [],
  meta: {
    symbol: "HYPE",
    timeframe: "240",
    barsFetched: 1000,
    speedMaLen: 10,
    speedMult: 0.2,
    avgSpeed: 0,
    threshold: 0,
  },
};

describe("cashDataToCsv", () => {
  it("emits header matching hype_cashline.csv", () => {
    const csv = cashDataToCsv(sample);
    expect(csv.split("\n")[0]).toBe("timestamp,datetime,barIndex,price,classification,segmentPrice");
  });

  it("formats rows exactly like hype_cashline.csv", () => {
    const csv = cashDataToCsv(sample);
    const lines = csv.trim().split("\n");
    expect(lines[1]).toBe("1778068800000,2026-05-06T12:00:00Z,3,44.79,,44.79");
    expect(lines[2]).toBe("1778169600000,2026-05-07T16:00:00Z,10,58,directional_down,41.88");
    expect(lines[3]).toBe("1785657600000,2026-08-02T08:00:00Z,530,51.15,non_directional,51.15");
  });

  it("strips .000 from ISO milliseconds", () => {
    const csv = cashDataToCsv(sample);
    expect(csv).not.toContain(".000Z");
  });

  it("leaves classification empty for the first (null) node", () => {
    const csv = cashDataToCsv(sample);
    expect(csv).toContain(",44.79,,44.79");
  });
});