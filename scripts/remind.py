#!/usr/bin/env python3
"""Poke the deployed portal so the reminder sweep runs, by hand (#25).

Why this exists. Pages has no cron, so the one-reminder sweep (architecture decision 17)
runs lazily in functions/prep/_middleware.js on every portal request. On a day with no
portal traffic at all, nobody is swept — so run this on a calendar reminder each morning
and "your interview is tomorrow" holds through a quiet week.

One GET, nothing more. Any /prep/* route triggers the middleware; /prep/login is
unauthenticated and cheap. Unlike purge.py this is NOT a d1-execute script — the sweep
must send mail, which only the deployed Function can do (the Resend secret lives there).
The poke reuses that one code path instead of reimplementing claim+send in Python.

It cannot print a sent count: the middleware is silent by design. The operator's
assurance is the claim column itself —

    npx wrangler d1 execute dossier-engine --remote \\
      --command "SELECT count(*) FROM invite WHERE reminder_sent_at IS NOT NULL"

Usage:
    ./scripts/remind.py https://your-portal.example   # or set PREP_BASE_URL
    npm run remind:remote                             # reads PREP_BASE_URL
"""

import os
import sys
import urllib.error
import urllib.request


def main():
    base = (sys.argv[1] if len(sys.argv) > 1 else os.environ.get("PREP_BASE_URL", "")).rstrip("/")
    if not base:
        sys.exit("usage: ./scripts/remind.py <portal-base-url>   (or set PREP_BASE_URL)")

    url = f"{base}/prep/login"
    print(f"poking {url} so the reminder sweep runs", flush=True)
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            print(f"✓ HTTP {response.status} — the middleware ran; due reminders are on their way", flush=True)
    except urllib.error.HTTPError as err:
        # A 4xx/5xx still ran the middleware IF it reached the Function, but say what came back.
        sys.exit(f"✗ HTTP {err.code} from {url} — check the deployment before trusting the sweep ran")
    except (urllib.error.URLError, OSError) as err:
        sys.exit(f"✗ could not reach {url}: {err}")


if __name__ == "__main__":
    main()
