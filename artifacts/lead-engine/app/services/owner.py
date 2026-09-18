"""Owner Mode: tasks and plain-English copy. No invented metrics."""

FIT_WORDS = {
    "priority": "Strong fit — worth your time",
    "strong": "Good fit",
    "possible": "Possible, not a sure thing",
    "low": "Weak fit — easy skip",
}

STAGE_WORDS = {
    "New": "Just added",
    "Researching": "We’re looking them up",
    "Qualified": "Research done — your move",
    "Ready for Review": "Waiting for you to review",
    "Approved for Outreach": "Ready for you to send a note",
    "Contacted": "You already reached out",
    "Replied": "They wrote back",
    "Call Booked": "Call is on the calendar",
    "Proposal Sent": "Proposal is out",
    "Negotiation": "Talking terms",
    "Won": "Signed client",
    "Lost": "Not moving forward",
    "Do Not Contact": "Do not contact",
}


def friendly_error(code: str, message: str = "") -> dict:
    table = {
        "disabled": (
            "Finding companies on Google is turned off until a search key is added.",
            "Open Setup and follow “Connect Google search.”",
        ),
        "invalid_key": (
            "The Google search key was rejected. Nothing fake was added.",
            "Open Setup and paste a new key, or add a company yourself.",
        ),
        "quota": (
            "We hit today’s search limit so we stopped instead of guessing.",
            "Wait until tomorrow, or add a company by hand with Add Client.",
        ),
        "timeout": (
            "Their website took too long to answer. We did not invent results.",
            "Press Retry, or Skip and pick another company.",
        ),
        "zero": (
            "Google returned no real businesses for that search.",
            "Try a nearby city, or press Add Client if you already know them.",
        ),
        "blocked": (
            "Their website blocked our research bot. We did not sneak around it.",
            "Press Retry later, open the site yourself, or Skip.",
        ),
        "401": (
            "You’re signed out.",
            "Press Enter on the sign-in screen.",
        ),
        "429": (
            "We paused so we don’t overspend on lookups today.",
            "Come back tomorrow, or work the companies already on your list.",
        ),
    }
    title, next_step = table.get(code, (
        message or "Something went wrong, and we didn’t fake a result.",
        "Press Try again. If it repeats, open Setup.",
    ))
    return {"happened": title, "press": next_step, "code": code}


def explain(topic: str, ctx: dict | None = None) -> str:
    ctx = ctx or {}
    name = ctx.get("name") or "this company"
    texts = {
        "score": (
            f"{name} got a fit score from public info (reviews, trade, website) — not from their bank account. "
            "High score means they look like they could buy ads, not that they will. "
            "You still decide whether to talk to them."
        ),
        "research": (
            "Research means we open their real website and check simple things: can you call, is there a form, "
            "did we see tracking tags on the pages we checked. We do not guess hidden ad spend."
        ),
        "pixel": (
            "A Meta Pixel on a page only means a tracking snippet is present. "
            "It does not prove they run Facebook ads, and missing pixel does not prove they don’t."
        ),
        "places_off": (
            "Find Clients uses Google’s business list. Until a key is connected, we will not invent companies. "
            "You can still Add Client if you already know a name and website."
        ),
        "owner_mode": (
            "Owner Mode only shows what happened, why it matters, what to do, and (later) what AI recommends. "
            "APIs, logs, and formulas stay under See more."
        ),
        "tasks": (
            "Start My Tasks walks one thing at a time: research a site, retry a blocked site, or review a company. "
            "You can stop whenever you want."
        ),
        "flags": (
            "Flags are leftovers we noticed (no click-to-call, slow mobile, lots of reviews but a weak form). "
            "They are opportunities to talk about, not proof they will pay $10,000 a month."
        ),
        "won": (
            "Won means they signed. Turning them into a managed client (ads, reports, approvals) comes in a later system. "
            "Nothing is invented as revenue here."
        ),
        "send": (
            "Send is not live yet. You can copy a draft note and send it yourself. "
            "The app will not email anyone until you approve a later send feature."
        ),
        "default": (
            "This screen is for supervising, not for becoming a media-buyer expert. "
            "If a number is missing we show Unknown instead of making one up."
        ),
    }
    return texts.get(topic, texts["default"])


