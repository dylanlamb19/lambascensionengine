"use client";

import {
  HIGH_TICKET_FIND_PRESETS,
  type HighTicketFindPreset,
} from "@/lib/discovery/high-ticket-presets";

export function FindPresets({
  onPick,
  disabled,
}: {
  onPick: (preset: HighTicketFindPreset) => void;
  disabled?: boolean;
}) {
  return (
    <div className="mb-4">
      <p className="la-kicker">High-ticket presets</p>
      <p className="mt-1 mb-2 text-sm text-muted">
        One tap fills the form for Texas markets that pay. We only look up real Places listings.
      </p>
      <div className="flex flex-wrap gap-2">
        {HIGH_TICKET_FIND_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className="la-btn la-btn-ghost"
            disabled={disabled}
            onClick={() => onPick(p)}
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}
