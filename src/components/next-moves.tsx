"use client";

import { useMemo } from "react";
import type { FilterableProspect, ProspectViewFilter } from "@/lib/prospects/view-filter";

export type NextMovesProps = {
  prospects: FilterableProspect[];
  onFilter: (filter: ProspectViewFilter) => void;
  onFindHighTicket?: () => void;
  onOrderLinkedInEnrich?: () => void;
};

function countReach(rows: FilterableProspect[], reach: FilterableProspect["reach"]) {
  return rows.filter((r) => r.reach === reach).length;
}

export function NextMoves({
  prospects,
  onFilter,
  onFindHighTicket,
  onOrderLinkedInEnrich,
}: NextMovesProps) {
  const counts = useMemo(() => {
    const ready = countReach(prospects, "READY_TO_CONTACT");
    const contact = countReach(prospects, "NEEDS_CONTACT_INFO");
    const research = countReach(prospects, "NEEDS_RESEARCH");
    const linkedin = prospects.filter((p) => /linkedin/i.test(p.source || "")).length;
    return { ready, contact, research, linkedin };
  }, [prospects]);

  const chips: {
    key: string;
    label: string;
    hint: string;
    filter: ProspectViewFilter;
    show: boolean;
  }[] = [
    {
      key: "ready",
      label: `Ready to send (${counts.ready})`,
      hint: "You have enough to draft a note. Nothing sends until you confirm.",
      filter: { replace: true, reach: ["READY_TO_CONTACT"], sort: "needs_attention" },
      show: true,
    },
    {
      key: "contact",
      label: `Needs contact (${counts.contact})`,
      hint: "Find a real email or decision-maker before outreach.",
      filter: { replace: true, reach: ["NEEDS_CONTACT_INFO"], sort: "needs_attention" },
      show: true,
    },
    {
      key: "research",
      label: `Needs research (${counts.research})`,
      hint: "Look them up so you know who you’re pitching.",
      filter: { replace: true, reach: ["NEEDS_RESEARCH"], sort: "needs_attention" },
      show: true,
    },
    {
      key: "linkedin",
      label: `LinkedIn leads (${counts.linkedin})`,
      hint: "Prospects that came from LinkedIn research — your warmest Texas list.",
      filter: { replace: true, source: ["linkedin"], sort: "needs_attention" },
      show: true,
    },
    {
      key: "attn",
      label: "Your move first",
      hint: "Sort the whole Pipeline so research and contact gaps float to the top.",
      filter: { replace: true, sort: "needs_attention" },
      show: true,
    },
  ];

  return (
    <div className="mb-4">
      <p className="la-kicker">Next moves</p>
      <p className="mt-1 mb-2 text-sm text-muted">
        Cut through the noise. Tap a chip to see who can become a client next.
      </p>
      <div className="flex flex-wrap gap-2">
        {chips.filter((c) => c.show).map((c) => (
          <button
            key={c.key}
            type="button"
            className="la-btn la-btn-ghost"
            title={c.hint}
            onClick={() => onFilter(c.filter)}
          >
            {c.label}
          </button>
        ))}
        {onFindHighTicket ? (
          <button type="button" className="la-btn la-btn-quiet" onClick={onFindHighTicket}>
            Find high-ticket
          </button>
        ) : null}
        {onOrderLinkedInEnrich ? (
          <button type="button" className="la-btn la-btn-quiet" onClick={onOrderLinkedInEnrich}>
            Order LinkedIn enrich
          </button>
        ) : null}
      </div>
    </div>
  );
}
