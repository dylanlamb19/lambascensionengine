/**
 * Prospect discovery providers.
 * Google Places is the only live provider today.
 * Additional compliant B2B / directory providers can implement this later.
 * Do not scrape LinkedIn or invent companies.
 */

export type DiscoveryProviderId = "google_places";

export type DiscoveryProvider = {
  id: DiscoveryProviderId;
  label: string;
  live: boolean;
  note: string;
};

export const DISCOVERY_PROVIDERS: DiscoveryProvider[] = [
  {
    id: "google_places",
    label: "Google Places",
    live: true,
    note: "Live Find Clients. Real businesses only.",
  },
];

export function liveDiscoveryProviders(): DiscoveryProvider[] {
  return DISCOVERY_PROVIDERS.filter((p) => p.live);
}

export function providerStatus(): { live: DiscoveryProviderId[]; planned: string } {
  return {
    live: liveDiscoveryProviders().map((p) => p.id),
    planned: "B2B databases, professional directories, and licensed company datasets can be added later. They are not live.",
  };
}
