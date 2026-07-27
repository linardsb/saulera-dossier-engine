#!/usr/bin/env python3
"""Create the two Cloudflare Access applications a Pages deployment needs.

Engine tooling: every agency deployment needs the identical pair, so this is written
once here rather than clicked twice per agency.

Why two applications and not one wildcard — from the Cloudflare Access docs:
    "A wildcard in the Subdomain field only matches that specific subdomain level.
     It does not cover the apex domain."
So `*.<project>.pages.dev` covers every preview and explicitly excludes production.
One application leaves open whichever side you skipped.

The policy is sent inline with the application rather than as a follow-up call, so a
failure cannot leave an application standing with no policy attached. If it is created
without one, the app exists and enforces nothing useful — that half-state is the bug
this shape exists to prevent.

Usage:
    CF_API_TOKEN=$(cat ~/.cf-access-token) \\
        ./scripts/setup-access.py <project-name> <email> [more-emails...]

The token needs Account -> Access: Apps and Policies -> Edit. The wrangler OAuth
credential does NOT work: it carries pages:write / workers:write and no Access scope.
"""

import json
import os
import sys
import urllib.error
import urllib.request

API_ROOT = "https://api.cloudflare.com/client/v4"
DEFAULT_ACCOUNT = "fc9a7b58725102d7d44da605e562d92c"


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
        # Cloudflare returns a JSON error envelope even on 4xx; surface it rather
        # than the bare status, because the message names the missing permission.
        try:
            body = json.load(exc)
        except Exception:
            raise RuntimeError(f"HTTP {exc.code} with no JSON body") from None
    if not body.get("success"):
        raise RuntimeError(json.dumps(body.get("errors")))
    return body.get("result")


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: setup-access.py <project-name> <email> [more-emails...]")

    project, emails = sys.argv[1], sys.argv[2:]
    account = os.environ.get("CF_ACCOUNT_ID", DEFAULT_ACCOUNT)
    token = os.environ.get("CF_API_TOKEN")
    if not token:
        sys.exit("set CF_API_TOKEN — an Access: Apps and Policies (Edit) token")

    apps_path = f"/accounts/{account}/access/apps"
    existing = {a.get("domain"): a for a in (call("GET", apps_path, token) or [])}

    targets = [
        (f"{project} — production", f"{project}.pages.dev"),
        (f"{project} — previews", f"*.{project}.pages.dev"),
    ]

    print(f"Access applications for {project} — admitting: {', '.join(emails)}")
    for name, domain in targets:
        if domain in existing:
            app = existing[domain]
            n = len(app.get("policies") or [])
            flag = "" if n else "   ⚠️  NO POLICY — delete it and re-run"
            print(f"  = {domain} already exists ({app['id'][:8]}, {n} policies){flag}")
            continue

        payload = {
            "name": name,
            "domain": domain,
            "type": "self_hosted",
            "session_duration": "24h",
            "app_launcher_visible": False,
            # allowed_idps is deliberately omitted. With none set every configured
            # login method is offered, and one-time PIN is built in and always
            # present. Naming an IdP here would EXCLUDE OTP, which is the only
            # method this deployment wants.
            "policies": [
                {
                    "name": "Allow listed emails",
                    "decision": "allow",
                    "include": [{"email": {"email": e}} for e in emails],
                }
            ],
        }
        try:
            app = call("POST", apps_path, token, payload)
        except RuntimeError as exc:
            sys.exit(f"  ✗ {domain}: {exc}")

        n = len(app.get("policies") or [])
        if not n:
            # Inline policies silently ignored by an older API version. Delete the
            # app rather than leave it enforcing nothing.
            call("DELETE", f"{apps_path}/{app['id']}", token)
            sys.exit(f"  ✗ {domain}: created without a policy — removed. API may not accept inline policies.")
        print(f"  ✓ {domain}  ({app['id'][:8]}, {n} policy)")

    print()
    print("Access applies at the edge — allow 1–2 minutes to propagate.")
    print("Verify (both must be 302 with cloudflareaccess.com in the redirect):")
    print(f"  curl -s -o /dev/null -w 'prod: %{{http_code}} %{{redirect_url}}\\n' https://{project}.pages.dev/")
    print(f"  curl -s -o /dev/null -w 'prev: %{{http_code}} %{{redirect_url}}\\n' https://<hash>.{project}.pages.dev/")


if __name__ == "__main__":
    main()
