export function placesKeyConfigured(read: (key: string) => string | undefined = (k) => process.env[k]?.trim()): boolean {
  return Boolean((read("GOOGLE_PLACES_API_KEY") || "").trim());
}

export function discoverySpoken(configured: boolean): string {
  return configured
    ? "Client discovery is ready."
    : "Live Find Clients is off because Google Places is not configured.";
}
