#!/usr/bin/env python3
"""Poke the deployed portal so BOTH lazy mail sweeps run, by hand (#25, #69).

Why this exists. Pages has no cron, so the lazy sweeps in functions/prep/_middleware.js run
on every portal request. On a day with no portal traffic at all, nobody is swept — so run
this on a calendar reminder each morning and both promises hold through a quiet week:

    the one reminder (#25, decision 17)  "your interview is tomorrow", once per invite
    the extension radar (#69)            "this booking ends in a fortnight", once per deadline

The second is the one that NEEDS this script rather than merely benefiting from it: the
reminder at least rides the traffic of the candidates it is about, while the extension nudge
is recruiter-facing and the recruiter never visits /prep/*. On a deployment with no candidate
traffic, this poke is the radar's only liveness.

One GET, nothing more. Any /prep/* route triggers the middleware; /prep/login is
unauthenticated and cheap. Unlike purge.py this is NOT a d1-execute script — the sweeps
must send mail, which only the deployed Function can do (the Resend secret lives there).
The poke reuses that one code path instead of reimplementing claim+send in Python, and one
poke driving two sweeps is why there is no separate nudge.py to remember.

It cannot print a sent count: the middleware is silent by design. The operator's
assurance is the claim column itself — one per sweep —

    npx wrangler d1 execute dossier-engine --remote \\
      --command "SELECT count(*) FROM invite WHERE reminder_sent_at IS NOT NULL"

    npx wrangler d1 execute dossier-engine --remote \\
      --command "SELECT count(*) FROM assignment WHERE nudge_sent_at IS NOT NULL"

Note the second count can go DOWN as well as up, and that is not a bug: extending a booking
clears its stamp so the new deadline nudges again (src/compliance/store.js, updateAssignment).

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
    print(f"poking {url} so both mail sweeps run", flush=True)
    try:
        with urllib.request.urlopen(url, timeout=30) as response:
            print(f"✓ HTTP {response.status} — the middleware ran; due reminders and extension nudges are on their way", flush=True)
    except urllib.error.HTTPError as err:
        # A 4xx/5xx still ran the middleware IF it reached the Function, but say what came back.
        sys.exit(f"✗ HTTP {err.code} from {url} — check the deployment before trusting the sweeps ran")
    except (urllib.error.URLError, OSError) as err:
        sys.exit(f"✗ could not reach {url}: {err}")


if __name__ == "__main__":
    main()
