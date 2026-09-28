"""The station log. A failed page must not become a count of zero."""

import json
import sys
import tempfile
import unittest
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import station

TODAY = date(2026, 9, 28)
NOW = "2026-09-28T08:40:00Z"
ROOT = Path(__file__).resolve().parents[1]


def fields(**overrides):
    base = {
        "run": NOW,
        "attempted_at": NOW,
        "status": "ok",
        "reason": None,
        "active": 0,
        "dormant": 0,
        "unknown": 0,
        "flagged": 0,
        "seen": 0,
        "added": 0,
        "high_score": station.HIGH_SCORE,
        "scale": station.SCALE,
        "accounts": [],
    }
    base.update(overrides)
    return base


def row(**overrides):
    base = {
        "handle": "el0nmusk",
        "bio": "",
        "bio_seen": True,
        "avatar": "https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png",
        "avatar_seen": True,
        "followers": 12,
        "following": 1,
        "created": date(2026, 8, 1),
    }
    base.update(overrides)
    return base


class ScoreTests(unittest.TestCase):
    def test_one_character_off(self):
        self.assertFalse(station.handle_one_off("elonmusk"))
        self.assertTrue(station.handle_one_off("el0nmusk"))
        self.assertTrue(station.handle_one_off("elonmusk1"))
        self.assertTrue(station.handle_one_off("elon_musk"))
        self.assertFalse(station.handle_one_off("elonmuskofficial"))
        self.assertFalse(station.handle_one_off("elon"))

    def test_young_boundary_is_under_ninety_days(self):
        self.assertTrue(station.young_account(TODAY.fromordinal(TODAY.toordinal() - 89), TODAY))
        self.assertFalse(station.young_account(TODAY.fromordinal(TODAY.toordinal() - 90), TODAY))
        self.assertFalse(station.young_account(None, TODAY))

    def test_ratio_is_strictly_over_three(self):
        self.assertFalse(station.ratio_over_three(3, 1))
        self.assertTrue(station.ratio_over_three(4, 1))
        self.assertTrue(station.ratio_over_three(5, 0))
        self.assertFalse(station.ratio_over_three(0, 0))
        self.assertFalse(station.ratio_over_three(None, 1))

    def test_three_companies_are_not_two_and_boring_day_is_not_a_company(self):
        self.assertEqual(station.company_names("Tesla and SpaceX"), ["tesla", "spacex"])
        self.assertEqual(station.company_names("Tesla, SpaceX, and x.ai"), ["tesla", "spacex", "xai"])
        self.assertEqual(station.company_names("a boring day with tesla"), ["tesla"])
        self.assertIn("boring", station.company_names("I run the boring company and Tesla"))

    def test_high_score_flags_a_new_blank_lookalike(self):
        scored = station.score_account(row(), TODAY, {"elonmusk"})
        self.assertEqual(scored["handle"], "el0nmusk")
        self.assertGreaterEqual(scored["score"], station.HIGH_SCORE)
        self.assertEqual(scored["activity"], "active")
        self.assertIn("handle_one_off", scored["signals"])
        self.assertIn("default_avatar", scored["signals"])

    def test_real_handle_and_allowlist_and_parody_stay_off(self):
        self.assertIsNone(station.score_account(row(handle="elonmusk"), TODAY, set()))
        self.assertIsNone(station.score_account(row(), TODAY, {"el0nmusk"}))
        parody = row(bio="A parody account. Not the real one.")
        self.assertIsNone(station.score_account(parody, TODAY, set()))

    def test_low_score_person_is_not_flagged(self):
        quiet = row(
            handle="rocketfan",
            bio="I like rockets and photographs.",
            avatar="https://pbs.twimg.com/profile_images/custom.jpg",
            followers=2,
            following=50,
            created=date(2020, 1, 1),
        )
        self.assertIsNone(station.score_account(quiet, TODAY, {"elonmusk"}))

    def test_old_multi_company_account_is_dormant(self):
        scored = station.score_account(row(
            handle="muskfan42",
            bio="Tesla SpaceX xAI founder",
            avatar="https://pbs.twimg.com/profile_images/custom.jpg",
            followers=100,
            following=10,
            created=date(2020, 1, 1),
        ), TODAY, {"elonmusk"})
        self.assertEqual(scored["activity"], "dormant")
        self.assertIn("three_companies", scored["signals"])
        self.assertGreaterEqual(scored["score"], station.HIGH_SCORE)


