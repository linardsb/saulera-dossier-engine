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
    ./scripts/deploy.py [project-name] [branch]

`branch` defaults to `main`, so an invocation with no arguments behaves exactly as it always
did. It exists because a gate that can only build `main` cannot run before the merge: #5's
deployment gate deploys a feature branch to its preview and checks it there. Without the
argument the script builds `main` from a feature branch's checkout, and the resulting "the
Function did not answer" reads as a routing problem rather than as the wrong code.

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
    branch = sys.argv[2] if len(sys.argv) > 2 else "main"
    account = os.environ.get("CF_ACCOUNT_ID", DEFAULT_ACCOUNT)
    token = wrangler_token()
    base = f"/accounts/{account}/pages/projects/{project}"

    # Compared against the branch being built, not always origin/main — otherwise the mismatch
    # warning stays silent in exactly the case it exists for.
    local = subprocess.run(
        ["git", "rev-parse", "--short", f"origin/{branch}"],
        capture_output=True, text=True,
    ).stdout.strip()
    if local:
        print(f"origin/{branch} is at {local}")

    print(f"requesting a build of {project}@{branch} …")
    dep = call("POST", f"{base}/deployments", token, form={"branch": branch})
    dep_id = dep["id"]
    got = (dep.get("deployment_trigger", {}).get("metadata", {}) or {}).get("commit_hash", "")[:7]
    print(f"  {dep_id[:8]}  building {got or '(unknown commit)'}")
    if local and got and not got.startswith(local) and not local.startswith(got):
        print(f"  ⚠️  building {got}, but origin/{branch} is {local} — push first?")

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
            # On a branch build, the deployment's own url: it lands on a preview hostname, and
            # printing the production one would send you to check the wrong site.
            #
            # On main, the apex. `d.get('url')` is a per-deployment hash hostname for
            # production builds too, so printing it unconditionally changed what the
            # no-argument invocation returns — at exactly the step where the runbook asks you
            # to curl the apex. Access covers hash hostnames, so this was confusion, not
            # exposure; the docstring above still promises the no-argument path is unchanged,
            # and this is what keeps that true.
            if branch == "main":
                print(f"✓ live: https://{project}.pages.dev/")
            else:
                print(f"✓ live: {d.get('url') or f'https://{project}.pages.dev/'}")
            return
        time.sleep(5)
    sys.exit("✗ timed out after 5 minutes — check the Pages dashboard")


if __name__ == "__main__":
    main()
