"""Seed public-research records only. Never mark real companies as DEMO."""
from app.db import SessionLocal, Base, engine
from app.models import Company, Contact, Activity, User, Score
from app.services.scoring import score_company
from app.auth import hash_password
from app.config import settings

PUBLIC = [
    dict(name="Firefighter Roofing", vertical="Roofing", website="https://firefighterroofing.com/",
         phone="(817) 479-8999", city="North Richland Hills", state="TX",
         google_rating="4.9", review_count=400, job_value_est=16000, years_in_business=10,
         google_ads_status="unknown", meta_ads_status="unknown",
         notes="Founder Philip Perdue published on company site. Ads status unknown until Ad Library/Places check.",
         contact_name="Philip Perdue", contact_title="Founder"),
    dict(name="Align Foundation Repair", vertical="Foundation repair", website="https://alignfoundationrepair.com/",
         phone="UNKNOWN", city="Dallas-Fort Worth", state="TX",
         google_rating="UNKNOWN", review_count=80, job_value_est=12000, years_in_business=8,
         google_ads_status="unknown", meta_ads_status="unknown",
         notes="Owners Jason and Josh Spector published on site.",
         contact_name="Jason Spector", contact_title="Owner"),
    dict(name="SOS Foundation Repair", vertical="Foundation repair", website="https://www.sosfoundationrepair.com/",
         phone="(469) 528-7452", city="Dallas-Fort Worth", state="TX",
         google_rating="UNKNOWN", review_count=60, job_value_est=11000, years_in_business=20,
         google_ads_status="unknown", meta_ads_status="unknown",
         notes="Public phone on homepage. Digital booking looked thin in a manual pass.",
         contact_name="", contact_title=""),
]

def run():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        if not db.query(User).filter_by(email=settings.admin_email).first():
            db.add(User(email=settings.admin_email, password_hash=hash_password(settings.admin_password)))
            db.commit()
        for row in PUBLIC:
            if db.query(Company).filter_by(name=row["name"]).first():
                continue
            c = Company(
                name=row["name"], vertical=row["vertical"], website=row["website"],
                domain=row["website"].split("//")[-1].split("/")[0].replace("www.", ""),
                phone="" if row["phone"] == "UNKNOWN" else row["phone"],
                city=row["city"], state=row["state"], google_rating="" if row["google_rating"]=="UNKNOWN" else row["google_rating"],
                review_count=row["review_count"], job_value_est=row["job_value_est"],
                years_in_business=row["years_in_business"], google_ads_status=row["google_ads_status"],
                meta_ads_status=row["meta_ads_status"], notes=row["notes"],
                source="public-research", is_demo=False, stage="Ready for Review",
                research_status="queued", initial_score=70,
            )
            db.add(c)
            db.flush()
            if row["contact_name"]:
                db.add(Contact(company_id=c.id, name=row["contact_name"], title=row["contact_title"],
                               source="company-website", confidence="published"))
            result = score_company(c)
            c.score = result["total"]
            c.fit = result["fit"]
            db.add(Score(company_id=c.id, total=result["total"], breakdown=result["breakdown"], why=result["why"]))
            db.add(Activity(company_id=c.id, kind="seed", detail="public-research import"))
        db.commit()
        print("Seeded public-research companies.")
    finally:
        db.close()

if __name__ == "__main__":
    run()
