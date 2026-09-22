"use client";

const VERTICALS = [
  "Roofing",
  "HVAC",
  "Plumbing / sewer",
  "Foundation repair",
  "Solar",
  "Med spa / cosmetic",
  "Dental",
  "Law / personal injury",
  "B2B consulting",
  "SaaS / software",
  "Other",
] as const;

export function FindVerticalField({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  const known = VERTICALS.includes(value as (typeof VERTICALS)[number]);
  const selectValue = known ? value : value ? "Other" : "Roofing";
  const showCustom = !known || value === "" || selectValue === "Other";
  return (
    <>
      <label className="la-label">What kind of company?</label>
      <select
        className="la-field mb-3"
        value={selectValue}
        onChange={(e) => onChange(e.target.value === "Other" ? "" : e.target.value)}
      >
        {VERTICALS.map((x) => (
          <option key={x} value={x}>
            {x}
          </option>
        ))}
      </select>
      {showCustom && selectValue === "Other" ? (
        <input
          className="la-field mb-3"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Type the kind of company…"
          aria-label="Custom company type"
        />
      ) : null}
    </>
  );
}
