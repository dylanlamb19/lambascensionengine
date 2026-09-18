export type CompanyKind = "local_service" | "medical" | "saas" | "b2b" | "other";

export function companyKind(vertical: string): CompanyKind {
  const v = (vertical || "").toLowerCase();
  if (/roof|hvac|plumb|sewer|foundation|remodel|solar|landscap|pest|pool|fence|paving|electric/.test(v)) return "local_service";
  if (/med spa|dental|dentist|clinic|cosmetic|derma|plastic surg|orthodont|chiro|medical/.test(v)) return "medical";
  if (/saas|software|platform|app\b|cloud/.test(v)) return "saas";
  if (/consult|agenc|law|attorney|account|architect|engineer|insurance|financ|b2b|staffing|it service/.test(v)) return "b2b";
  return "other";
}

export function kindPlain(kind: CompanyKind): string {
  return {
    local_service: "local / field service",
    medical: "medical / cosmetic",
    saas: "software / SaaS",
    b2b: "B2B / professional services",
    other: "other high-ticket-capable",
  }[kind];
}
