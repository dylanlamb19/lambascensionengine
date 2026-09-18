"""Stage A — cheap qualification from discovery fields only."""

def initial_score(p: dict, min_rating: float, min_reviews: int) -> tuple[int, str]:
    reasons = []
    s = 0
    rating = None
    try:
        rating = float(p.get("google_rating")) if p.get("google_rating") not in (None, "", "UNKNOWN") else None
    except ValueError:
        rating = None
    reviews = int(p.get("review_count") or 0)
    site = p.get("website") not in (None, "", "UNKNOWN")
    phone = p.get("phone") not in (None, "", "UNKNOWN")

    if site:
        s += 18
        reasons.append("website present")
    else:
        reasons.append("no website in provider payload")

    if rating is not None and rating >= 4.6:
        s += 16
        reasons.append(f"rating {rating}")
    elif rating is not None and rating >= 4.0:
        s += 10
        reasons.append(f"rating {rating}")
    elif rating is None:
        reasons.append("rating UNKNOWN")

    if reviews >= 200:
        s += 16
        reasons.append(f"{reviews} reviews")
    elif reviews >= 50:
        s += 12
        reasons.append(f"{reviews} reviews")
    elif reviews >= 15:
        s += 8
        reasons.append(f"{reviews} reviews")

    if (p.get("job_value_est") or 0) >= 10000:
        s += 16
        reasons.append("vertical ticket estimate ≥ $10k (not verified revenue)")
    elif (p.get("job_value_est") or 0) >= 7000:
        s += 10
        reasons.append("vertical ticket estimate ≥ $7k (not verified revenue)")
    else:
        s += 6
        reasons.append("lower default ticket for this vertical (estimate)")

    if phone:
        s += 8
        reasons.append("public phone from provider")

    city = p.get("city") or ""
    if city and city != "UNKNOWN":
        s += 8
        reasons.append(f"market {city}")

    if rating is not None and rating < min_rating:
        s = min(s, 49)
        reasons.append("below requested min rating")
    if reviews < min_reviews:
        s = min(s, 49)
        reasons.append("below requested min reviews")

    return min(99, s), "; ".join(reasons)
