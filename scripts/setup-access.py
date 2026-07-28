#!/usr/bin/env python3
"""Create the four Cloudflare Access applications a Pages deployment needs.

Engine tooling: every agency deployment needs the identical set, so this is written
once here rather than clicked four times per agency.

Why two applications and not one wildcard — from the Cloudflare Access docs:
    "A wildcard in the Subdomain field only matches that specific subdomain level.
     It does not cover the apex domain."
So `*.<project>.pages.dev` covers every preview and explicitly excludes production.
One application leaves open whichever side you skipped.

Why four and not two (#20). One hostname serves two audiences. The recruiter's tool is
gated by Access; the candidate's prep portal at /prep/* deliberately is not — decision 12
rules Access out for candidates, because Access bills past 50 users and a recruitment
agency invites more candidates than that in a quarter. A rotating invite token is the
candidate's door instead. The two /prep applications carry a Bypass → Everyone policy,
and Access resolves the more specific path first:
    "When multiple rules are set for a common root path, the more specific rule takes
     precedence... no rule is inherited from dashboard.com/eng."
So /prep/* serves publicly while /, /clients.html and /api/* keep redirecting to Access.
Both levels, for the same reason the pair above exists: a wildcard does not cover the apex.

Verified live on this deployment, 28 Jul 2026: /prep/privacy 200; /, /api/events and
/clients.html 302 to Access; and — the row worth keeping — /prepx, /prep-secret and
/preparation all 302, because the bypass matches the /prep path SEGMENT and not the
string prefix, so no sibling route leaks.

The policy is sent inline with the application rather than as a follow-up call, so a
failure cannot leave an application standing with no policy attached. If it is created
without one, the app exists and enforces nothing useful — that half-state is the bug
this shape exists to prevent. For a bypass app the half-state is worse than useless: an
application with no policy enforces Allow-nothing, so a /prep app created bare would lock
every candidate out silently, which is why the delete-on-no-policy check below covers all
four and not just the gated pair.

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

    # Each target carries its own policy, so one loop creates all four applications and
    # the gated/public difference is one readable column rather than a branch in the body.
    allow = {
        "name": "Allow listed emails",
        "decision": "allow",
        "include": [{"email": {"email": e}} for e in emails],
    }
    bypass = {
        "name": "Public — candidate portal",
        "decision": "bypass",
        "include": [{"everyone": {}}],
    }

    targets = [
        (f"{project} — production", f"{project}.pages.dev", allow),
        (f"{project} — previews", f"*.{project}.pages.dev", allow),
        (f"{project} — portal (prod)", f"{project}.pages.dev/prep", bypass),
        (f"{project} — portal (previews)", f"*.{project}.pages.dev/prep", bypass),
    ]

    print(f"Access applications for {project} — admitting: {', '.join(emails)}")
    print("  /prep/* is deliberately public (decision 12) — the invite token is that door.")
    # `existing` is keyed on the app's own `domain`, which for the two portal apps already
    # holds the path form ('<project>.pages.dev/prep'), so the dedup below distinguishes
    # them from the gated pair with no extra key.
    for name, domain, policy in targets:
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
            # method this deployment wants. It is inert on the bypass apps, which
            # never reach an identity check at all.
            "policies": [policy],
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
    print("Verify the recruiter door is shut (both 302, cloudflareaccess.com in the redirect):")
    print(f"  curl -s -o /dev/null -w 'prod:    %{{http_code}} %{{redirect_url}}\\n' https://{project}.pages.dev/")
    print(f"  curl -s -o /dev/null -w 'prev:    %{{http_code}} %{{redirect_url}}\\n' https://<hash>.{project}.pages.dev/")
    print("Verify the candidate door is open (200, served directly, no redirect):")
    print(f"  curl -s -o /dev/null -w 'portal:  %{{http_code}} %{{redirect_url}}\\n' https://{project}.pages.dev/prep/privacy")
    print("Both halves have to hold at once. A 302 on the portal line means the bypass did not")
    print("take; a 200 on either gated line means the whole hostname is open.")


if __name__ == "__main__":
    main()
