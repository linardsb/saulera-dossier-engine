#!/usr/bin/env bash
# Plan tasks 7 and 10, as one command.
#
#   .claude/verify-deploy.sh [project-name] [preview-hostname]
#
# Access has been on since #12. The header here used to say "ACCESS IS DEFERRED (27 Jul 2026)"
# and the script had been silently running its post-Access branch ever since; #17's plan left
# the correction to #20, which is this.
#
# The script decides its own phase from whether production redirects to cloudflareaccess.com,
# so the pre-Access branch below is kept for a fresh agency deployment standing itself up —
# not because this one is in it.
#
# What the post-Access branch tests is now #20's AC4 rather than #12's: ONE hostname serving
# TWO audiences with two different doors. The recruiter's routes must 302 to Access, and the
# candidate's /prep/* routes must answer 200 without ever reaching it. Either half alone is a
# false pass — a deployment where everything 302s has locked out every candidate, and one
# where everything 200s has published the recruiter's tool.

set -uo pipefail

PROJECT="${1:-saulera-dossier-engine}"
PREVIEW="${2:-}"
PROD="https://${PROJECT}.pages.dev"
fail=0

code_and_redirect() { curl -s -o /dev/null -w '%{http_code} %{redirect_url}' "$@"; }

check() { # label expected actual
  if [ "$2" = "$3" ]; then printf '  ok    %-34s %s\n' "$1" "$3"
  else printf '  FAIL  %-34s got %s, want %s\n' "$1" "$3" "$2"; fail=1; fi
}

echo "project: $PROJECT"
echo

prod_head=$(code_and_redirect "$PROD/")
prod_code=${prod_head%% *}
prod_to=${prod_head#* }

# Phase is decided by whether Access is intercepting, not by the status code — a brand-new
# project answers 522 for a minute or two while the edge propagates, and that is not "Access
# is up". Judge on the redirect target.
case "$prod_to" in
  *cloudflareaccess.com*) phase=post ;;
  *) phase=pre ;;
esac

if [ "$phase" = "pre" ] && [ "$prod_code" != "200" ]; then
  echo "production answered $prod_code and did not redirect to Access."
  echo "  522 / 000 on a new project is edge propagation or SSL issuance — wait a minute, re-run."
  echo "  anything else: check Pages > Deployments for a failed build."
  exit 1
fi

if [ "$phase" = "pre" ]; then
  echo "phase: pre-Access (task 7) — production serves directly, no Access application yet"
  echo

  check "GET /                        " "200" "$prod_code"
  check "GET /tokens.css              " "200" "$(curl -s -o /dev/null -w '%{http_code}' "$PROD/tokens.css")"

  body=$(curl -s -X POST "$PROD/api/health" -H 'content-type: application/json' -d '{}')
  code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$PROD/api/health" -H 'content-type: application/json' -d '{}')
  check "POST /api/health (no secret) " "503" "$code"
  check "  its body                   " '{"error":"not_configured"}' "$body"

  # Task 7 predicted 405 and the plan's AMENDMENT corrected it to 404; both were wrong while
  # this project had no 404 page, because a GET falls through to static asset handling and
  # the fallback served index.html at 200. #20 added public/404.html — it had to, since
  # /prep/* is now public and that fallback would have served the recruiter's shell to the
  # world — so 404 is finally the honest expectation.
  check "GET /api/health (no such page)" "404" "$(curl -s -o /dev/null -w '%{http_code}' "$PROD/api/health")"

  echo
  printf '  SKIP  %-34s Access deferred 27 Jul 2026 — public by decision\n' "task 10 / AC4: prod is 302"
  printf '  SKIP  %-34s same\n' "task 10 / AC4: preview is 302"
  printf '  SKIP  %-34s same\n' "task 10 / AC4: /api/health is 302"
  echo
  echo "A 404 on POST /api/health means the Function was not picked up: check that functions/"
  echo "is at the repo root and that the project's root directory is /."
  echo
  echo "Access: parked, not failed. Restore it with plan tasks 8-9 (runbook in DEPLOY.md on"
  echo "branch B) and re-run — this script switches to the AC4 test with no edit. It must be"
  echo "back on before #6, which adds a route that actually calls the model."

