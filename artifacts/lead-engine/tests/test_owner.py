import unittest
from types import SimpleNamespace
from app.services.owner import build_tasks, explain, friendly_error, home_status

class OwnerTests(unittest.TestCase):
    def test_empty_asks_to_find(self):
        t = build_tasks([])
        self.assertEqual(t[0]["action"], "find")
        self.assertEqual(home_status([], t)["light"], "yellow")

    def test_failed_is_red(self):
        c = SimpleNamespace(id=1, name="Acme", website="https://x.com", research_status="blocked",
                            stage="Researching", fit="strong", review_count=10)
        t = build_tasks([c])
        self.assertTrue(any(x["severity"]=="red" for x in t))
        self.assertEqual(home_status([c], t)["light"], "red")

    def test_explain_not_empty(self):
        self.assertIn("Pixel", explain("pixel"))

    def test_friendly_disabled(self):
        f = friendly_error("disabled")
        self.assertTrue(f["press"])
        self.assertIn("turned off", f["happened"].lower() + f["press"].lower() or "off")
