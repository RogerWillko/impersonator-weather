"""Read-only station log for public X accounts that score like Elon impersonators.

The script requests X's public people-search page for elon, musk, and maye.
It does not log in, send a message, follow, or post. A high score is appended
to counts.json. A page that comes back without accounts is a failed reading:
the previous log stays, and the raw HTML snippet goes to logs/failures/.

Pinned marks, as of the search shell X returns to a logged-out request:
  data-testid="UserCell"
  data-testid="User-Name"
  data-testid="UserDescription"
  data-testid="UserAvatar-Container-<handle>"
  JSON keys screen_name, followers_count, friends_count, description,
  profile_image_url_https, default_profile_image, created_at
A login wall is the final URL or body containing onboarding, /login,
or redirect_after_login. Zero cells on that wall is not a count of zero.
"""

from __future__ import annotations

import argparse
import json
import random
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CANONICAL_HANDLE = "elonmusk"
HIGH_SCORE = 4
TERMS = ("elon", "musk", "maye")
SEARCH = "https://x.com/search"
HOSTS = {"x.com", "twitter.com", "mobile.x.com", "mobile.twitter.com"}

POINTS = {
    "handle_one_off": 4,
    "young_account": 2,
    "follower_ratio": 1,
    "empty_bio": 1,
    "default_avatar": 2,
    "multi_company": 2,
    "three_companies": 3,
}

SCALE = {
    "active": [
        {"id": "clear", "label": "Clear", "at": 0},
        {"id": "breeze", "label": "Breeze", "at": 1},
        {"id": "wind", "label": "Wind", "at": 200},
        {"id": "squall", "label": "Squall", "at": 1000},
        {"id": "storm", "label": "Storm", "at": 5000},
        {"id": "whiteout", "label": "Whiteout", "at": 20000},
    ],
    "dormant": [
        {"id": "quiet", "label": "Quiet", "at": 0},
        {"id": "banked", "label": "Banked", "at": 10000},
        {"id": "deep", "label": "Deep", "at": 100000},
        {"id": "buried", "label": "Buried", "at": 1000000},
    ],
}

PUBLIC_KEYS = (
    "run",
    "attempted_at",
    "status",
    "reason",
    "active",
    "dormant",
    "unknown",
    "flagged",
    "seen",
    "added",
    "high_score",
    "scale",
    "accounts",
)

ACCOUNT_KEYS = (
    "handle",
    "score",
    "activity",
    "signals",
    "followers",
    "following",
    "created",
    "bio",
    "first_seen",
    "last_seen",
)

BANNED = {
    "html",
    "snippet",
    "cookie",
    "authorization",
    "token",
    "password",
    "email",
    "secret",
}

SAFE_PHRASES = (
    "parody",
    "fan account",
    "fan page",
    "not affiliated",
    "not the real",
    "not elon",
    "satire",
    "commentary account",
)

COMPANY_MARKS = (
    ("tesla", ("tesla",)),
    ("spacex", ("spacex", "space x")),
    ("xai", ("xai", "x.ai")),
    ("neuralink", ("neuralink",)),
    ("boring", ("boring company", "the boring company")),
)

THREE = ("tesla", "spacex", "xai")

USER_AGENTS = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:132.0) Gecko/20100101 Firefox/132.0",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0",
)

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
    "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}

HANDLE_RE = re.compile(r"^[A-Za-z0-9_]{1,15}$")
JOINED_RE = re.compile(r"Joined\s*([A-Za-z]+)\s*(\d{4})", re.I)
TWITTER_RE = re.compile(
    r"\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+\d{2}:\d{2}:\d{2}\s+[+-]\d{4}\s+(\d{4})",
    re.I,
)
COUNT_RE = {
    "followers": re.compile(r"([\d][\d,.]*)\s*([KMB])?\s+Followers\b", re.I),
    "following": re.compile(r"([\d][\d,.]*)\s*([KMB])?\s+Following\b", re.I),
}
NEXT_RE = re.compile(r'href="([^"]*cursor=[^"]*)"', re.I)


class Fetch:
    def __init__(self, url: str, status: int, html: str):
        self.url = url or ""
        self.status = status
        self.html = html or ""


