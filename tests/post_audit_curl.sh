#!/usr/bin/env bash
# Post-audit curl smoke — exercises every endpoint added since the audit.
#
# Covers:
#   - Plan Adherence              (#12)
#   - Proactive Digest            (#13)
#   - Performance Attribution     (#14)
#   - Email notifications toggles (#16)
#   - Founder dashboard gate      (#17)
#   - Onboarding welcome moment   (#18)
#   - A/B prompt experiments      (#19, via welcome + ai-feedback)
#
# Usage:
#   1. Start server:    npm run server
#   2. Run this script: bash tests/post_audit_curl.sh
#
# Creates ONE test user against your real Supabase, runs assertions against
# the new endpoints, and deletes the user at the end (even on failure).
# Test email: post-audit-{timestamp}@outpost-audit.invalid
#
# Anthropic usage: 1 call (the welcome moment, ~$0.001).
# Resend usage: zero.
# Total runtime: ~30 seconds.

BASE="${BASE:-http://localhost:3001}"
TS=$(date +%s)
EMAIL="post-audit-${TS}@outpost-audit.invalid"
PW="Password1"

# Colors (avoid single-letter names — `R` collides with the curl-response var)
G='\033[0;32m'; RED='\033[0;31m'; Y='\033[0;33m'; D='\033[0;90m'; N='\033[0m'

PASSED=0
FAILED=0
FAIL_LINES=()

# ----------------------- Helpers -----------------------

req() {
  local method="$1"; local path="$2"; local body="${3:-}"; local token="${4:-}"
  local args=(-s -w "|%{http_code}" -X "$method" "$BASE$path" --max-time 20)
  if [ -n "$body" ]; then args+=(-H "Content-Type: application/json" -d "$body"); fi
  if [ -n "$token" ]; then args+=(-H "Authorization: Bearer $token"); fi
  curl "${args[@]}" 2>/dev/null
}

status_of() { echo "$1" | awk -F'|' '{print $NF}'; }
body_of()   { echo "$1" | sed 's/|[0-9]*$//'; }

jget() { echo "$1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$2','') if isinstance(d, dict) else '')" 2>/dev/null; }

nested_jget() {
  echo "$1" | python3 -c "
import json, sys
d = json.load(sys.stdin)
v = d.get('$2', {}) if isinstance(d, dict) else {}
print(v.get('$3', '') if isinstance(v, dict) else '')
" 2>/dev/null
}

# Check that a JSON body has a top-level key (any value).
has_key() {
  echo "$1" | python3 -c "
import json, sys
try: d = json.load(sys.stdin)
except: sys.exit(1)
sys.exit(0 if isinstance(d, dict) and '$2' in d else 1)
" 2>/dev/null
}

assert_eq() {
  local name="$1"; local actual="$2"; local expected="$3"
  if [ "$actual" = "$expected" ]; then
    PASSED=$((PASSED+1))
    echo -e "  ${G}PASS${N} $name"
  else
    FAILED=$((FAILED+1))
    FAIL_LINES+=("$name: expected '$expected', got '$actual'")
    echo -e "  ${RED}FAIL${N} $name (expected '$expected', got '$actual')"
  fi
}

assert_status() {
  local name="$1"; local resp="$2"; local expected="$3"
  local got; got=$(status_of "$resp")
  assert_eq "$name → HTTP $expected" "$got" "$expected"
}

assert_has_key() {
  local name="$1"; local body="$2"; local key="$3"
  if has_key "$body" "$key"; then
    PASSED=$((PASSED+1))
    echo -e "  ${G}PASS${N} $name"
  else
    FAILED=$((FAILED+1))
    FAIL_LINES+=("$name: response missing key '$key'")
    echo -e "  ${RED}FAIL${N} $name (missing key '$key')"
    echo -e "    ${D}body: $(echo "$body" | head -c 200)${N}"
  fi
}

# Cleanup runs even on failure
TOKEN=""
cleanup() {
  echo ""
  echo -e "${D}--- Cleanup ---${N}"
  if [ -n "$TOKEN" ]; then
    req DELETE /api/settings/account "{\"password\":\"$PW\"}" "$TOKEN" > /dev/null
    echo "  user deleted"
  fi
}
trap cleanup EXIT

# ----------------------- Server reachable? -----------------------

echo -e "${D}Checking $BASE/api/health...${N}"
HEALTH=$(req GET /api/health)
HCODE=$(status_of "$HEALTH")
if [ "$HCODE" != "200" ] && [ "$HCODE" != "503" ]; then
  echo -e "${RED}Server not responding at $BASE${N}"
  echo "Start it with: npm run server"
  exit 2
fi
echo -e "${G}Server up${N} (health: $HCODE)\n"

# ============================================================
echo -e "${Y}=== Setup — sign up test user ===${N}"
# ============================================================

