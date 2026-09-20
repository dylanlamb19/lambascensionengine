import type { Finding } from "../review-brief.ts";

function textOf(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function finding(
  id: string,
  result: string,
  status: Finding["status"],
  source: string,
): Finding {
  return { id, result, status, source, checked_at: new Date().toISOString(), confidence: status === "VERIFIED" ? "high" : "medium" };
}

function hasForm(html: string): boolean {
  if (/<form[\s>]/i.test(html) && /<input|<textarea/i.test(html)) return true;
  return /<(input|textarea)[^>]+(name|type)=['"]?(email|tel|phone|name|message)/i.test(html);
}

const CTA_RE = /\b(get a quote|free estimate|request (a )?quote|book (now|online)|schedule (now|a )?(service|appointment)|contact us|call now)\b/i;
const SERVICE_HREF = /href=["'][^"'#]*\/(services?|roofing|hvac|plumbing|foundation|implants|injury)[^"']*["']/i;
const BOOKING_RE = /calendly\.com|acuityscheduling|housecallpro|jobber\.com|setmore\.com|squareup\.com\/appointments|squire\.com/i;

export function extractPageFindings(html: string, pageUrl: string, kind: "home" | "inner"): Finding[] {
  const text = textOf(html);
  const first = text.slice(0, 1800);
  const out: Finding[] = [];
  if (kind === "home") {
    out.push(finding("resolves", "HTTP 200", "VERIFIED", `HTTP GET ${pageUrl}`));
    out.push(finding("https", pageUrl.startsWith("https") ? "HTTPS" : "HTTP", pageUrl.startsWith("https") ? "VERIFIED" : "OBSERVED", "final URL scheme"));
    const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, " ").trim() || "";
    if (title) out.push(finding("title", title.slice(0, 180), "VERIFIED", "HTML <title>"));
    const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || "";
    if (h1) out.push(finding("h1", h1.slice(0, 180), "VERIFIED", "HTML H1"));
  }
  const tel = /href=["']tel:/i.test(html);
  out.push(finding(
    "click_to_call",
    tel ? "tel: link found" : "No tel: link on this page",
    tel ? "VERIFIED" : "OBSERVED",
    "HTML <a href=tel:>",
  ));
  const phoneTxt = /\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}/.test(text);
  out.push(finding(
    "phone_visible",
    phoneTxt ? "Phone-like text on page" : "No phone-like text on this page",
    phoneTxt ? "VERIFIED" : "OBSERVED",
    "regex on page text",
  ));
  const form = hasForm(html);
  if (kind === "home") {
    out.push(finding(
      "contact_form",
      form ? "Form or form fields detected on homepage" : "No form detected on homepage",
      form ? "VERIFIED" : "OBSERVED",
      "HTML <form>/input",
    ));
  } else if (form) {
    out.push(finding("contact_form_inner", "Form detected on an inner checked page", "VERIFIED", `HTML <form> ${pageUrl}`));
  }
  const book = BOOKING_RE.test(html);
  out.push(finding(
    "booking",
    book ? "Known booking provider identified" : "No known booking provider identified",
    book ? "VERIFIED" : "UNKNOWN",
    "script/href vendor strings",
  ));
  const cta = CTA_RE.test(first);
  out.push(finding(
    "primary_cta",
    cta ? "Quote/book/contact wording near the top" : "No common quote/estimate CTA text in first content",
    cta ? "VERIFIED" : "OBSERVED",
    "regex on homepage text",
  ));
  if (kind === "home") {
    const services = SERVICE_HREF.test(html);
    out.push(finding(
      "service_pages",
      services ? "Service-path links on homepage" : "No service-path links on homepage",
      services ? "OBSERVED" : "OBSERVED",
      "internal href path keywords",
    ));
  }
  const testimonials = /\b(testimonial|reviews? from|google reviews|what our (clients|customers) say)\b/i.test(text);
  out.push(finding(
    "testimonials",
    testimonials ? "Review/testimonial language on page" : "No testimonial language on this page",
    testimonials ? "OBSERVED" : "UNKNOWN",
    "regex on page text",
  ));
  const financing = /\bfinanc(e|ing|ial)\b/i.test(text);
  out.push(finding(
    "financing",
    financing ? "Financing language on page" : "No financing language on this page",
    financing ? "OBSERVED" : "UNKNOWN",
    "regex on page text",
  ));
  const gtag = /gtag\(|googletagmanager\.com\/gtag|gtag\.js/i.test(html);
  const gtm = /GTM-[A-Z0-9]+|googletagmanager\.com\/gtm/i.test(html);
  const pixel = /fbq\(|connect\.facebook\.net\/.+\/fbevents/i.test(html);
  const ads = /googleadservices\.com\/pagead\/conversion|AW-\d+/i.test(html);
  out.push(finding("gtag", gtag ? "Google tag/gtag detected on checked page" : "No gtag on checked page", gtag ? "VERIFIED" : "OBSERVED", "HTML/script inspection"));
  out.push(finding("gtm", gtm ? "Google Tag Manager detected on checked page" : "No Google Tag Manager on checked page", gtm ? "VERIFIED" : "OBSERVED", "HTML/script inspection"));
  out.push(finding("meta_pixel", pixel ? "Meta Pixel snippet detected on checked page" : "No Meta Pixel snippet on checked page", pixel ? "VERIFIED" : "OBSERVED", "HTML/script inspection"));
  out.push(finding("ads_conversion_tag", ads ? "Google Ads conversion tag signal on checked page" : "No Google Ads conversion tag signal on checked page", ads ? "VERIFIED" : "VERIFIED", "HTML/script inspection"));
  return out;
}

function present(f: Finding): boolean {
  const r = (f.result || "").toLowerCase();
  if (f.status === "ERROR" || f.status === "UNKNOWN") return false;
  return !r.startsWith("no ") && !r.startsWith("missing");
}

export function mergeFindings(base: Finding[], extra: Finding[]): Finding[] {
  const map = new Map<string, Finding>();
  for (const f of [...base, ...extra]) {
    const prev = map.get(f.id);
    if (!prev) {
      map.set(f.id, f);
      continue;
    }
    if (present(f) && !present(prev)) map.set(f.id, f);
  }
  return [...map.values()];
}

export function websiteUnavailableFindings(reason: string): Finding[] {
  const status: Finding["status"] = /block/i.test(reason) ? "UNKNOWN" : "ERROR";
  return [finding("resolves", reason || "Website research unavailable", status, "HTTP GET homepage")];
}
