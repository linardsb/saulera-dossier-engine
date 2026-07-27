#!/usr/bin/env python3
"""Trigger a Cloudflare Pages build of the production branch and wait for it.

Why this exists: pushes to `main` do not trigger a build on this project. The Pages
config is correct (`deployments_enabled`, `production_deployments_enabled`, branch
`main`, `path_includes: ['*']`) and Cloudflare can pull the repo on demand — a build
requested through this endpoint resolves `main` and succeeds. What is broken is the
GitHub-side push notification. Re-registering it needs Cloudflare's GitHub App
authorization flow, which cannot be driven headlessly; toggling `deployments_enabled`
off and on through the API does not restore it (tried 27 Jul 2026).

Until the repo is disconnected and reconnected in
  Pages → Settings → Builds & deployments
this is how a push reaches production.

Usage:
    ./scripts/deploy.py [project-name]

Auth: reads wrangler's stored OAuth token (`pages:write` is enough — no API token
needed). Run `npx wrangler login` if it is missing or expired.
"""

import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.request

API_ROOT = "https://api.cloudflare.com/client/v4"
DEFAULT_ACCOUNT = "fc9a7b58725102d7d44da605e562d92c"
DEFAULT_PROJECT = "saulera-dossier-engine"
WRANGLER_CONFIG = os.path.expanduser("~/.wrangler/config/default.toml")


def wrangler_token():
    try:
        text = open(WRANGLER_CONFIG).read()
    except OSError:
        sys.exit(f"no wrangler config at {WRANGLER_CONFIG} — run: npx wrangler login")
    m = re.search(r'^oauth_token\s*=\s*"([^"]+)"', text, re.M)
    if not m:
        sys.exit("no oauth_token in the wrangler config — run: npx wrangler login")
    return m.group(1)


def call(method, path, token, payload=None, form=None):
    data, headers = None, {"Authorization": f"Bearer {token}"}
    if form is not None:
        # The deployments endpoint takes multipart/form-data, not JSON.
        boundary = "----pagesdeploy"
        body = "".join(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'
            for k, v in form.items()
        ) + f"--{boundary}--\r\n"
        data = body.encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    elif payload is not None:
        data = json.dumps(payload).encode()
        headers["Content-Type"] = "application/json"

    req = urllib.request.Request(f"{API_ROOT}{path}", method=method, data=data, headers=headers)
    try:
        with urllib.request.urlopen(req) as resp:
            body = json.load(resp)
    except urllib.error.HTTPError as exc:
        try:
            body = json.load(exc)
        except Exception:
            raise RuntimeError(f"HTTP {exc.code} with no JSON body") from None
    if not body.get("success"):
        raise RuntimeError(json.dumps(body.get("errors")))
    return body.get("result")


def main():
    project = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_PROJECT
    account = os.environ.get("CF_ACCOUNT_ID", DEFAULT_ACCOUNT)
    token = wrangler_token()
    base = f"/accounts/{account}/pages/projects/{project}"

    local = subprocess.run(
        ["git", "rev-parse", "--short", "origin/main"],
        capture_output=True, text=True,
    ).stdout.strip()
    if local:
        print(f"origin/main is at {local}")

    print(f"requesting a build of {project}@main …")
    dep = call("POST", f"{base}/deployments", token, form={"branch": "main"})
    dep_id = dep["id"]
    got = (dep.get("deployment_trigger", {}).get("metadata", {}) or {}).get("commit_hash", "")[:7]
    print(f"  {dep_id[:8]}  building {got or '(unknown commit)'}")
    if local and got and not got.startswith(local) and not local.startswith(got):
        print(f"  ⚠️  building {got}, but origin/main is {local} — push first?")

    # Poll to a terminal stage rather than returning on "queued": a build that fails
    # leaves the previous deployment serving, which looks identical to success from
    # the outside. Only the stage status distinguishes them.
    for _ in range(60):
        d = call("GET", f"{base}/deployments/{dep_id}", token)
        stage = d.get("latest_stage") or {}
        name, status = stage.get("name"), stage.get("status")
        if status in ("success", "failure", "canceled"):
            print(f"  {name}: {status}")
            if status != "success":
                sys.exit(f"✗ build {status} at stage '{name}' — see the Pages dashboard for logs")
            print(f"✓ live: https://{project}.pages.dev/")
            return
        time.sleep(5)
    sys.exit("✗ timed out after 5 minutes — check the Pages dashboard")


if __name__ == "__main__":
    main()