R=$(req POST /api/auth/signup "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"displayName\":\"Post-Audit\"}")
assert_status "[setup] signup" "$R" "200"
TOKEN=$(jget "$(body_of "$R")" "token")
if [ -z "$TOKEN" ]; then
  echo -e "${RED}No token returned — aborting${N}"
  exit 1
fi

# ============================================================
echo -e "\n${Y}=== Plan Adherence (#12) ===${N}"
# ============================================================

R=$(req GET /api/portfolio/plan-adherence "" "$TOKEN")
assert_status "[12.1] /plan-adherence reachable" "$R" "200"
BODY=$(body_of "$R")
# With 0 closed trades, the endpoint still returns 200 with an empty / "needs more data" shape
assert_has_key "[12.2] response has 'summary' or 'message'" "$BODY" "summary"

# ============================================================
echo -e "\n${Y}=== Performance Attribution (#14) ===${N}"
# ============================================================

R=$(req GET /api/portfolio/performance-attribution "" "$TOKEN")
assert_status "[14.1] /performance-attribution reachable" "$R" "200"
BODY=$(body_of "$R")
assert_has_key "[14.2] response has styles bucket" "$BODY" "styles"

# ============================================================
echo -e "\n${Y}=== Proactive Digest (#13) ===${N}"
# ============================================================

R=$(req GET /api/ai/proactive-digest "" "$TOKEN")
assert_status "[13.1] /proactive-digest reachable" "$R" "200"
BODY=$(body_of "$R")
# With no positions, expect available=false or quiet=true — both are valid empty states
AVAIL=$(jget "$BODY" "available")
QUIET=$(jget "$BODY" "quiet")
if [ "$AVAIL" = "False" ] || [ "$AVAIL" = "false" ] || [ "$QUIET" = "True" ] || [ "$QUIET" = "true" ]; then
  PASSED=$((PASSED+1))
  echo -e "  ${G}PASS${N} [13.2] empty-portfolio path returns valid empty state"
else
  # Also acceptable: digest text present (Claude may have responded to bare context)
  if has_key "$BODY" "digest"; then
    PASSED=$((PASSED+1))
    echo -e "  ${G}PASS${N} [13.2] digest response shape valid"
  else
    FAILED=$((FAILED+1))
    FAIL_LINES+=("[13.2] unexpected proactive-digest shape")
    echo -e "  ${RED}FAIL${N} [13.2] unexpected response shape: $(echo "$BODY" | head -c 200)"
  fi
fi

# ============================================================
echo -e "\n${Y}=== Email notification toggles (#16) ===${N}"
# ============================================================

# Default should be true (column default in migration 009)
R=$(req GET /api/auth/validate "" "$TOKEN")
DEFAULT_DAILY=$(echo "$(body_of "$R")" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('user',{}).get('email_daily_digest'))" 2>/dev/null)
DEFAULT_WEEKLY=$(echo "$(body_of "$R")" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('user',{}).get('email_weekly_summary'))" 2>/dev/null)
assert_eq "[16.1] daily digest defaults true" "$DEFAULT_DAILY" "True"
assert_eq "[16.2] weekly summary defaults true" "$DEFAULT_WEEKLY" "True"

# Flip both to false
R=$(req PATCH /api/settings/user '{"email_daily_digest":false,"email_weekly_summary":false}' "$TOKEN")
assert_status "[16.3] PATCH user accepts new toggle fields" "$R" "200"

# Verify they round-tripped
R=$(req GET /api/auth/validate "" "$TOKEN")
NEW_DAILY=$(echo "$(body_of "$R")" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('user',{}).get('email_daily_digest'))" 2>/dev/null)
NEW_WEEKLY=$(echo "$(body_of "$R")" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('user',{}).get('email_weekly_summary'))" 2>/dev/null)
assert_eq "[16.4] daily digest persisted as false" "$NEW_DAILY" "False"
assert_eq "[16.5] weekly summary persisted as false" "$NEW_WEEKLY" "False"

# ============================================================
echo -e "\n${Y}=== Founder dashboard gate (#17) ===${N}"
# ============================================================

# Test user's email is .invalid → should NEVER be in FOUNDER_EMAILS
R=$(req GET /api/admin/check "" "$TOKEN")
assert_status "[17.1] /admin/check reachable for any authed user" "$R" "200"
ADMIN=$(jget "$(body_of "$R")" "admin")
assert_eq "[17.2] non-admin → admin:false" "$ADMIN" "False"