def build_tasks(companies: list) -> list[dict]:
    tasks = []
    queued = [c for c in companies if c.research_status == "queued" and (c.website or "")]
    failed = [c for c in companies if c.research_status in ("failed", "blocked")]
    review = [c for c in companies if c.stage in ("Ready for Review", "Qualified") and c.research_status in ("complete", "partial", "none", "queued")]
    calls = [c for c in companies if c.stage == "Call Booked"]
    outreach = [c for c in companies if c.stage == "Approved for Outreach"]
    if not companies:
        tasks.append({
            "id": "find",
            "severity": "yellow",
            "title": "Find companies to talk to",
            "plain": "Your list is empty. Start with a trade and a city, or add someone you already know.",
            "why": "Nothing to supervise until there are real companies.",
            "recommend": "Use Find Clients (Google list) or Add Client (you type the name).",
            "action": "find",
            "button": "Find Clients",
        })
    for c in failed[:8]:
        tasks.append({
            "id": f"fail-{c.id}",
            "severity": "red",
            "title": f"{c.name}: website research didn’t finish",
            "plain": "We couldn’t read their site (blocked or error). We did not invent an audit.",
            "why": "Without a site check you’re guessing about their funnel.",
            "recommend": "Retry once. If it fails again, open the website yourself or Skip.",
            "action": "retry",
            "button": "Retry",
            "company_id": c.id,
        })
    for c in queued[:8]:
        tasks.append({
            "id": f"res-{c.id}",
            "severity": "yellow",
            "title": f"Look up {c.name}",
            "plain": "They’re on your list. We haven’t opened their website yet.",
            "why": "A two-minute site check tells you if they’re worth a conversation.",
            "recommend": "Press Research. I’ll show what we actually found — not guesses.",
            "action": "research",
            "button": "Research",
            "company_id": c.id,
        })
    for c in outreach[:5]:
        tasks.append({
            "id": f"send-{c.id}",
            "severity": "yellow",
            "title": f"Send a note to {c.name}?",
            "plain": "You already approved them. Sending from the app is still off — copy the draft.",
            "why": "Waiting too long goes cold.",
            "recommend": "Open the company, copy the draft, send it yourself, then mark Contacted.",
            "action": "open",
            "button": "Open",
            "company_id": c.id,
        })
    for c in calls[:5]:
        tasks.append({
            "id": f"call-{c.id}",
            "severity": "yellow",
            "title": f"Call {c.name}",
            "plain": "A call is booked. Prep is still a short checklist, not a script from thin air.",
            "why": "Show up knowing their public site and reviews.",
            "recommend": "Open the company, skim the website findings, then call.",
            "action": "open",
            "button": "Call prep",
            "company_id": c.id,
        })
    for c in review:
        if c.research_status in ("complete", "partial") and c.fit in ("priority", "strong"):
            if not any(t.get("company_id") == c.id for t in tasks):
                tasks.append({
                    "id": f"rev-{c.id}",
                    "severity": "yellow",
                    "title": f"Decide on {c.name}",
                    "plain": f"{FIT_WORDS.get(c.fit, c.fit)}. Public reviews: {c.review_count}.",
                    "why": "Research is done. The next step is your judgment, not more software.",
                    "recommend": "Open → Approve for a note, or Skip.",
                    "action": "open",
                    "button": "Review",
                    "company_id": c.id,
                })
    order = {"red": 0, "yellow": 1, "green": 2}
    tasks.sort(key=lambda t: order.get(t["severity"], 9))
    return tasks[:20]


def home_status(companies: list, tasks: list) -> dict:
    red = [t for t in tasks if t["severity"] == "red"]
    yellow = [t for t in tasks if t["severity"] == "yellow"]
    won = [c for c in companies if c.stage == "Won"]
    if red:
        light, headline = "red", "Needs attention"
        blurb = f"{len(red)} item(s) broke or got blocked. Software stopped instead of guessing."
    elif yellow:
        light, headline = "yellow", "Needs your approval"
        blurb = f"{len(yellow)} thing(s) only you can decide. Press Start My Tasks."
    else:
        light, headline = "green", "Everything is good"
        blurb = "Nothing waiting on you. Find more companies when you’re ready."
    return {
        "light": light,
        "headline": headline,
        "blurb": blurb,
        "counts": {
            "good": max(0, len(companies) - len(red)),
            "approval": len(yellow),
            "attention": len(red),
            "calls": len([c for c in companies if c.stage == "Call Booked"]),
            "companies": len(companies),
            "won": len(won),
            "retainer_mrr": None,  # UNKNOWN until Delivery OS
        },
    }
