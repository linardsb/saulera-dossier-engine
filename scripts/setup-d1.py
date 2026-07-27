#!/usr/bin/env python3
"""Bind the D1 database `DB` on both Pages environments, idempotently.

Engine tooling: every agency deployment needs the identical pair of bindings, so this is
written once here rather than clicked twice per agency.

Why the binding lives here and not in `wrangler.toml` (#5, Decision 3): a `database_id` is
per-agency *config*, and `wrangler.toml` is *engine* — tracked upstream and shared by every
agency. Putting an id in it forks an engine file per agency and produces a merge conflict on
every pull. Project-level bindings also apply to every deployment regardless of how the build
was triggered, which sidesteps the fact that Cloudflare's own documentation disagrees with
itself about whether a git-connected CI build reads `wrangler.toml` bindings at all.

Production and preview get *different* databases. A preview deploy writing real client notes
is not acceptable, and the notes name real hiring managers.

Whether PATCH merges or replaces `deployment_configs` is not documented. So: GET first, keep
the response, PATCH only the delta, then GET again and check both that the bindings landed and
that every pre-existing key survived. A silent replace is therefore detected rather than
discovered later as a deployment with no compatibility date. The full merged object is
deliberately *not* echoed back, because the GET carries computed fields (`wrangler_config_hash`)
that are not ours to write.

Usage:
    ./scripts/setup-d1.py [project-name]

Auth: reads wrangler's stored OAuth token (`pages:write` is enough — no API token needed, and
unlike `setup-access.py` this needs no Access scope). Run `npx wrangler login` if it is missing
or expired.
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request

API_ROOT = "https://api.cloudflare.com/client/v4"
DEFAULT_ACCOUNT = "fc9a7b58725102d7d44da605e562d92c"
DEFAULT_PROJECT = "saulera-dossier-engine"
WRANGLER_CONFIG = os.path.expanduser("~/.wrangler/config/default.toml")

BINDING = "DB"
# environment -> database name. Per-agency values, so they come from the environment and not
# from an edit to this file: README lists this script as engine, shared by every agency, and
# Decision 3 exists to stop per-agency values landing in tracked engine files. Editing the
# defaults below to onboard agency #2 is the fork this whole arrangement is avoiding.
D1_NAME = os.environ.get("DOSSIER_D1_NAME", "dossier-engine")
DATABASES = {
    "production": D1_NAME,
    "preview": os.environ.get("DOSSIER_D1_NAME_PREVIEW", f"{D1_NAME}-preview"),
}


def wrangler_token():
    try:
        text = open(WRANGLER_CONFIG).read()
    except OSError:
        sys.exit(f"no wrangler config at {WRANGLER_CONFIG} — run: npx wrangler login")
    m = re.search(r'^oauth_token\s*=\s*"([^"]+)"', text, re.M)
    if not m:
        sys.exit("no oauth_token in the wrangler config — run: npx wrangler login")
    return m.group(1)


def call(method, path, token, payload=None):
    """One Cloudflare API call. Returns the `result` object, or raises RuntimeError."""
    req = urllib.request.Request(
        f"{API_ROOT}{path}",
        method=method,
        data=json.dumps(payload).encode() if payload is not None else None,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as exc:
        # Cloudflare returns a JSON error envelope even on 4xx; surface it rather than the
        # bare status, because the message names the missing permission.
        try:
            body = json.load(exc)
        except Exception:
            raise RuntimeError(f"HTTP {exc.code} with no JSON body") from None
    if not body.get("success"):
        raise RuntimeError(json.dumps(body.get("errors")))
    return body.get("result")


def database_ids(account, token):
    """Resolve every D1 database this script binds, by name. Ids are never committed."""
    listed = call("GET", f"/accounts/{account}/d1/database?per_page=100", token) or []
    by_name = {db["name"]: db["uuid"] for db in listed}
    ids = {}
    for env, name in DATABASES.items():
        if name not in by_name:
            sys.exit(f"no D1 database named {name} — run: npx wrangler d1 create {name}")
        ids[env] = by_name[name]
    return ids


# Keys the survival check skips. `d1_databases` is the one this script owns; the other two
# move on their own. The PATCH normalises a null `env_vars` to `{}`, and `wrangler_config_hash`
# is computed from the last build's wrangler.toml and is recomputed on the next deploy. Neither
# is configuration anybody set, and treating either as a replace would fail a run that worked.
IGNORED_ON_COMPARE = {"d1_databases", "env_vars", "wrangler_config_hash"}


def bound_id(configs, env):
    return ((configs.get(env) or {}).get("d1_databases") or {}).get(BINDING, {}).get("id")


def main():
    project = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PROJECT
    account = os.environ.get("CF_ACCOUNT_ID", DEFAULT_ACCOUNT)
    token = wrangler_token()
    base = f"/accounts/{account}/pages/projects/{project}"

    ids = database_ids(account, token)
    for env, name in DATABASES.items():
        print(f"{env:<10} {name} → {ids[env]}")

    before = (call("GET", base, token) or {}).get("deployment_configs") or {}

    if all(bound_id(before, env) == ids[env] for env in DATABASES):
        print(f"ok — {BINDING} is already bound on both environments, nothing to change")
        return

    # Only the delta. The GET carries computed fields we have no business writing back.
    patch = {
        env: {"d1_databases": {BINDING: {"id": ids[env]}}} for env in DATABASES
    }
    call("PATCH", base, token, {"deployment_configs": patch})

    after = (call("GET", base, token) or {}).get("deployment_configs") or {}

    problems = []
    for env in DATABASES:
        got = bound_id(after, env)
        if got != ids[env]:
            problems.append(f"{env}: {BINDING} is {got!r}, expected {ids[env]!r}")
        # A silent replace would drop everything that was there before the PATCH — the
        # compatibility date, the compatibility flags, the build image version.
        for key, was in (before.get(env) or {}).items():
            if key in IGNORED_ON_COMPARE:
                continue
            now = (after.get(env) or {}).get(key, "<absent>")
            if now != was:
                problems.append(
                    f"{env}: PATCH replaced rather than merged — {key} was {was!r}, now {now!r}"
                )
    if problems:
        print("\n".join(f"✗ {p}" for p in problems), file=sys.stderr)
        print(
            "\nthe deployment_configs as they were before this run:\n"
            + json.dumps(before, indent=2),
            file=sys.stderr,
        )
        sys.exit("✗ bindings not applied as intended — restore from the dump above")

    if bound_id(after, "production") == bound_id(after, "preview"):
        sys.exit("✗ production and preview resolved to the same database — check the names")

    print(f"✓ {BINDING} bound on production and preview, confirmed by a second GET")


if __name__ == "__main__":
    main()
