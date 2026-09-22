/**
 * High-ticket Find Clients presets for Dylan’s Texas ICP.
 * Map onto Find form fields: vertical → vert, location → city, limit → findLimit.
 * Places search only — no invented businesses, emails, or ROAS.
 */
export type HighTicketFindPreset = {
  id: string;
  label: string;
  vertical: string;
  location: string;
  limit: number;
};

export const HIGH_TICKET_FIND_PRESETS: HighTicketFindPreset[] = [
  { id: "dental-dallas", label: "Dental Dallas", vertical: "Dental", location: "Dallas, TX", limit: 8 },
  { id: "medspa-houston", label: "Med spa Houston", vertical: "Med spa / cosmetic", location: "Houston, TX", limit: 8 },
  { id: "pi-austin", label: "Personal injury Austin", vertical: "Law / personal injury", location: "Austin, TX", limit: 8 },
  { id: "b2b-fort-worth", label: "B2B consulting Fort Worth", vertical: "B2B consulting", location: "Fort Worth, TX", limit: 8 },
  { id: "cosmetic-dentists-sa", label: "Cosmetic dentists San Antonio", vertical: "Dental", location: "San Antonio, TX", limit: 8 },
];

/** Apply a preset into Find Clients form setters / runFind opts. */
export function presetToFindArgs(preset: HighTicketFindPreset): {
  vertical: string;
  location: string;
  limit: number;
} {
  return {
    vertical: preset.vertical,
    location: preset.location,
    limit: preset.limit,
  };
}
