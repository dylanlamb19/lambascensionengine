# Next Moves + booking mismatch wiring

Tip `owner-desk.tsx` on `linkedin-agent-in-app` was full-size when this shipped, so the snippets below were applied there. Keep this file if a later restore reverts the desk.

## SystemHealthAlert / SystemHealthPage

```tsx
const repairBookingMismatch = async () => {
  setRepairBusy(true);
  try {
    await repairBookingInvariantFn();
    const rerun = await sentinelRunFn({ data: { mode: "owner" } });
    if (rerun.ok) setSentinel(rerun.snapshot);
  } finally {
    setRepairBusy(false);
  }
};

<SystemHealthAlert
  snapshot={sentinel}
  onOpen={() => dispatchAction({ name: "NAVIGATE_HEALTH" })}
  onRepair={() => void repairBookingMismatch()}
  repairing={repairBusy}
/>

<SystemHealthPage
  snapshot={sentinel}
  running={sentinelBusy}
  onBack={() => dispatchAction({ name: "NAVIGATE_HOME" })}
  onRun={() => void runSentinelNow()}
  onRepair={() => void repairBookingMismatch()}
  repairing={repairBusy}
/>
```

## Pipeline NextMoves

```tsx
import { NextMoves } from "@/components/next-moves";

<NextMoves
  prospects={rows.map(fromProspect)}
  onFilter={(filter) => dispatchAction({ name: "FILTER_PROSPECTS", filter })}
  onFindHighTicket={() => {
    setView("find");
  }}
/>
```

## FindPresets

```tsx
import { FindPresets } from "@/components/find-presets";

<FindPresets
  disabled={findBusy || discoveryConfigured === false}
  onPick={(preset) => {
    setVert(preset.vertical);
    setCity(preset.location);
    setFindLimit(preset.limit);
    void runFind({ vertical: preset.vertical, location: preset.location, limit: preset.limit });
  }}
/>
```

## view-filter default sort

In `src/lib/prospects/view-filter.ts` `applyProspectFilter`:

```ts
const sort = filter.sort || "needs_attention";
```

(owner-desk also injects `sort: "needs_attention"` when the filter has no sort.)

Do not invent emails/ROAS/pricing. `repairBookingInvariantFn` only repairs proven booking mismatches — Sentinel stays inspect-only beyond that existing path.
