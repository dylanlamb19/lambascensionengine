"""Stage A + Stage B opportunity score. Estimates are labeled. Missing data stays unknown."""

def classify(total: int) -> str:
    if total >= 80:
        return "priority"
    if total >= 65:
        return "strong"
    if total >= 50:
        return "possible"
    return "low"


def _find(audit, fid):
    if not audit:
        return None
    facts = audit.facts or {}
    for f in facts.get("findings") or []:
        if f.get("id") == fid:
            return f
    return None


def _no(f):
    if not f:
        return False
    r = (f.get("result") or "").lower()
    return r.startswith("no ") or "missing" in r or "not retrieved" in r


def score_company(c, audit=None) -> dict:
    why = []
    job = c.job_value_est or 0
    if job >= 15000:
        financial = 25
        why.append("Financial 25/25: vertical job estimate ≥ $15k (estimate, not verified revenue)")
    elif job >= 10000:
        financial = 20
        why.append("Financial 20/25: vertical job estimate ≥ $10k (estimate)")
    elif job >= 7000:
        financial = 14
        why.append("Financial 14/25: vertical job estimate ≥ $7k (estimate)")
    else:
        financial = 8
        why.append("Financial 8/25: lower ticket estimate — ability-to-pay is unproven")

    rc = c.review_count or 0
    if rc >= 400:
        demand = 15
        why.append(f"Demand 15/15: {rc} reviews (volume proxy, not revenue)")
    elif rc >= 80:
        demand = 12
        why.append(f"Demand 12/15: {rc} reviews")
    elif rc >= 20:
        demand = 8
        why.append(f"Demand 8/15: {rc} reviews")
    else:
        demand = 3
        why.append("Demand 3/15: thin public review volume")

    pixel = _find(audit, "meta_pixel")
    gtm = _find(audit, "gtm")
    gtag = _find(audit, "gtag")
    ads_tag = _find(audit, "ads_conversion_tag")
    if not audit:
        ads = 8
        why.append("Advertising 8/20: website not audited — ads status unknown")
    else:
        ads = 12
        why.append("Advertising 12/20 baseline: no ad-library check yet (unknown if they buy ads)")
        if pixel and not _no(pixel):
            ads -= 3
            why.append("Advertising −3: Meta Pixel on a checked page (not proof of active ads)")
        elif pixel and _no(pixel):
            ads += 4
            why.append("Advertising +4: no Meta Pixel on checked pages (not proof they do not advertise)")
        if gtag and _no(gtag) and gtm and _no(gtm):
            ads += 3
            why.append("Advertising +3: no gtag/GTM on checked pages")
        if ads_tag and not _no(ads_tag):
            ads -= 2
            why.append("Advertising −2: conversion-like Google tag on a checked page")
        ads = max(0, min(20, ads))

    form = _find(audit, "contact_form") or _find(audit, "contact_form_inner")
    tel = _find(audit, "click_to_call")
    book = _find(audit, "booking")
    psi = _find(audit, "pagespeed_mobile")
    https = _find(audit, "https")
    if not audit:
        funnel = 6
        why.append("Funnel 6/15: audit not run")
    else:
        funnel = 4
        why.append("Funnel 4/15 baseline after audit")
        if tel and _no(tel):
            funnel += 3
            why.append("Funnel +3: no click-to-call (leak)")
        if form and _no(form):
            funnel += 3
            why.append("Funnel +3: no form on checked pages")
        if book and _no(book):
            funnel += 2
            why.append("Funnel +2: booking provider unknown/absent")
        if https and "HTTP only" in (https.get("result") or ""):
            funnel += 2
            why.append("Funnel +2: homepage not HTTPS")
        if psi and psi.get("status") == "VERIFIED":
            try:
                n = int(str(psi.get("result", "100")).split()[0])
                if n < 50:
                    funnel += 2
                    why.append(f"Funnel +2: mobile performance {n}")
            except ValueError:
                pass
        funnel = min(15, funnel)

    named = any(getattr(x, "name", None) for x in (c.contacts or []))
    if named:
        access = 6
        why.append("Access 6/10: public name on file — not enriched (Hunter off)")
    elif c.phone:
        access = 3
        why.append("Access 3/10: public phone only — decision-maker unknown")
    else:
        access = 1
        why.append("Access 1/10: no verified decision-maker")

    years = c.years_in_business or 0
    if years >= 10:
        maturity = 10
        why.append(f"Maturity 10/10: {years} years listed")
    elif years >= 5:
        maturity = 7
        why.append("Maturity 7/10: 5+ years listed")
    elif rc >= 80:
        maturity = 6
        why.append("Maturity 6/10: review volume implies operating business (tenure unknown)")
    else:
        maturity = 4
        why.append("Maturity 4/10: tenure unknown")

    conf = 2
    if c.source in ("google_places", "public-research", "manual"):
        conf += 1
    if audit and (audit.status in ("complete", "partial")):
        conf += 2
        why.append("Confidence 4–5/5: discovery + website audit")
    else:
        why.append("Confidence 2–3/5: discovery only")
    conf = min(5, conf)

    penalty = 0
    if rc >= 800 and pixel and not _no(pixel):
        penalty = 8
        why.append("Penalty −8: high volume + pixel on site — may already buy media")

    total = max(0, min(100, financial + demand + ads + funnel + access + maturity + conf - penalty))
    return {
        "total": total,
        "fit": classify(total),
        "breakdown": {
            "financial": financial,
            "demand": demand,
            "ads": ads,
            "funnel": funnel,
            "access": access,
            "maturity": maturity,
            "confidence": conf,
            "penalty": penalty,
            "caps": {"financial": 25, "demand": 15, "ads": 20, "funnel": 15, "access": 10, "maturity": 10, "confidence": 5},
        },
        "why": why,
    }


def opener(c, contact_name=""):
    who = contact_name.split()[0] if contact_name else ""
    return (
        f"Hi{(' ' + who) if who else ''},\n\n"
        f"Looked at {c.name} in {c.city or 'your market'}. "
        f"Public reviews suggest demand is not the bottleneck.\n\n"
        f"I buy Google and Meta for trades where one job can fund a month of media. "
        f"This note is not a retainer pitch — I can send a short teardown of the public site/ads signals only.\n\n"
        f"Want that?"
    )
