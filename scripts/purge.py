#!/usr/bin/env python3
"""Purge expired invite scopes from a remote D1, by hand (#17).

Why this exists. Pages has no cron, so the 30-day retention rule (architecture decision 13)
runs lazily in functions/prep/_middleware.js on every portal request. A portal nobody visits
therefore never purges on its own, and "we delete 30 days after the interview" must not
depend on traffic. This script is the assurance path: run it on a calendar reminder against
preview and production, and the promise holds through a quiet month.

One statement plus a count. The DELETE targets `invite` alone; the schema's ON DELETE
CASCADE chain (proven by test/schema.test.js and test/portal-purge.test.js) takes each
expired invite's whole scope with it. `SELECT changes()` rides in the same --command so the
operator sees the purged count in wrangler's output rather than trusting a silent exit 0.

`d1 execute --remote` resolves the database by NAME against the account API (verified
27 Jul 2026, scripts/dev.py header), so no throwaway config is needed here.

Usage:
    ./scripts/purge.py preview      # npm run purge:preview
    ./scripts/purge.py production   # npm run purge:remote
"""

import os
import subprocess
import sys

# The same pin and the same per-agency name scheme as scripts/dev.py — one wrangler version
# and one pair of environment variables across every script, deliberately.
WRANGLER = "wrangler@4.114.0"
NVM_ROOT = os.path.expanduser("~/.nvm/versions/node")

D1_NAME = os.environ.get("DOSSIER_D1_NAME", "dossier-engine")
DATABASES = {
    "preview": os.environ.get("DOSSIER_D1_NAME_PREVIEW", f"{D1_NAME}-preview"),
    "production": D1_NAME,
}

# The identical statement the lazy purge runs, so the two paths cannot drift apart, plus the
# count the operator came for.
PURGE_SQL = (
    "DELETE FROM invite WHERE datetime(interview_at, '+30 days') <= datetime('now'); "
    "SELECT changes() AS purged;"
)


def node22_path():
    """A PATH whose `node` is >= 22. Wrangler needs it; this machine's default is v20."""
    def major(binary):
        try:
            out = subprocess.run([binary, "-v"], capture_output=True, text=True).stdout
            return int(out.strip().lstrip("v").split(".")[0])
        except (OSError, ValueError):
            return 0

    if major("node") >= 22:
        return os.environ["PATH"]

    for name in sorted(os.listdir(NVM_ROOT) if os.path.isdir(NVM_ROOT) else [], reverse=True):
        candidate = os.path.join(NVM_ROOT, name, "bin")
        if major(os.path.join(candidate, "node")) >= 22:
            return candidate + os.pathsep + os.environ["PATH"]

    sys.exit(
        "no Node >= 22 found, and wrangler needs one. Install one, or put an existing one "
        'on PATH:\n\n    export PATH="$HOME/.nvm/versions/node/v24.11.0/bin:$PATH"\n'
    )


def main():
    args = sys.argv[1:]
    if len(args) != 1 or args[0] not in DATABASES:
        sys.exit(f"usage: ./scripts/purge.py {'|'.join(DATABASES)}")

    name = DATABASES[args[0]]
    env = {**os.environ, "PATH": node22_path()}

    # flush=True for the same reason as dev.py: output nobody sees closes nothing.
    print(f"purging expired invite scopes from {name} ({args[0]}, remote)", flush=True)
    ran = subprocess.run(
        ["npx", WRANGLER, "d1", "execute", name, "--remote", "--command", PURGE_SQL],
        env=env,
    )
    if ran.returncode != 0:
        sys.exit(f"✗ purge failed against {name} — see the wrangler output above")
    print(f"✓ purge ran against {name} — the purged count is in the result above", flush=True)


if __name__ == "__main__":
    main()
