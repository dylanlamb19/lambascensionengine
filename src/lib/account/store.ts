import { emptyBundle, type AccountBundle } from "./types.ts";

const globalStore = globalThis as typeof globalThis & { __laeAccountBundle?: AccountBundle };

export function readAccountBundle(): AccountBundle {
  globalStore.__laeAccountBundle ??= emptyBundle();
  return globalStore.__laeAccountBundle;
}

export function writeAccountBundle(next: AccountBundle): void {
  globalStore.__laeAccountBundle = next;
}
