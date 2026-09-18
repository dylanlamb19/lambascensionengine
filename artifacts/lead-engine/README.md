# Lamb Ascension Lead Engine

Private B2B prospecting desk. Review → talk → close. Not mass spam.

**North-star (Sales OS + future Client Delivery OS):** see [NORTHSTAR.md](NORTHSTAR.md).  
Do not implement Delivery OS until Sales OS Phase 4+ is done. Phases 1–3 stay.

## Phase 3 (current)

Deterministic website auditor + Stage B scoring on top of Phases 1–2.

**Architecture:** Research Queue → SSRF-safe HTTP fetch (homepage + ≤5 inner pages) → HTML/script checks → optional PageSpeed Insights → opportunity flags → 0–100 score with why-drawer.

**Deterministic (no AI):** HTTPS, status, redirects, title/meta/H1, tel:, forms, CTA text, service/location paths, testimonials/financing language, chat/booking vendor strings, gtag/GTM/Meta Pixel/Ads conversion snippets, robots.txt, sitemap.xml, limited broken-link sample.

**External API:** Google PageSpeed Insights only (optional). HTML fetches are free.

**Cost / 100 researched sites:** HTML ~$0. PageSpeed ~$0 on the free quota (counted in usage). No OpenAI.

**SSRF:** http(s) only; DNS must resolve to public IPs; block loopback, RFC1918, link-local, metadata; re-validate every redirect; 1.5MB / 12s caps. Blocked sites are stored as BLOCKED, never bypassed.

**Cache:** website audits 14 days unless Force refresh.

**Not in Phase 3:** Hunter/Apollo, AI analysis, outbound send.

Sign in: `admin@localhost` / `changeme`

Live Places discovery stays off until `GOOGLE_PLACES_API_KEY` and `ENABLE_PLACES_DISCOVERY=true`.
