export function isOperatorDesk(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const w = window as unknown as { __LA_OPERATOR?: boolean };
    if (w.__LA_OPERATOR) return true;
    if (document.documentElement.getAttribute("data-la-operator") === "1") return true;
    const q = new URLSearchParams(window.location.search);
    if (q.has("ara_computer")) return true;
    if (/(?:^|[?&])ara_computer=1(?:&|$)/.test(window.location.href)) return true;
  } catch {
    /* ignore */
  }
  return false;
}