else
  echo "phase: post-Access (task 10) — the AC4 acceptance test"
  echo
  [ -z "$PREVIEW" ] && echo "  note: no preview hostname passed. Get one from Pages > Deployments and pass it as \$2." && echo

  check "production                   " "302" "$prod_code"
  case "$prod_to" in *cloudflareaccess.com*) printf '  ok    %-34s -> cloudflareaccess.com\n' "  its redirect";;
    *) printf '  FAIL  %-34s -> %s\n' "  its redirect" "${prod_to:-<none>}"; fail=1;; esac

  api_head=$(code_and_redirect -X POST "$PROD/api/health" -H 'content-type: application/json' -d '{}')
  check "POST /api/health             " "302" "${api_head%% *}"
  case "${api_head#* }" in *cloudflareaccess.com*) printf '  ok    %-34s -> cloudflareaccess.com\n' "  its redirect";;
    *) printf '  FAIL  %-34s -> %s\n' "  its redirect" "${api_head#* }"; fail=1;; esac

  if [ -n "$PREVIEW" ]; then
    prev_head=$(code_and_redirect "https://${PREVIEW}/")
    check "preview hostname             " "302" "${prev_head%% *}"
    case "${prev_head#* }" in *cloudflareaccess.com*) printf '  ok    %-34s -> cloudflareaccess.com\n' "  its redirect";;
      *) printf '  FAIL  %-34s -> %s\n' "  its redirect" "${prev_head#* }"; fail=1;; esac
  fi

  # ── #20 AC4: the candidate's door, on the same hostname, open ────────────────────────
  #
  # This trio is the acceptance test as one executable statement. Two path-scoped Access
  # applications carry a Bypass -> Everyone policy at <project>.pages.dev/prep, and Access
  # resolves the more specific path first, so /prep/* serves publicly while everything else
  # keeps redirecting. A 302 on either /prep row means the bypass did not take and every
  # invited candidate is looking at a Cloudflare login for an account they do not have.
  echo
  check "GET /prep/privacy (public)   " "200" "$(curl -s -o /dev/null -w '%{http_code}' "$PROD/prep/privacy")"
  check "GET /prep/login (public)     " "200" "$(curl -s -o /dev/null -w '%{http_code}' "$PROD/prep/login")"

  # The recruiter's door, shut, on that same hostname. /clients.html rather than / because it
  # is the screen that actually holds the agency's client knowledge.
  clients_head=$(code_and_redirect "$PROD/clients.html")
  check "GET /clients.html (gated)    " "302" "${clients_head%% *}"
  case "${clients_head#* }" in *cloudflareaccess.com*) printf '  ok    %-34s -> cloudflareaccess.com\n' "  its redirect";;
    *) printf '  FAIL  %-34s -> %s\n' "  its redirect" "${clients_head#* }"; fail=1;; esac

  # The bypass must match the /prep path SEGMENT, not the string prefix. If any of these
  # answers 200, a sibling route has leaked out from behind Access along with the portal.
  for path in /prepx /prep-secret /preparation; do
    check "GET $path (still gated)" "302" "$(curl -s -o /dev/null -w '%{http_code}' "$PROD$path")"
  done

  # And the fallback that made /prep/* dangerous in the first place: with public/404.html in
  # place an unmatched path under the public prefix must 404, not serve the recruiter shell.
  check "GET /prep/nonsense (404 page)" "404" "$(curl -s -o /dev/null -w '%{http_code}' "$PROD/prep/nonsense")"

  echo
  echo "Access is applied at the edge — retry once after 60s before treating a 200 as real."
  echo "A 302 on a /prep row: check the two bypass applications exist (scripts/setup-access.py)."
  echo "A 200 on a gated row: the whole hostname is open. Stop and fix that first."
fi

echo
[ $fail -eq 0 ] && echo "PASS" || echo "FAILED — see above"
exit $fail