class PageTests(unittest.TestCase):
    def test_html_cells_keep_an_unclosed_image(self):
        html = """
        <div data-testid="UserCell">
          <div data-testid="UserAvatar-Container-el0nmusk">
            <img src="https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png">
          </div>
          <div data-testid="User-Name">Elon Musk @el0nmusk</div>
          <div data-testid="UserDescription"></div>
          <span>12 Followers</span><span>1 Following</span>
          <span>Joined August 2026</span>
        </div>
        <div data-testid="UserCell">
          <a href="/mayemusk">Maye</a>
          <div data-testid="UserAvatar-Container-mayemusk">
            <img src="https://pbs.twimg.com/profile_images/real.jpg">
          </div>
          <div data-testid="User-Name">Maye Musk @mayemusk</div>
          <div data-testid="UserDescription">Model and dietitian</div>
        </div>
        """
        accounts = station.accounts_from_html(html, TODAY)
        self.assertEqual([item["handle"] for item in accounts], ["el0nmusk", "mayemusk"])
        self.assertTrue(accounts[0]["bio_seen"])
        self.assertEqual(accounts[0]["bio"], "")
        self.assertEqual(accounts[0]["followers"], 12)
        self.assertEqual(accounts[0]["following"], 1)
        self.assertEqual(accounts[0]["created"], date(2026, 8, 1))
        self.assertTrue(station.is_default_avatar(accounts[0]["avatar"]))

    def test_json_blob_is_the_fallback_when_there_are_no_cells(self):
        html = """<html><script>{"screen_name":"el0nmusk","followers_count":10,"friends_count":1,"description":"","profile_image_url_https":"https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png","default_profile_image":true,"created_at":"Wed Aug 12 00:00:00 +0000 2026"}</script></html>"""
        accounts = station.accounts_from_html(html, TODAY)
        self.assertEqual(accounts[0]["handle"], "el0nmusk")
        self.assertEqual(accounts[0]["created"], date(2026, 8, 12))
        self.assertTrue(accounts[0]["avatar_seen"])

    def test_login_wall_is_not_a_zero_count(self):
        previous = station.assemble(fields(
            active=4, dormant=9, unknown=0, flagged=13, seen=20, added=4,
            accounts=[{
                "handle": "el0nmusk", "score": 8, "activity": "active",
                "signals": ["handle_one_off"], "followers": 3, "following": 0,
                "created": "2026-08-01", "bio": "", "first_seen": NOW, "last_seen": NOW,
            }],
        ), "")

        def fetch(_url):
            return station.Fetch(
                "https://x.com/i/jf/onboarding/web?redirect_after_login=%2Fsearch&mode=login",
                200,
                "<html>ijfonboardingweb</html>",
            )

        calls = {"n": 0}

        def counting(url):
            calls["n"] += 1
            return fetch(url)

        doc, log = station.run_sweep(previous, {"elonmusk"}, counting, TODAY, "2026-09-29T08:10:00Z", lambda _s: None, lambda: 0)
        self.assertEqual(calls["n"], 1)
        self.assertEqual(doc["status"], "held")
        self.assertEqual(doc["reason"], "login_wall")
        self.assertEqual(doc["active"], 4)
        self.assertEqual(doc["dormant"], 9)
        self.assertEqual(doc["accounts"][0]["handle"], "el0nmusk")
        self.assertIn("ijfonboardingweb", log)
        self.assertEqual(doc["run"], NOW)

    def test_missing_marks_are_not_a_zero_count(self):
        previous = station.assemble(fields(active=5, dormant=1, unknown=0, flagged=6), "")

        def fetch(_url):
            return station.Fetch("https://x.com/search?q=elon&f=user", 200, "<html><title>X</title><div id='root'></div></html>")

        doc, log = station.run_sweep(previous, {"elonmusk"}, fetch, TODAY, "2026-09-29T08:10:00Z", lambda _s: None, lambda: 0)
        self.assertEqual(doc["reason"], "markup_moved")
        self.assertEqual(doc["active"], 5)
        self.assertNotIn('"active": 0', json.dumps(doc))
        self.assertIn("root", log)

    def test_a_parsed_page_with_nobody_high_is_a_real_clear_reading(self):
        html = """
        <div data-testid="UserCell">
          <a href="/rocketfan"></a>
          <div data-testid="User-Name">@rocketfan</div>
          <div data-testid="UserDescription">I like rockets and photographs.</div>
          <img src="https://pbs.twimg.com/profile_images/custom.jpg">
          <span>Joined January 2020</span>
          <span>2 Followers</span><span>50 Following</span>
        </div>
        """

        def fetch(_url):
            return station.Fetch("https://x.com/search?q=elon&f=user", 200, html)

        doc, log = station.run_sweep(None, {"elonmusk", "mayemusk"}, fetch, TODAY, NOW, lambda _s: None, lambda: 0)
        self.assertEqual(doc["status"], "ok")
        self.assertIsNone(doc["reason"])
        self.assertEqual(doc["active"], 0)
        self.assertEqual(doc["flagged"], 0)
        self.assertEqual(doc["seen"], 1)
        self.assertIsNone(log)

    def test_append_keeps_a_handle_that_is_absent_tonight(self):
        previous = station.assemble(fields(
            active=1, dormant=0, unknown=0, flagged=1,
            accounts=[{
                "handle": "keptone", "score": 6, "activity": "active",
                "signals": ["handle_one_off"], "followers": 1, "following": 0,
                "created": "2026-08-01", "bio": "", "first_seen": "2026-09-01T00:00:00Z", "last_seen": "2026-09-01T00:00:00Z",
            }],
        ), "")
        html = """
        <div data-testid="UserCell">
          <div data-testid="UserAvatar-Container-elonmusk1">
            <img src="https://abs.twimg.com/sticky/default_profile_images/default_profile_normal.png">
          </div>
          <div data-testid="User-Name">@elonmusk1</div>
          <div data-testid="UserDescription"></div>
          <span>Joined September 2026</span>
        </div>
        """

        def fetch(_url):
            return station.Fetch("https://x.com/search?q=elon&f=user", 200, html)

        doc, _log = station.run_sweep(previous, {"elonmusk"}, fetch, TODAY, NOW, lambda _s: None, lambda: 0)
        handles = [item["handle"] for item in doc["accounts"]]
        self.assertEqual(handles, ["elonmusk1", "keptone"])
        self.assertEqual(doc["added"], 1)
        self.assertEqual(doc["flagged"], 2)

    def test_chain_moves_when_the_body_changes_and_ignores_itself(self):
        first = station.assemble(fields(active=1, flagged=1), "")
        second = station.assemble(fields(active=2, flagged=2), first["chain"])
        self.assertNotEqual(first["chain"], second["chain"])
        again = dict(second)
        again["chain"] = "nope"
        self.assertEqual(station.chain_hash(first["chain"], second), station.chain_hash(first["chain"], again))
        stable = station.assemble(fields(active=1, flagged=1), "")
        self.assertEqual(first["chain"], stable["chain"])

    def test_private_fields_are_refused(self):
        with self.assertRaises(RuntimeError):
            station.assemble(fields(accounts=[{"handle": "el0nmusk", "token": "nope"}]), "")

    def test_cli_saved_page_does_not_wipe_a_log(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            html_path = folder / "wall.html"
            html_path.write_text("<html>ijfonboardingweb</html>", encoding="utf-8")
            counts = folder / "counts.json"
            previous = station.assemble(fields(active=3, dormant=8, unknown=0, flagged=11), "")
            counts.write_text(station.dump_doc(previous), encoding="utf-8")
            code = station.main(["--html", str(html_path), "--counts", str(counts), "--allowlist", str(ROOT / "allowlist.txt")])
            self.assertEqual(code, 0)
            doc = json.loads(counts.read_text(encoding="utf-8"))
            self.assertEqual(doc["status"], "held")
            self.assertEqual(doc["reason"], "login_wall")
            self.assertEqual(doc["active"], 3)
            self.assertEqual(doc["dormant"], 8)


class PageCopyTests(unittest.TestCase):
    def test_the_gauge_uses_the_same_weather_marks(self):
        js = (ROOT / "site" / "assets" / "gauge.js").read_text(encoding="utf-8")
        for band in station.SCALE["active"] + station.SCALE["dormant"]:
            self.assertIn(band["label"], js)
            self.assertIn(str(band["at"]), js)
            self.assertIn(band["id"], js)

    def test_published_inputs_are_on_the_page_and_in_the_source_file(self):
        page = (ROOT / "site" / "compare.html").read_text(encoding="utf-8")
        raw = (ROOT / "site" / "sources.json").read_text(encoding="utf-8")
        needles = (
            "70.23",
            "93452093",
            "26878729",
            "23.42",
            "62500641",
            "65312713",
            "38035372",
            "153209283",
            "8555",
            "44058",
            "19.42",
            "https://gist.github.com/travisbrown/82de45bccd760032635ebef7bfeb4d83",
            "https://x.com/JRAzeltine/status/2075999787631984999",
            "https://sparktoro.com/blog/sparktoro-followerwonk-joint-twitter-analysis-19-42-of-active-accounts-are-fake-or-spam/",
            "1000",
            "4999",
            "10000",
            "999999",
        )
        for needle in needles:
            self.assertIn(needle, page)
            self.assertIn(needle, raw)
        self.assertNotIn("2847", page)
        self.assertNotIn("2,847", page)
        self.assertNotIn("2847", raw)
        index = (ROOT / "site" / "index.html").read_text(encoding="utf-8")
        self.assertIn("compare.html", index)
        for needle in (
            "https://github.com/RogerWillko/impersonator-weather",
            "A public weather gauge for accounts that score like Elon impersonators. Read only.",
            "site/compare.html",
            "https://raw.githubusercontent.com/RogerWillko/impersonator-weather/main/counts.json",
        ):
            self.assertIn(needle, page)

    def test_products_are_the_published_percent_times_the_published_base(self):
        doc = json.loads((ROOT / "site" / "sources.json").read_text(encoding="utf-8"))
        spark = next(item for item in doc["sources"] if item["id"] == "sparktoro")
        page = (ROOT / "site" / "compare.html").read_text(encoding="utf-8")

        def product(base, percent):
            whole, frac = str(percent).split(".")
            digits = int(whole + frac)
            den = (10 ** len(frac)) * 100
            return (base * digits + den // 2) // den

        primary = product(spark["followers"], spark["unlikely_authentic_active_percent"])
        secondary = product(spark["tweeted_in_90_days"], spark["fake_or_spam_among_those_percent"])
        self.assertEqual(primary, 65631405)
        self.assertEqual(secondary, 6294998)
        self.assertIn(str(primary), page)
        self.assertIn(str(secondary), page)
        self.assertIn("65631405", page)
        jamazel = next(item for item in doc["sources"] if item["id"] == "jamazel")
        self.assertEqual(jamazel["active_low"], 1000)
        self.assertEqual(jamazel["active_high"], 4999)
        self.assertEqual(jamazel["dormant_low"], 10000)
        self.assertEqual(jamazel["dormant_high"], 999999)

    def test_compare_script_uses_the_station_scale_and_skips_the_specimen(self):
        js = (ROOT / "site" / "assets" / "compare.js").read_text(encoding="utf-8")
        for band in station.SCALE["active"] + station.SCALE["dormant"]:
            self.assertIn(band["label"], js)
            self.assertIn(str(band["at"]), js)
            self.assertIn(band["id"], js)
        self.assertIn("halfUp", js)
        self.assertNotIn("2847", js)
        self.assertNotIn("localStorage", js)
        self.assertNotIn("sessionStorage", js)
        self.assertNotIn("cookie", js.lower())


if __name__ == "__main__":
    unittest.main()
