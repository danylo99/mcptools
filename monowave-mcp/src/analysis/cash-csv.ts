import type { CashDataResult } from "../models/types.js";

const CSV_HEADER = "timestamp,datetime,barIndex,price,classification,segmentPrice";

function formatIso(ts: number): string {
  return new Date(ts).toISOString().replace(".000Z", "Z");
}

export function cashDataToCsv(result: CashDataResult): string {
  const rows = result.nodes.map((node) => {
    const classification = node.classification ?? "";
    return [
      node.timestamp,
      formatIso(node.timestamp),
      node.barIndex,
      node.price,
      classification,
      node.segmentPrice,
    ].join(",");
  });
  return [CSV_HEADER, ...rows].join("\n") + "\n";
}