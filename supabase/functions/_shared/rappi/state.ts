const TERMINAL = new Set(["COMPLETED", "CANCELLED"]);
const RANK: Record<string, number> = {
  UNKNOWN: 0,
  RECEIVED: 1,
  IN_PROGRESS: 2,
  READY: 3,
  IN_DELIVERY: 4,
  COMPLETED: 5,
  CANCELLED: 5,
};

export function shouldApplyOrderState(
  currentStatus: string | null | undefined,
  currentAt: string | null | undefined,
  nextStatus: string | null | undefined,
  nextAt: string | null | undefined,
): boolean {
  const current = String(currentStatus || "UNKNOWN").toUpperCase();
  const next = String(nextStatus || "UNKNOWN").toUpperCase();
  const currentTime = Date.parse(String(currentAt || ""));
  const nextTime = Date.parse(String(nextAt || ""));

  if (Number.isFinite(currentTime) && Number.isFinite(nextTime) && nextTime < currentTime) return false;
  if (TERMINAL.has(current) && !TERMINAL.has(next)) return false;
  if (
    Number.isFinite(currentTime) && Number.isFinite(nextTime) && nextTime === currentTime &&
    (RANK[next] ?? 0) < (RANK[current] ?? 0)
  ) return false;

  return true;
}
