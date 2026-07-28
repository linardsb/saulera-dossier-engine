#!/usr/bin/env bash
# Plan tasks 7 and 10, as one command.
#
#   .claude/verify-deploy.sh [project-name] [preview-hostname]
#
# ACCESS IS DEFERRED (27 Jul 2026) — the deployment is public by decision, tasks 8-10 are
# parked, AC4 is not met. So the Access rows report SKIPPED rather than failing. Nothing
# here needs editing to turn the door back on: the script decides which phase it is in by
# whether production redirects to cloudflareaccess.com, so the moment an Access application
# exists it switches to the AC4 acceptance test on its own.
#
# That test, when it applies: a 302 to cloudflareaccess.com on production, on a preview
# hostname, and on the Function. Any 200 is a failure — a 200 on production with a 302 on
# preview is the specific failure AC4 exists to catch, i.e. you stopped at task 8.

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

  # Task 7 predicts 405; the plan's AMENDMENT corrects that to 404; both are wrong for THIS
  # project. A GET falls through to static asset handling, and with no 404.html in public/
  # the fallback serves index.html at 200. saulera.com 404s only because it HAS a 404.html.
  # Asserted as 200 to match reality — see the 27 Jul amendment.
  check "GET /api/health (html shell) " "200" "$(curl -s -o /dev/null -w '%{http_code}' "$PROD/api/health")"

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

  echo
  echo "Access is applied at the edge — retry once after 60s before treating a 200 as real."
fi

echo
[ $fail -eq 0 ] && echo "PASS" || echo "FAILED — see above"
exit $fail
