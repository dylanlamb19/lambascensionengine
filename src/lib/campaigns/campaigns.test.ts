import { describe, expect, it } from "vitest";
import { buildMembership } from "./membership";
import { mergeFieldsFromProspect, mergeTemplate } from "./merge";
import type { Prospect } from "../review-brief.ts";

function baseProspect(over: Partial<Prospect> & { uid: string; name: string }): Prospect {
  return {
    id: 1,
    uid: over.uid,
    name: over.name,
    vertical: over.vertical || "dental",
    city: over.city || "Dallas",
    website: over.website || "https://example.com",
    phone: over.phone || "UNKNOWN",
    review_count: 0,
    google_rating: "UNKNOWN",
    job_value_est: 0,
    score: 50,
    fit: over.fit || "possible",
    fit_plain: "",
    stage: over.stage || "Qualified",
    stage_plain: "",
    research_status: over.research_status || "complete",
    findings: [],
    contacts: over.contacts || [],
    is_demo: over.is_demo,
    suppressed: over.suppressed,
    readiness: over.readiness || "POSSIBLE CANDIDATE",
  };
}

describe("mergeTemplate", () => {
  it("fills real fields only and drops empty sections", () => {
    const body = mergeTemplate(
      "Hi{{#decision_maker}} {{decision_maker}}{{/decision_maker}},\n{{company}} in {{city}}",
      { company: "Acme Dental", decision_maker: "", vertical: "dental", city: "Dallas", email: "a@x.com" },
    );
    expect(body).toContain("Acme Dental");
    expect(body).toContain("Dallas");
    expect(body).not.toContain("decision_maker");
    expect(body.startsWith("Hi,")).toBe(true);
  });
});

describe("buildMembership", () => {
  it("skips prospects without usable email", () => {
    const rows = buildMembership({
      prospects: [
        baseProspect({
          uid: "p1",
          name: "No Email LLC",
          contacts: [{ name: "Pat", title: "Owner", email: "UNKNOWN", email_status: "unverified", profile_url: "", source: "", last_verified: "" }],
        }),
      ],
    });
    expect(rows[0]?.status).toBe("skipped");
    expect(rows[0]?.skipReason).toMatch(/usable email/i);
  });

  it("marks email-ready prospects eligible", () => {
    const rows = buildMembership({
      prospects: [
        baseProspect({
          uid: "p2",
          name: "Ready Dental",
          fit: "strong",
          readiness: "STRONG CANDIDATE FOR FURTHER QUALIFICATION",
          contacts: [{ name: "Sam", title: "Owner", email: "sam@ready.example", email_status: "verified", profile_url: "", source: "site", last_verified: "" }],
        }),
      ],
    });
    expect(rows[0]?.status).toBe("eligible");
    expect(rows[0]?.recipient).toBe("sam@ready.example");
  });

  it("excludes demo and suppressed fail-closed", () => {
    const demo = buildMembership({
      prospects: [
        baseProspect({
          uid: "p3",
          name: "Demo Co",
          is_demo: true,
          contacts: [{ name: "X", title: "", email: "x@demo.example", email_status: "verified", profile_url: "", source: "", last_verified: "" }],
        }),
      ],
    });
    expect(demo[0]?.status).toBe("skipped");
    expect(demo[0]?.skipReason).toMatch(/DEMO\/TEST/i);

    const suppressed = buildMembership({
      prospects: [
        baseProspect({
          uid: "p4",
          name: "Gone Co",
          suppressed: true,
          contacts: [{ name: "X", title: "", email: "x@gone.example", email_status: "verified", profile_url: "", source: "", last_verified: "" }],
        }),
      ],
    });
    expect(suppressed[0]?.status).toBe("suppressed");
  });

  it("does not treat LinkedIn-only as contactable", () => {
    const rows = buildMembership({
      prospects: [
        baseProspect({
          uid: "p5",
          name: "LinkedIn Only",
          contacts: [{ name: "Li", title: "Owner", email: "UNKNOWN", email_status: "unverified", profile_url: "https://linkedin.com/in/li", source: "linkedin", last_verified: "" }],
        }),
      ],
    });
    expect(rows[0]?.status).toBe("skipped");
    expect(rows[0]?.recipient).toBe("");
  });
});

describe("mergeFieldsFromProspect", () => {
  it("never invents email", () => {
    const f = mergeFieldsFromProspect(baseProspect({ uid: "p6", name: "Acme", contacts: [] }));
    expect(f.email).toBe("");
    expect(f.company).toBe("Acme");
  });
});
