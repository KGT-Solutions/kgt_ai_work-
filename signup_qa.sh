#!/usr/bin/env bash
#
# signup_qa.sh — replayable live black-box QA for the Signup Flow.
#
# Reproduces the 12 live cases recorded in Sign_up_QA_TEST_REPORT.md (suites
# A/C/D/E/G/K) as runnable curl assertions, so the same checks can be re-run
# before going live instead of reconstructing each curl by hand.
#
# USAGE
#   ./signup_qa.sh                       # CORE cases, against http://127.0.0.1:4100
#   ./signup_qa.sh http://localhost:4100 # CORE cases, against a chosen base URL
#   BASE=http://host:4100 ./signup_qa.sh # same, via env
#   RUN_RATELIMIT=1 ./signup_qa.sh       # ALSO run C7/D3/E7 (see WARNING below)
#
# Exit code is non-zero if any case fails, so it is CI-usable.
#
# ── RATE-LIMIT CAVEAT (read before re-running) ────────────────────────────────
# The limiters run before the handler and count EVERY request from your IP,
# pass or fail, per window:
#   • analyze          7–8 / 10 min   (C2 spends 1)
#   • preflight-audit  ~12 / 10 min   (D2 spends 1)
#   • complete          3 / hour      (E2 + E6 spend 2)
# So CORE alone spends 2 of the 3 hourly "complete" attempts. Running the full
# script more than once within an hour will make E2/E6 return 429 on the later
# run — that is the limiter working, not a regression. Wait out the window, use
# a different source IP, or run against a fresh/non-prod stack to re-test clean.
# RUN_RATELIMIT=1 deliberately EXHAUSTS all three windows; run it last.
# ──────────────────────────────────────────────────────────────────────────────

set -uo pipefail

BASE="${1:-${BASE:-http://127.0.0.1:4100}}"
CT='Content-Type: application/json'
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=0; FAIL=0

# Colour only when stdout is a terminal.
if [ -t 1 ]; then G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; Z=$'\033[0m'
else G=''; R=''; Y=''; D=''; Z=''; fi

# hit METHOD PATH [extra curl args...] -> prints HTTP status, body -> $TMP/body
hit() {
  local method="$1" path="$2"; shift 2
  curl -s -o "$TMP/body" -w '%{http_code}' -X "$method" "$BASE$path" "$@" 2>/dev/null
}

# expect ID DESC EXPECTED_STATUS ACTUAL_STATUS [body-substring]
expect() {
  local id="$1" desc="$2" exp="$3" act="$4" sub="${5:-}" ok=1
  [ "$act" = "$exp" ] || ok=0
  if [ -n "$sub" ] && ! grep -qF -- "$sub" "$TMP/body"; then ok=0; fi
  if [ "$ok" = 1 ]; then
    PASS=$((PASS+1))
    printf '  %s✓%s %-4s %-46s %s%s%s\n' "$G" "$Z" "$id" "$desc" "$D" "$act" "$Z"
  else
    FAIL=$((FAIL+1))
    printf '  %s✗%s %-4s %-46s expected %s%s got %s\n' "$R" "$Z" "$id" "$desc" "$exp" "${sub:+ /\"$sub\"}" "$act"
    printf '      %sbody: %s%s\n' "$D" "$(head -c 180 "$TMP/body" | tr '\n' ' ')" "$Z"
  fi
}

# Fire a path repeatedly until the first 429; echo the 1-based request number
# where it appeared (or "none" within `max`). Used by the opt-in RL cases.
first_429() {
  local method="$1" path="$2" max="$3"; shift 3
  local i s
  for ((i=1; i<=max; i++)); do
    s="$(hit "$method" "$path" "$@")"
    [ "$s" = "429" ] && { echo "$i"; return; }
  done
  echo "none"
}

echo
echo "Signup Flow QA — base: ${Y}${BASE}${Z}"
echo "${D}(reproducing Sign_up_QA_TEST_REPORT.md live cases)${Z}"
echo
echo "CORE cases"

# ── Suite A — email OTP (POST /api/v1/public/auth/*) ─────────────────────────
s=$(hit POST /api/v1/public/auth/send-otp   -H "$CT" -d '{"email":"not-an-email"}')
expect A2  "send-otp malformed email"            400 "$s" "Enter a valid email address."

s=$(hit POST /api/v1/public/auth/send-otp   -H "$CT" -d '{"email":"admin@example.com"}')
expect A3  "send-otp existing account (no send)"  409 "$s"
# NOTE: A3 expects admin@example.com to already exist on the target stack. A 200
# here means the account does NOT exist (an OTP mail would be attempted) — not a
# product bug, just a different DB. example.com (RFC 2606) never routes real mail.

s=$(hit POST /api/v1/public/auth/verify-otp -H "$CT" -d '{"email":"nobody-xyz@example.com","otp":"123456"}')
expect A9x "verify-otp unknown email"            400 "$s" "invalid or has expired"

