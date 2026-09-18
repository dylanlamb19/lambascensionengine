"""Rule-based opportunity flags. Each flag cites evidence ids."""

def build_flags(findings: list[dict], review_count: int) -> list[dict]:
    by = {f["id"]: f for f in findings}
    flags = []

    def add(code, title, fid):
        f = by.get(fid)
        if not f:
            return
        flags.append({"code": code, "title": title, "evidence_id": fid, "status": f["status"], "result": f["result"]})

    psi = by.get("pagespeed_mobile")
    if psi and psi.get("status") == "VERIFIED":
        try:
            n = int(str(psi.get("result", "")).split()[0])
            if n < 50:
                add("SLOW_MOBILE_SITE", "SLOW MOBILE SITE", "pagespeed_mobile")
        except ValueError:
            pass
    if by.get("click_to_call") and by["click_to_call"]["status"] == "VERIFIED" and "No " in by["click_to_call"]["result"]:
        add("NO_CLICK_TO_CALL", "NO CLICK-TO-CALL", "click_to_call")
    if by.get("contact_form") and by["contact_form"]["status"] in ("VERIFIED", "OBSERVED") and by["contact_form"]["result"].startswith("No "):
        add("NO_FORM_DETECTED", "NO FORM DETECTED", "contact_form")
    if by.get("booking") and by["booking"]["result"].startswith("No "):
        add("NO_BOOKING_CTA", "NO BOOKING CTA", "booking")
    gtm = by.get("gtm")
    gtag = by.get("gtag")
    pixel = by.get("meta_pixel")
    if gtm and gtag and pixel:
        if all("No " in (x.get("result") or "") for x in (gtm, gtag, pixel)):
            add("NO_TRACKING_TAG_DETECTED", "NO TRACKING TAG DETECTED ON CHECKED PAGES", "meta_pixel")
    if review_count >= 80 and by.get("contact_form") and by["contact_form"]["result"].startswith("No "):
        add("HIGH_REVIEW_VOLUME_WEAK_FUNNEL", "HIGH REVIEW VOLUME + WEAK FUNNEL", "contact_form")
    if review_count >= 80:
        flags.append({
            "code": "STRONG_DEMAND_SIGNAL",
            "title": "STRONG DEMAND SIGNAL",
            "evidence_id": "reviews",
            "status": "VERIFIED",
            "result": f"{review_count} public reviews (discovery)",
        })
    return flags
