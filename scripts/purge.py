#!/usr/bin/env python3
"""Purge expired invite scopes and dormant compliance cages from a remote D1, by hand (#17, #67).

Why this exists. Pages has no cron, so both retention rules — the portal's 30 days after the
interview (architecture decision 13) and the compliance cage's 12 months of dormancy (spike
#66) — run lazily in functions/prep/_middleware.js on every portal request. A portal nobody
visits therefore never purges on its own, and neither promise may depend on traffic. This
script is the assurance path: run it on a calendar reminder against preview and production,
and both promises hold through a quiet month.

One DELETE per cage, each with its count. Each DELETE targets a ROOT alone — `invite` and
`candidate` — and the schema's ON DELETE CASCADE chains (proven by test/schema.test.js,
test/portal-purge.test.js and test/compliance-purge.test.js) take each scope's children with
it. `SELECT changes()` rides in the same --command after each, so the operator sees the
purged counts in wrangler's output rather than trusting a silent exit 0.

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

# The identical statements the lazy purge runs, so the two paths cannot drift apart, plus the
# counts the operator came for. One --command, statements separated by `;` — wrangler runs
# them in order and returns a result set per SELECT, so `purged_invites` and
# `purged_candidates` arrive as two labelled answers rather than one ambiguous number.
#
# changes() counts rows the statement itself deleted, never the rows ON DELETE CASCADE took
# with them — which is why each number reads as "scopes purged" and not "rows deleted", and
# why it matches the {purged} the store functions return.
PURGE_SQL = (
    "DELETE FROM invite WHERE datetime(interview_at, '+30 days') <= datetime('now'); "
    "SELECT changes() AS purged_invites; "
    "DELETE FROM candidate "
    "WHERE datetime(created_at, '+12 months') <= datetime('now') "
    "AND NOT EXISTS ("
    "SELECT 1 FROM assignment "
    "WHERE assignment.candidate_id = candidate.id "
    "AND (assignment.end_date IS NULL "
    "OR datetime(assignment.end_date, '+12 months') > datetime('now'))); "
    "SELECT changes() AS purged_candidates;"
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
    print(
        f"purging expired invite scopes and dormant compliance cages from {name} "
        f"({args[0]}, remote)",
        flush=True,
    )
    ran = subprocess.run(
        ["npx", WRANGLER, "d1", "execute", name, "--remote", "--command", PURGE_SQL],
        env=env,
    )
    if ran.returncode != 0:
        sys.exit(f"✗ purge failed against {name} — see the wrangler output above")
    print(f"✓ purge ran against {name} — both purged counts are in the results above", flush=True)


if __name__ == "__main__":
    main()