def canonical_body(doc: dict) -> str:
    body = {key: doc.get(key) for key in PUBLIC_KEYS}
    return json.dumps(body, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def chain_hash(prev: str, doc: dict) -> str:
    text = (prev or "") + "\n" + canonical_body(doc)
    return sha256(text.encode("utf-8")).hexdigest()


def find_banned(node) -> list:
    found = []

    def walk(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if str(key).lower() in BANNED:
                    found.append(str(key))
                else:
                    walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(node)
    return found


def levenshtein(left: str, right: str, limit: int = 2) -> int:
    if left == right:
        return 0
    if abs(len(left) - len(right)) > limit:
        return limit + 1
    prev = list(range(len(right) + 1))
    for i, ca in enumerate(left, 1):
        cur = [i]
        row_min = i
        for j, cb in enumerate(right, 1):
            ins = cur[j - 1] + 1
            delete = prev[j] + 1
            sub = prev[j - 1] + (ca != cb)
            best = sub
            if ins < best:
                best = ins
            if delete < best:
                best = delete
            cur.append(best)
            if best < row_min:
                row_min = best
        if row_min > limit:
            return limit + 1
        prev = cur
    return prev[-1]


def clean_handle(value: str) -> str:
    text = (value or "").strip()
    if "/" in text:
        text = text.strip("/").split("/")[0].split("?")[0]
    text = text.lstrip("@")
    if HANDLE_RE.fullmatch(text or ""):
        return text
    return ""


def handle_one_off(handle: str) -> bool:
    folded = (handle or "").lower()
    if not folded or folded == CANONICAL_HANDLE:
        return False
    return levenshtein(folded, CANONICAL_HANDLE, 1) == 1


def parse_created(text: str, today: date) -> date | None:
    raw = (text or "").strip()
    if not raw:
        return None
    found = None
    iso = re.search(r"(\d{4})-(\d{2})-(\d{2})", raw)
    if iso:
        try:
            found = date(int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
        except ValueError:
            found = None
    if found is None:
        twitter = TWITTER_RE.search(raw)
        if twitter:
            month = MONTHS.get(twitter.group(1).lower())
            if month:
                try:
                    found = date(int(twitter.group(3)), month, int(twitter.group(2)))
                except ValueError:
                    found = None
    if found is None:
        joined = JOINED_RE.search(raw)
        if joined:
            month = MONTHS.get(joined.group(1).lower())
            year = int(joined.group(2))
            if month:
                try:
                    found = date(year, month, 1)
                except ValueError:
                    found = None
    if found is None or found > today:
        return None
    return found


def parse_count(text: str, kind: str):
    match = COUNT_RE[kind].search(text or "")
    if not match:
        return None
    number = match.group(1).replace(",", "")
    try:
        value = float(number)
    except ValueError:
        return None
    suffix = (match.group(2) or "").upper()
    value *= {"K": 1000, "M": 1000000, "B": 1000000000}.get(suffix, 1)
    if value < 0:
        return None
    return int(value)


def ratio_over_three(followers, following) -> bool:
    if followers is None or following is None or followers <= 0:
        return False
    if following <= 0:
        return True
    return (followers / following) > 3


def company_names(bio: str) -> list:
    text = (bio or "").lower()
    found = []
    for name, marks in COMPANY_MARKS:
        if any(mark in text for mark in marks):
            found.append(name)
    return found


def is_default_avatar(url: str) -> bool:
    folded = (url or "").lower()
    return "default_profile" in folded


def is_safe_bio(bio: str) -> bool:
    folded = (bio or "").lower()
    return any(phrase in folded for phrase in SAFE_PHRASES)


def is_allowed(handle: str, allowlist: set) -> bool:
    return (handle or "").lower() in allowlist or (handle or "").lower() == CANONICAL_HANDLE


def young_account(created: date | None, today: date) -> bool:
    if created is None:
        return False
    return (today - created).days < 90


def activity_of(created: date | None, today: date) -> str:
    if created is None:
        return "unknown"
    if (today - created).days < 90:
        return "active"
    return "dormant"


def score_account(account: dict, today: date, allowlist: set):
    """Return a public row, or None when the account is kept off the log."""
    handle = clean_handle(account.get("handle") or "")
    if not handle or is_allowed(handle, allowlist):
        return None
    bio = (account.get("bio") or "").strip()
    if account.get("bio_seen") and is_safe_bio(bio):
        return None
    signals = []
    if handle_one_off(handle):
        signals.append("handle_one_off")
    created = account.get("created")
    if isinstance(created, str):
        created = parse_created(created, today)
    if young_account(created, today):
        signals.append("young_account")
    if ratio_over_three(account.get("followers"), account.get("following")):
        signals.append("follower_ratio")
    if account.get("bio_seen") and bio == "":
        signals.append("empty_bio")
    if account.get("avatar_seen") and is_default_avatar(account.get("avatar") or ""):
        signals.append("default_avatar")
    companies = company_names(bio) if account.get("bio_seen") else []
    if all(name in companies for name in THREE):
        signals.append("three_companies")
    elif len(companies) >= 2:
        signals.append("multi_company")
    total = sum(POINTS[name] for name in signals)
    if total < HIGH_SCORE:
        return None
    created_text = created.isoformat() if isinstance(created, date) else None
    return {
        "handle": handle,
        "score": total,
        "activity": activity_of(created, today),
        "signals": signals,
        "followers": account.get("followers"),
        "following": account.get("following"),
        "created": created_text,
        "bio": bio[:160],
        "first_seen": "",
        "last_seen": "",
    }


class SearchPage(HTMLParser):
    """Pull user cells from the pinned data-testid marks."""

    VOID = {"img", "br", "hr", "meta", "link", "input", "source", "wbr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.cells = []
        self.depth = 0
        self.skip_until = 0
        self.cell = None
        self.cell_depth = 0
        self.capture = None
        self.capture_depth = 0
        self.capture_buf = []

    def handle_starttag(self, tag, attrs):
        self.depth += 1
        try:
            self._start(tag, attrs)
        finally:
            if tag in self.VOID:
                self.depth -= 1

    def _start(self, tag, attrs):
        if tag in ("script", "style"):
            self.skip_until = self.depth
            return
        if self.skip_until:
            return
        ad = {key: value or "" for key, value in attrs}
        testid = ad.get("data-testid") or ""
        if testid == "UserCell":
            self._close_cell()
            self.cell = {
                "handle": "",
                "name": [],
                "bio": [],
                "bio_seen": False,
                "avatar": "",
                "avatar_seen": False,
                "text": [],
            }
            self.cell_depth = self.depth
        if self.cell is None:
            return
        self.cell["text"].append(" ")
        if testid == "User-Name":
            self._flush()
            self.capture = "name"
            self.capture_depth = self.depth
        elif testid == "UserDescription":
            self._flush()
            self.capture = "bio"
            self.capture_depth = self.depth
            self.cell["bio_seen"] = True
        elif testid.startswith("UserAvatar-Container-"):
            self.cell["handle"] = testid[len("UserAvatar-Container-"):]
        if tag == "img":
            src = ad.get("src") or ""
            if src:
                self.cell["avatar"] = src
                self.cell["avatar_seen"] = True
        if tag == "a" and not self.cell["handle"]:
            href = ad.get("href") or ""
            if href.startswith("/") and href.count("/") == 1:
                self.cell["handle"] = href[1:]

    def handle_endtag(self, tag):
        if tag in self.VOID:
            return
        if self.skip_until and self.depth == self.skip_until:
            self.skip_until = 0
        if self.capture and self.depth == self.capture_depth:
            self._flush()
        if self.cell is not None and self.depth == self.cell_depth:
            self._close_cell()
        self.depth = max(0, self.depth - 1)

    def handle_data(self, data):
        if self.skip_until or not data:
            return
        if self.capture:
            self.capture_buf.append(data)
        if self.cell is not None:
            self.cell["text"].append(data)

    def close(self):
        super().close()
        self._close_cell()

    def _flush(self):
        if self.cell is not None and self.capture:
            self.cell[self.capture].append("".join(self.capture_buf))
        self.capture = None
        self.capture_buf = []

    def _close_cell(self):
        self._flush()
        if self.cell is not None:
            self.cells.append(self.cell)
        self.cell = None


def accounts_from_html(html: str, today: date) -> list:
    parser = SearchPage()
    try:
        parser.feed(html or "")
        parser.close()
    except Exception:
        return accounts_from_json(html, today)
    rows = []
    for cell in parser.cells:
        text = "".join(cell["text"])
        handle = clean_handle(cell["handle"])
        if not handle:
            mention = re.search(r"@([A-Za-z0-9_]{1,15})", "".join(cell["name"]))
            handle = mention.group(1) if mention else ""
        created = parse_created(text, today)
        rows.append({
            "handle": handle,
            "bio": " ".join(part.strip() for part in cell["bio"]).strip(),
            "bio_seen": cell["bio_seen"],
            "avatar": cell["avatar"],
            "avatar_seen": cell["avatar_seen"],
            "followers": parse_count(text, "followers"),
            "following": parse_count(text, "following"),
            "created": created,
        })
    if rows:
        return rows
    return accounts_from_json(html, today)


def accounts_from_json(html: str, today: date) -> list:
    if '"screen_name"' not in (html or ""):
        return []
    decoder = json.JSONDecoder()
    found = []
    index = 0
    hops = 0
    while hops < 4000 and len(found) < 40:
        start = html.find("{", index)
        if start < 0:
            break
        hops += 1
        try:
            obj, end = decoder.raw_decode(html[start:])
        except json.JSONDecodeError:
            index = start + 1
            continue
        index = start + max(end, 1)
        if not isinstance(obj, dict) or "screen_name" not in obj:
            continue
        if not any(key in obj for key in (
            "followers_count", "description", "profile_image_url_https", "default_profile_image"
        )):
            continue
        handle = clean_handle(str(obj.get("screen_name") or ""))
        if not handle:
            continue
        avatar = str(obj.get("profile_image_url_https") or obj.get("profile_image_url") or "")
        avatar_seen = any(key in obj for key in (
            "profile_image_url_https", "profile_image_url", "default_profile_image"
        ))
        if obj.get("default_profile_image") is True:
            avatar_seen = True
            avatar = avatar or "default_profile"
        created = parse_created(str(obj.get("created_at") or ""), today)
        followers = obj.get("followers_count")
        following = obj.get("friends_count")
        found.append({
            "handle": handle,
            "bio": str(obj.get("description") or "").strip() if "description" in obj else "",
            "bio_seen": "description" in obj,
            "avatar": avatar,
            "avatar_seen": avatar_seen,
            "followers": followers if isinstance(followers, int) else None,
            "following": following if isinstance(following, int) else None,
            "created": created,
        })
    return found


def classify_page(final_url: str, status: int, html: str, accounts: list) -> str:
    if status in (403, 429):
        return "blocked"
    if status == 0 or status >= 500:
        return "network"
    if accounts:
        return "ok"
    blob = ((final_url or "") + "\n" + (html or "")).lower()
    if "onboarding" in blob or "redirect_after_login" in blob or "/login" in blob or "mode=login" in blob:
        return "login_wall"
    return "markup_moved"


def next_page_url(html: str) -> str:
    match = NEXT_RE.search(html or "")
    if not match:
        return ""
    href = match.group(1).replace("&amp;", "&")
    absolute = urllib.parse.urljoin("https://x.com", href)
    host = (urllib.parse.urlparse(absolute).hostname or "").lower()
    if host not in HOSTS and not host.endswith(".x.com") and not host.endswith(".twitter.com"):
        return ""
    if "cursor=" not in absolute:
        return ""
    return absolute


def search_url(term: str) -> str:
    query = urllib.parse.urlencode({"q": term, "src": "typed_query", "f": "user"})
    return SEARCH + "?" + query


def had_reading(doc: dict | None) -> bool:
    return bool(doc) and doc.get("active") is not None


def blank_counts() -> dict:
    return {"active": None, "dormant": None, "unknown": None, "flagged": None}


def recount(accounts: list) -> dict:
    return {
        "active": sum(1 for row in accounts if row.get("activity") == "active"),
        "dormant": sum(1 for row in accounts if row.get("activity") == "dormant"),
        "unknown": sum(1 for row in accounts if row.get("activity") == "unknown"),
        "flagged": len(accounts),
    }


def clean_account(row: dict) -> dict | None:
    if not isinstance(row, dict):
        return None
    handle = clean_handle(str(row.get("handle") or ""))
    if not handle:
        return None
    signals = [name for name in (row.get("signals") or []) if name in POINTS]
    activity = row.get("activity")
    if activity not in ("active", "dormant", "unknown"):
        activity = "unknown"
    followers = row.get("followers")
    following = row.get("following")
    return {
        "handle": handle,
        "score": int(row.get("score") or 0),
        "activity": activity,
        "signals": signals,
        "followers": followers if isinstance(followers, int) else None,
        "following": following if isinstance(following, int) else None,
        "created": row.get("created") if isinstance(row.get("created"), str) else None,
        "bio": str(row.get("bio") or "")[:160],
        "first_seen": str(row.get("first_seen") or ""),
        "last_seen": str(row.get("last_seen") or ""),
    }


def previous_accounts(doc: dict | None) -> list:
    if not doc:
        return []
    rows = []
    for item in doc.get("accounts") or []:
        clean = clean_account(item)
        if clean:
            rows.append(clean)
    return rows


def merge_accounts(previous: list, fresh: list, now_iso: str) -> tuple:
    by_handle = {row["handle"].lower(): dict(row) for row in previous}
    added = 0
    for row in fresh:
        key = row["handle"].lower()
        old = by_handle.get(key)
        if old is None:
            item = dict(row)
            item["first_seen"] = now_iso
            item["last_seen"] = now_iso
            by_handle[key] = item
            added += 1
            continue
        if row["score"] >= old.get("score", 0):
            old["score"] = row["score"]
            old["signals"] = row["signals"]
        old["activity"] = row["activity"]
        old["followers"] = row["followers"]
        old["following"] = row["following"]
        old["created"] = row["created"]
        old["bio"] = row["bio"]
        old["last_seen"] = now_iso
        if not old.get("first_seen"):
            old["first_seen"] = now_iso
    rows = list(by_handle.values())
    rows.sort(key=lambda item: (-int(item.get("score") or 0), item["handle"].lower()))
    return rows, added


def assemble(fields: dict, prev_chain: str) -> dict:
    doc = {key: fields.get(key) for key in PUBLIC_KEYS}
    banned = find_banned(doc)
    if banned:
        raise RuntimeError("counts.json tried to carry private fields: " + ", ".join(banned))
    doc["chain"] = chain_hash(prev_chain, doc)
    return doc


def dump_doc(doc: dict) -> str:
    ordered_accounts = []
    for item in doc.get("accounts") or []:
        ordered_accounts.append({key: item.get(key) for key in ACCOUNT_KEYS})
    body = {key: doc.get(key) for key in PUBLIC_KEYS}
    body["accounts"] = ordered_accounts
    body["chain"] = doc.get("chain")
    return json.dumps(body, indent=2, ensure_ascii=False) + "\n"


def failure_priority(reasons: list) -> str:
    for name in ("login_wall", "blocked", "markup_moved", "network"):
        if name in reasons:
            return name
    return reasons[0] if reasons else "network"


def run_sweep(previous, allowlist, fetch, today: date, now_iso: str, sleep, next_pause) -> tuple:
    """Fetch the public pages and return (doc, log_text or None)."""
    parsed = []
    seen_handles = set()
    reasons = []
    logs = []
    requests = 0
    for term in TERMS:
        if any(reason == "login_wall" for reason in reasons):
            break
        urls = [search_url(term)]
        page_index = 0
        while urls and page_index < 2 and requests < 8:
            url = urls.pop(0)
            page_index += 1
            requests += 1
            wait = float(next_pause() or 0)
            if wait:
                sleep(wait)
            try:
                result = fetch(url)
            except Exception as exc:
                reasons.append("network")
                logs.append("network " + url + " " + type(exc).__name__)
                continue
            accounts = accounts_from_html(result.html, today) if result.status == 200 else []
            kind = classify_page(result.url, result.status, result.html, accounts)
            if kind != "ok":
                reasons.append(kind)
                logs.append(snippet_log(kind, result))
                if kind == "login_wall":
                    break
                continue
            for account in accounts:
                key = (account.get("handle") or "").lower()
                if not key or key in seen_handles:
                    continue
                seen_handles.add(key)
                parsed.append(account)
            if page_index == 1:
                nxt = next_page_url(result.html)
                if nxt:
                    urls.append(nxt)
    prev_chain = (previous or {}).get("chain") or ""
    kept = previous_accounts(previous)
    if parsed:
        fresh = []
        for account in parsed:
            row = score_account(account, today, allowlist)
            if row:
                fresh.append(row)
        merged, added = merge_accounts(kept, fresh, now_iso)
        fields = {
            "run": now_iso,
            "attempted_at": now_iso,
            "status": "ok",
            "reason": None,
            "seen": len(parsed),
            "added": added,
            "high_score": HIGH_SCORE,
            "scale": SCALE,
            "accounts": merged,
        }
        fields.update(recount(merged))
        partial = "\n\n".join(logs) if logs else None
        return assemble(fields, prev_chain), partial
    reason = failure_priority(reasons or ["network"])
    if had_reading(previous):
        fields = {
            "run": previous.get("run"),
            "attempted_at": now_iso,
            "status": "held",
            "reason": reason,
            "active": previous.get("active"),
            "dormant": previous.get("dormant"),
            "unknown": previous.get("unknown"),
            "flagged": previous.get("flagged"),
            "seen": previous.get("seen"),
            "added": 0,
            "high_score": HIGH_SCORE,
            "scale": SCALE,
            "accounts": kept,
        }
    else:
        fields = {
            "run": None,
            "attempted_at": now_iso,
            "status": "held",
            "reason": reason,
            "seen": None,
            "added": 0,
            "high_score": HIGH_SCORE,
            "scale": SCALE,
            "accounts": [],
        }
        fields.update(blank_counts())
    log = "\n\n".join(logs) if logs else reason
    return assemble(fields, prev_chain), log


def snippet_log(kind: str, result: Fetch) -> str:
    html = result.html or ""
    piece = html[:4000]
    return "\n".join([
        "reason: " + kind,
        "status: " + str(result.status),
        "url: " + (result.url or ""),
        "---",
        piece,
    ])


def load_allowlist(path: Path) -> set:
    found = {CANONICAL_HANDLE}
    if not path.exists():
        return found
    for line in path.read_text(encoding="utf-8").splitlines():
        handle = clean_handle(line.split("#", 1)[0])
        if handle:
            found.add(handle.lower())
    return found


def load_doc(path: Path):
    if not path.exists():
        return None
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise RuntimeError("counts.json is not a document")
    return data


def write_doc(path: Path, doc: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(dump_doc(doc), encoding="utf-8")
    tmp.replace(path)


def write_failure(log_dir: Path, now_iso: str, reason: str, text: str) -> Path:
    log_dir.mkdir(parents=True, exist_ok=True)
    stamp = now_iso.replace(":", "").replace("-", "")
    path = log_dir / (stamp + "-" + reason + ".txt")
    path.write_text(text, encoding="utf-8")
    return path


class StayOnX(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        host = (urllib.parse.urlparse(newurl).hostname or "").lower()
        allowed = host in HOSTS or host.endswith(".x.com") or host.endswith(".twitter.com")
        if not allowed:
            raise urllib.error.HTTPError(req.full_url, code, "redirect left X", headers, fp)
        return urllib.request.HTTPRedirectHandler.redirect_request(self, req, fp, code, msg, headers, newurl)


def live_fetch(url: str) -> Fetch:
    agent = random.choice(USER_AGENTS)
    request = urllib.request.Request(url, headers={
        "User-Agent": agent,
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en",
    })
    opener = urllib.request.build_opener(StayOnX)
    try:
        with opener.open(request, timeout=25) as response:
            raw = response.read(2_000_000)
            status = getattr(response, "status", 200)
            return Fetch(response.geturl(), status, raw.decode("utf-8", "replace"))
    except urllib.error.HTTPError as err:
        body = err.read(8000).decode("utf-8", "replace")
        return Fetch(getattr(err, "url", url) or url, err.code, body)


def iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def pause_seconds(pause) -> float:
    if pause is None:
        return random.uniform(4.0, 12.0)
    return max(0.0, float(pause))


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description="Log public accounts that score like Elon impersonators.")
    parser.add_argument("--counts", type=Path, default=ROOT / "counts.json")
    parser.add_argument("--allowlist", type=Path, default=ROOT / "allowlist.txt")
    parser.add_argument("--html", type=Path, default=None, help="Score a saved search page. No network.")
    parser.add_argument("--pause", type=float, default=None, help="Seconds between requests. Default is a random 4 to 12. 0 skips the wait.")
    args = parser.parse_args(argv)
    previous = load_doc(args.counts)
    allowlist = load_allowlist(args.allowlist)
    today = datetime.now(timezone.utc).date()
    now_iso = iso_now()
    if args.html:
        html = args.html.read_text(encoding="utf-8", errors="replace")

        def fetch(_url: str) -> Fetch:
            return Fetch("file://" + str(args.html), 200, html)

        def sleep(_seconds: float) -> None:
            return None

        doc, log = run_sweep(previous, allowlist, fetch, today, now_iso, sleep, lambda: 0)
    else:
        def sleep(seconds: float) -> None:
            if seconds:
                import time
                time.sleep(seconds)

        def next_pause() -> float:
            return pause_seconds(args.pause)

        doc, log = run_sweep(previous, allowlist, live_fetch, today, now_iso, sleep, next_pause)
    write_doc(args.counts, doc)
    if log:
        path = write_failure(ROOT / "logs" / "failures", now_iso, doc.get("reason") or "partial", log)
        print("log " + str(path))
    if doc.get("status") == "ok":
        print("OK active " + str(doc.get("active")) + " dormant " + str(doc.get("dormant")) + " added " + str(doc.get("added")))
    else:
        print("HELD " + str(doc.get("reason")))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as exc:
        print(str(exc), file=sys.stderr)
        sys.exit(1)
