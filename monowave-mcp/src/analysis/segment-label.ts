import type { Classification } from "../models/types.js";

export function classifySegment(
  speed: number,
  avgSpeed: number | null,
  threshold: number,
  direction: 1 | -1,
): Classification {
  if (avgSpeed === null) {
    return direction === 1 ? "directional_up" : "directional_down";
  }
  if (speed >= threshold) {
    return direction === 1 ? "directional_up" : "directional_down";
  }
  return "non_directional";
}