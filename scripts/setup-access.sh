#!/usr/bin/env bash
# Create the two Cloudflare Access applications a Pages deployment needs, with an
# email one-time-PIN policy. Engine tooling: every agency deployment needs the same
# pair, so this is written once here rather than clicked twice per agency.
#
# Why two applications and not one wildcard — from the Cloudflare Access docs:
#   "A wildcard in the Subdomain field only matches that specific subdomain level.
#    It does not cover the apex domain."
# So `*.<project>.pages.dev` covers every preview and explicitly excludes production.
# One application leaves the front door open on whichever side you skipped.
#
# Usage:
#   export CF_API_TOKEN=...            # needs: Access: Apps and Policies — Edit
#   export CF_ACCOUNT_ID=...           # optional, defaults below
#   ./scripts/setup-access.sh <project-name> <email> [more-emails...]
#
# The wrangler OAuth token does NOT work here — it carries pages:write / workers:write
# and no Access scope. Mint a token at:
#   dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom token
#   Permissions: Account → Access: Apps and Policies → Edit

set -euo pipefail

ACCOUNT_ID="${CF_ACCOUNT_ID:-fc9a7b58725102d7d44da605e562d92c}"
PROJECT="${1:?usage: setup-access.sh <project-name> <email> [more-emails...]}"
shift
[ "$#" -ge 1 ] || { echo "error: at least one email required" >&2; exit 1; }
EMAILS=("$@")

: "${CF_API_TOKEN:?set CF_API_TOKEN — an Access: Apps and Policies (Edit) token}"

API="https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/access/apps"
AUTH=(-H "Authorization: Bearer $CF_API_TOKEN" -H "Content-Type: application/json")

# Build the include[] array once: one {"email": {...}} entry per address.
INCLUDE=$(printf '%s\n' "${EMAILS[@]}" | python3 -c '
import json,sys
print(json.dumps([{"email": {"email": e.strip()}} for e in sys.stdin if e.strip()]))')

fail() { echo "  ✗ $1" >&2; exit 1; }

create_app() {
  local name="$1" domain="$2"

  # Idempotence: skip if an application already claims this domain. Creating a
  # second one for the same hostname is accepted by the API and then behaves
  # unpredictably, so this check matters more than it looks.
  local existing
  existing=$(curl -sS "${AUTH[@]}" "$API" | python3 -c "
import json,sys
r=json.load(sys.stdin)
if not r.get('success'): sys.exit(0)
print(next((a['id'] for a in (r.get('result') or []) if a.get('domain')=='$domain'), ''))")

  if [ -n "$existing" ]; then
    echo "  = $domain already has an application (${existing:0:8}) — skipping"
    return
  fi

  local body app_id
  body=$(python3 -c "
import json
print(json.dumps({
  'name': '$name',
  'domain': '$domain',
  'type': 'self_hosted',
  'session_duration': '24h',
  # allowed_idps omitted on purpose: with none set, every configured login method
  # is offered, and one-time PIN is built in and always present. Naming an IdP here
  # would *exclude* OTP, which is the only method this deployment wants.
  'app_launcher_visible': False,
}))")

  app_id=$(curl -sS -X POST "${AUTH[@]}" "$API" -d "$body" | python3 -c "
import json,sys
r=json.load(sys.stdin)
if not r.get('success'):
    print('ERR:'+json.dumps(r.get('errors')), file=sys.stderr); sys.exit(1)
print(r['result']['id'])") || fail "could not create application for $domain"

  curl -sS -X POST "${AUTH[@]}" "$API/$app_id/policies" -d "$(python3 -c "
import json
print(json.dumps({
  'name': 'Allow listed emails',
  'decision': 'allow',
  'include': $INCLUDE,
}))")" | python3 -c "
import json,sys
r=json.load(sys.stdin)
if not r.get('success'):
    print('ERR:'+json.dumps(r.get('errors')), file=sys.stderr); sys.exit(1)
print('  ✓ policy attached')" || fail "application $domain created but policy failed — delete it and re-run"

  echo "  ✓ $domain  (${app_id:0:8})"
}

echo "Access applications for $PROJECT — admitting: ${EMAILS[*]}"
create_app "$PROJECT — production" "$PROJECT.pages.dev"
create_app "$PROJECT — previews"   "*.$PROJECT.pages.dev"

echo
echo "Propagating (Access applies at the edge, allow 1-2 minutes)."
echo "Verify — both must be 302 with cloudflareaccess.com in the redirect:"
echo
echo "  curl -s -o /dev/null -w 'prod: %{http_code} %{redirect_url}\\n' https://$PROJECT.pages.dev/"
echo "  curl -s -o /dev/null -w 'prev: %{http_code} %{redirect_url}\\n' https://<hash>.$PROJECT.pages.dev/"
echo
echo "A 200 on production with a 302 on preview is the exact failure two applications prevent."
