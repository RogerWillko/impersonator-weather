# Fake Elon weather

A public gauge for X accounts that score like Elon impersonators. The sweep is read-only. It does not log in, post, follow, or send a message.

The big number is this station’s log, split into active and dormant. Active means the account was under 90 days old on the day it was logged. Dormant means it was older. Squall on the dial is the low thousands of active flags. Banked is dormant flags in the tens of thousands. Deep is the hundreds of thousands.

## Signals

A handle is appended at 4 points or more.

| Signal | Points |
| --- | --- |
| Handle one character off `elonmusk` | 4 |
| Account under 90 days old | 2 |
| Followers divided by following, over 3 | 1 |
| Empty bio | 1 |
| Default picture | 2 |
| Two companies named in the bio | 2 |
| Tesla, SpaceX, and xAI in the same bio | 3 |

`allowlist.txt` and a bio that says parody, fan account, or not the real one stay off the log. `@elonmusk` is never flagged. A score is not a finding that someone committed fraud.

## The log

`counts.json` is the public file. Each run updates `attempted_at` and the `chain`, which is the SHA-256 of the previous chain and the canonical body. Git history is the night archive.

`status` is `ok` or `held`. A held file keeps the last good counts. `reason` is `login_wall`, `markup_moved`, `blocked`, or `network`.

A page with no accounts is a missed reading. The count is not reset to zero. A parsed page where nothing scores high is a real clear reading, and the number is zero.

On 28 Sep 2026 the public search URL answered with a login wall (`/i/jf/onboarding/web`), so a logged-out sweep holds. The pinned marks the parser looks for are `data-testid="UserCell"`, `User-Name`, `UserDescription`, and `UserAvatar-Container-<handle>`, plus the JSON keys `screen_name`, `followers_count`, `friends_count`, `description`, and `profile_image_url_https`. When those marks move, the failure log keeps the first 4,000 characters of the page.

## Run

```bash
python3 station.py
```

The default wait between requests is a random 4 to 12 seconds. `--pause 0` skips it. `--html saved.html` scores a saved page and does not open a connection.

The page reads the raw log on GitHub. On localhost it reads `counts.json` beside this file. `?preview=1` draws a specimen squall so the gauge can be looked at. Those figures are not the log.

`site/compare.html` is the comparison page. It puts this station’s log next to three other public datasets, each on its own dial: Jamazel’s 11 July 2026 range, the SparkToro and Followerwonk follower audit of 15 May 2022, and Travis Brown’s follower gist of 17 August 2023. The inputs are in `site/sources.json`. Follower counts stay on their own cards. The page does not blend them with the impersonator range.

`.github/workflows/nightly.yml` runs the sweep at 08:17 UTC and then waits between 1 and 40 minutes. It commits `counts.json` only. `.github/workflows/pages.yml` publishes the `site/` folder. GitHub will not accept those two files from a token that lacks the `workflow` scope. Grant it with `gh auth refresh -s workflow`, then `git push`.

## Visitor sweeps

`site/contribute.html` runs one X user search for elon, musk, and maye. The API key stays in the browser and is sent only to `https://api.x.com`. The page shows the ceiling first: about $0.30, £0.23, €0.26, and ¥2.01, from the 28 September 2026 conversion of a 30-profile cap. X bills dollars. The other three are approximate.

The host copy of `site/contribute.php` re-scores the public profiles and appends a name, a note, and any new handles to `site/ledger.json`. The key is not in that file. The note is public, and a short word list is removed on save and again on display. That ledger does not change `counts.json` and does not move the station dial. GitHub Pages does not run the PHP, so a sweep there can call X and then has nowhere to save.

## Host

Bluehost can serve the `site/` folder. See `UPLOAD.txt`. Do not mix it into the Scrollstime sites. After the Pages workflow is on `main`, the gauge is also at `https://rogerwillko.github.io/impersonator-weather/`.