# Dashboard should reject non-admins. Accepts either:
#   - 404 when FOUNDER_EMAILS is set but the user isn't on it (preferred — not enumerable)
#   - 403 when FOUNDER_EMAILS env var is unset entirely (fail-closed default)
R=$(req GET /api/admin/dashboard "" "$TOKEN")
CODE=$(status_of "$R")
if [ "$CODE" = "404" ] || [ "$CODE" = "403" ]; then
  PASSED=$((PASSED+1))
  if [ "$CODE" = "403" ]; then
    echo -e "  ${G}PASS${N} [17.3] /admin/dashboard rejects non-admin (HTTP 403 — FOUNDER_EMAILS unset, fail-closed)"
  else
    echo -e "  ${G}PASS${N} [17.3] /admin/dashboard rejects non-admin (HTTP 404 — gate working)"
  fi
else
  FAILED=$((FAILED+1))
  FAIL_LINES+=("[17.3] expected 404 or 403, got $CODE")
  echo -e "  ${RED}FAIL${N} [17.3] expected 404 or 403, got $CODE"
fi

# Without auth header, should still be 401 (auth required)
R=$(req GET /api/admin/dashboard "" "")
assert_status "[17.4] /admin/dashboard requires auth" "$R" "401"

# ============================================================
echo -e "\n${Y}=== Welcome moment (#18) + Variant assignment (#19) ===${N}"
# ============================================================

R=$(req POST /api/ai/welcome '{"style":"swing","risk_tolerance":"moderate","assets":["stocks"]}' "$TOKEN")
assert_status "[18.1] POST /ai/welcome returns 200" "$R" "200"
BODY=$(body_of "$R")
MSG=$(jget "$BODY" "message")
VARIANT=$(jget "$BODY" "variant")
if [ -n "$MSG" ] && [ ${#MSG} -gt 30 ]; then
  PASSED=$((PASSED+1))
  echo -e "  ${G}PASS${N} [18.2] welcome message present (${#MSG} chars)"
else
  FAILED=$((FAILED+1))
  FAIL_LINES+=("[18.2] welcome message missing or too short")
  echo -e "  ${RED}FAIL${N} [18.2] welcome message missing or too short: '$MSG'"
fi

# Variant id must be one of the registered arms
case "$VARIANT" in
  baseline|mentor|concise)
    PASSED=$((PASSED+1))
    echo -e "  ${G}PASS${N} [19.1] variant id valid ('$VARIANT')"
    ;;
  *)
    FAILED=$((FAILED+1))
    FAIL_LINES+=("[19.1] variant id unexpected: '$VARIANT'")
    echo -e "  ${RED}FAIL${N} [19.1] variant id unexpected: '$VARIANT'"
    ;;
esac

# Stickiness: a second call must return the same variant
R=$(req POST /api/ai/welcome '{"style":"swing","risk_tolerance":"moderate","assets":["stocks"]}' "$TOKEN")
VARIANT2=$(jget "$(body_of "$R")" "variant")
assert_eq "[19.2] variant sticky across calls" "$VARIANT2" "$VARIANT"

# Cache hit on second call
CACHED=$(jget "$(body_of "$R")" "cached")
if [ "$CACHED" = "True" ] || [ "$CACHED" = "true" ]; then
  PASSED=$((PASSED+1))
  echo -e "  ${G}PASS${N} [18.3] second call hits cache (no extra Claude burn)"
else
  # Not strictly required but worth flagging if the cache key changed
  echo -e "  ${Y}WARN${N} [18.3] second call did not hit cache — cached=$CACHED"
fi

# ============================================================
echo -e "\n${Y}=== AI feedback with variant (#19) ===${N}"
# ============================================================

R=$(req POST /api/settings/ai-feedback "{\"feature\":\"welcome\",\"rating\":\"up\",\"variant\":\"$VARIANT\",\"responsePreview\":\"test feedback from curl\"}" "$TOKEN")
assert_status "[19.3] /ai-feedback accepts variant field" "$R" "200"

# Bad rating should still be rejected
R=$(req POST /api/settings/ai-feedback '{"feature":"welcome","rating":"sideways"}' "$TOKEN")
# Either 400 (sanitizeEnum returns null and we 500 OR validate it as missing) — both acceptable as "not 200 with success:true"
CODE=$(status_of "$R")
if [ "$CODE" != "200" ]; then
  PASSED=$((PASSED+1))
  echo -e "  ${G}PASS${N} [19.4] invalid rating rejected (HTTP $CODE)"
else
  FAILED=$((FAILED+1))
  FAIL_LINES+=("[19.4] invalid rating accepted (200)")
  echo -e "  ${RED}FAIL${N} [19.4] invalid rating accepted (200)"
fi

# ============================================================
echo -e "\n${Y}=== Summary ===${N}"
# ============================================================

TOTAL=$((PASSED + FAILED))
echo "  Passed: ${G}${PASSED}${N} / $TOTAL"
if [ "$FAILED" -gt 0 ]; then
  echo "  Failed: ${RED}${FAILED}${N}"
  echo ""
  for line in "${FAIL_LINES[@]}"; do echo "    - $line"; done
  exit 1
fi
echo ""
echo -e "${G}All post-audit endpoints look good.${N}"
exit 0
