import type { FulfillmentState, ImportedLead } from "../packages/types.ts";

export type ParsedLead = {
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  source: string;
};

const MAX_ROWS = 200;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FORMULA = /^[=+\-@]/;

export function parseLeadCsv(text: string, tenantId: string): { ok: true; rows: ParsedLead[] } | { ok: false; reason: string } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) return { ok: false, reason: "The CSV is empty." };
  const header = splitCsvLine(lines[0]).map((cell) => cell.trim().toLowerCase());
  const nameAt = header.indexOf("name");
  const emailAt = header.indexOf("email");
  if (nameAt < 0 || emailAt < 0) return { ok: false, reason: "The CSV needs name and email columns." };
  const phoneAt = header.indexOf("phone");
  const sourceAt = header.indexOf("source");
  const tenantAt = header.findIndex((cell) => cell === "workspace" || cell === "tenant" || cell === "tenantid");
  if (lines.length === 1) return { ok: false, reason: "The CSV has no lead rows." };
  if (lines.length - 1 > MAX_ROWS) return { ok: false, reason: `A dry-run import accepts up to ${MAX_ROWS} rows.` };
  const rows: ParsedLead[] = [];
  const seen = new Set<string>();
  for (let index = 1; index < lines.length; index += 1) {
    const cells = splitCsvLine(lines[index]);
    const rowNumber = index + 1;
    if (tenantAt >= 0) {
      const claimed = (cells[tenantAt] || "").trim();
      if (claimed && claimed !== tenantId) return { ok: false, reason: `Row ${rowNumber} is for a different workspace.` };
    }
    const contactName = (cells[nameAt] || "").trim().replace(/\s+/g, " ");
    const contactEmail = (cells[emailAt] || "").trim().toLowerCase();
    const contactPhone = phoneAt >= 0 ? (cells[phoneAt] || "").trim() : "";
    const source = sourceAt >= 0 ? (cells[sourceAt] || "").trim() : "";
    if (!contactName) return { ok: false, reason: `Row ${rowNumber} needs a name.` };
    if (FORMULA.test(contactName) || FORMULA.test(contactEmail) || FORMULA.test(source) || FORMULA.test(contactPhone)) {
      return { ok: false, reason: `Row ${rowNumber} looks like a formula. It was not imported.` };
    }
    if (!EMAIL.test(contactEmail) || contactEmail.length > 200) return { ok: false, reason: `Row ${rowNumber} needs an email address.` };
    if (contactName.length > 120) return { ok: false, reason: `Row ${rowNumber} name is too long.` };
    if (contactPhone.length > 40 || (contactPhone && !/^[0-9+().\-\s]+$/.test(contactPhone))) {
      return { ok: false, reason: `Row ${rowNumber} phone number is not valid.` };
    }
    if (source.length > 80) return { ok: false, reason: `Row ${rowNumber} source is too long.` };
    if (seen.has(contactEmail)) return { ok: false, reason: `Row ${rowNumber} repeats ${contactEmail}.` };
    seen.add(contactEmail);
    rows.push({ contactName, contactEmail, contactPhone, source });
  }
  return { ok: true, rows };
}

export function importLeadCsv(
  state: FulfillmentState,
  tenantId: string,
  clientId: string,
  csv: string,
  now: string,
  ids: () => string = sequentialIds(),
): { ok: true; state: FulfillmentState; imported: number } | { ok: false; state: FulfillmentState; reason: string } {
  const client = (state.clients || []).find((row) => row.id === clientId && row.tenantId === tenantId);
  if (!client) return { ok: false, state, reason: "That client is not in this workspace." };
  const parsed = parseLeadCsv(csv, tenantId);
  if (!parsed.ok) return { ok: false, state, reason: parsed.reason };
  const leads: ImportedLead[] = parsed.rows.map((row) => ({
    id: ids(),
    tenantId,
    clientId,
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    source: row.source,
    mode: "dry_run",
    createdAt: now,
  }));
  return {
    ok: true,
    imported: leads.length,
    state: { ...state, importedLeads: [...(state.importedLeads || []), ...leads] },
  };
}

function sequentialIds(): () => string {
  let n = 0;
  return () => `lead_import_${++n}`;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === "\"" && line[i + 1] === "\"") {
        current += "\"";
        i += 1;
      } else if (char === "\"") quoted = false;
      else current += char;
    } else if (char === "\"") quoted = true;
    else if (char === ",") {
      cells.push(current);
      current = "";
    } else current += char;
  }
  cells.push(current);
  return cells;
}