s=$(hit POST /api/v1/public/auth/verify-otp -H "$CT" -d '{"email":"someone@example.com","otp":"12"}')
expect A11 "verify-otp non-6-digit code"         400 "$s" "6-digit"

# ── Suite C — ingestion /analyze (POST /api/v1/public/register/analyze) ──────
s=$(hit POST /api/v1/public/register/analyze -H "$CT" -d '{"url":"https://example.com"}')
expect C2  "analyze without authorized flag"     400 "$s" "authorized"

# ── Suite D — readiness /preflight-audit ─────────────────────────────────────
s=$(hit POST /api/v1/public/register/preflight-audit -H "$CT" -d '{}')
expect D2  "preflight-audit no pages"            400 "$s" "at least one"

# ── Suite E — account creation /complete ─────────────────────────────────────
# E2: a fully valid-looking body BUT no verified OTP -> 403 (field checks pass
# first, the in-transaction OTP claim fails; no account is created).
E2_BODY='{"companyName":"QA Probe Co","email":"qa-probe-unverified@example.com","password":"supersecret123","industryLabel":"Testing","pages":[{"title":"Home","content":"Welcome to the QA probe company page with sufficient body text."}]}'
s=$(hit POST /api/v1/public/register/complete -H "$CT" -d "$E2_BODY")
expect E2  "complete without verification token" 403 "$s" "EMAIL_NOT_VERIFIED"

s=$(hit POST /api/v1/public/register/complete -H "$CT" -d '{"email":"qa-probe@example.com"}')
expect E6  "complete missing companyName"        400 "$s" "companyName is required"

# ── Suite G — widget install ping (bogus slug + bad key) ─────────────────────
s=$(hit POST /api/v1/tenant-chat/does-not-exist-xyz/ping -H 'X-Tenant-Api-Key: tk_bogus_key')
expect G3  "widget ping bad slug/key"            401 "$s" "Missing or invalid X-Tenant-Api-Key"

# ── Suite K — dashboard routes require a client JWT ──────────────────────────
s=$(hit GET   /api/v1/client/workspace/readiness)
expect K1a "GET  /workspace/readiness (no JWT)"  401 "$s" "Missing token"
s=$(hit GET   /api/v1/client/workspace/api-keys)
expect K1b "GET  /workspace/api-keys (no JWT)"   401 "$s" "Missing token"
s=$(hit GET   /api/v1/client/workspace/install-status)
expect K1c "GET  /workspace/install-status"      401 "$s" "Missing token"
s=$(hit PATCH /api/v1/client/workspace/bot-preference -H "$CT" -d '{}')
expect K1d "PATCH /workspace/bot-preference"     401 "$s" "Missing token"

# ── Opt-in: rate-limit cases (exhaust the windows) ───────────────────────────
if [ "${RUN_RATELIMIT:-0}" = "1" ]; then
  echo
  echo "RATE-LIMIT cases ${Y}(RUN_RATELIMIT=1 — these spend the windows)${Z}"

  n=$(first_429 POST /api/v1/public/register/analyze 10 -H "$CT" -d '{"url":"https://example.com"}')
  [ "$n" != "none" ] && [ "$n" -le 8 ] \
    && { PASS=$((PASS+1)); printf '  %s✓%s C7   analyze IP limit (429 at req #%s, spec ≤8)\n' "$G" "$Z" "$n"; } \
    || { FAIL=$((FAIL+1)); printf '  %s✗%s C7   analyze IP limit (got: %s, spec 429 by #8)\n' "$R" "$Z" "$n"; }

  n=$(first_429 POST /api/v1/public/register/preflight-audit 14 -H "$CT" -d '{}')
  [ "$n" != "none" ] && [ "$n" -le 12 ] \
    && { PASS=$((PASS+1)); printf '  %s✓%s D3   preflight IP limit (429 at req #%s, spec ≤12)\n' "$G" "$Z" "$n"; } \
    || { FAIL=$((FAIL+1)); printf '  %s✗%s D3   preflight IP limit (got: %s, spec 429 by #12)\n' "$R" "$Z" "$n"; }

  # complete: 3/hr, and CORE already spent 2 — so expect the 429 very soon.
  n=$(first_429 POST /api/v1/public/register/complete 4 -H "$CT" -d '{"email":"qa-rl@example.com"}')
  [ "$n" != "none" ] \
    && { PASS=$((PASS+1)); printf '  %s✓%s E7   complete IP limit (429 at req #%s; 3/hr, rejects counted)\n' "$G" "$Z" "$n"; } \
    || { FAIL=$((FAIL+1)); printf '  %s✗%s E7   complete IP limit (no 429 in 4 tries — window may be fresh)\n' "$R" "$Z"; }
fi

echo
echo "────────────────────────────────────────────"
printf 'Result: %s%d passed%s, %s%d failed%s\n' "$G" "$PASS" "$Z" "$([ "$FAIL" -gt 0 ] && echo "$R")" "$FAIL" "$Z"
echo
[ "$FAIL" -eq 0 ]
