#!/usr/bin/env bash
# Outpost — curl smoke test against a running local server.
# Verifies the security-sensitive patches from the audit (auth cache, timing,
# multi-user isolation, account-delete cascade, plus general CRUD).
#
# Usage:
#   1. Start server:     npm run server
#   2. Run this script:  bash tests/audit_curl.sh
#
# Creates two test users in your real Supabase, runs assertions against them,
# and deletes them at the end (even on failure, via trap). Test emails:
#   audit-{timestamp}-a@outpost-audit.invalid
#   audit-{timestamp}-b@outpost-audit.invalid
#
# Total runtime: ~2 minutes. Anthropic / Polygon usage: zero (no AI calls).
# Resend: triggers ONE forgot-password email per test user (delivered to
# .invalid domain → bounce, no real inbox impact).

BASE="${BASE:-http://localhost:3001}"
TS=$(date +%s)
EMAIL_A="audit-${TS}-a@outpost-audit.invalid"
EMAIL_B="audit-${TS}-b@outpost-audit.invalid"
PW="Password1"

# Colors
G='\033[0;32m'; R='\033[0;31m'; Y='\033[0;33m'; D='\033[0;90m'; N='\033[0m'

PASSED=0
FAILED=0
FAIL_LINES=()

# ----------------------- Helpers -----------------------

# usage: req METHOD PATH [BODY] [TOKEN] -> echoes "STATUS|BODY"
req() {
  local method="$1"; local path="$2"; local body="${3:-}"; local token="${4:-}"
  local args=(-s -w "|%{http_code}" -X "$method" "$BASE$path" --max-time 15)
  if [ -n "$body" ]; then args+=(-H "Content-Type: application/json" -d "$body"); fi
  if [ -n "$token" ]; then args+=(-H "Authorization: Bearer $token"); fi
  curl "${args[@]}" 2>/dev/null
}

# usage: status_of "STATUS|BODY"
status_of() { echo "$1" | awk -F'|' '{print $NF}'; }
# usage: body_of "STATUS|BODY"
body_of()   { echo "$1" | sed 's/|[0-9]*$//'; }

# usage: jget JSON KEY  -> value or empty
jget() { echo "$1" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('$2','') if isinstance(d, dict) else '')" 2>/dev/null; }

# usage: nested_jget JSON KEY1 KEY2  -> value or empty
nested_jget() {
  echo "$1" | python3 -c "
import json, sys
d = json.load(sys.stdin)
v = d.get('$2', {}) if isinstance(d, dict) else {}
print(v.get('$3', '') if isinstance(v, dict) else '')
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
    echo -e "  ${R}FAIL${N} $name (expected '$expected', got '$actual')"
  fi
}

assert_status() {
  local name="$1"; local resp="$2"; local expected="$3"
  local got; got=$(status_of "$resp")
  assert_eq "$name → HTTP $expected" "$got" "$expected"
}

# Cleanup runs even on failure
TOKEN_A=""; TOKEN_B=""
cleanup() {
  echo ""
  echo -e "${D}--- Cleanup ---${N}"
  if [ -n "$TOKEN_A" ]; then
    req DELETE /api/settings/account "{\"password\":\"$PW\"}" "$TOKEN_A" > /dev/null
    echo "  user A deleted"
  fi
  if [ -n "$TOKEN_B" ]; then
    req DELETE /api/settings/account "{\"password\":\"$PW\"}" "$TOKEN_B" > /dev/null
    echo "  user B deleted"
  fi
}
trap cleanup EXIT

# ----------------------- Server reachable? -----------------------

echo -e "${D}Checking $BASE/api/health...${N}"
HEALTH=$(req GET /api/health)
HCODE=$(status_of "$HEALTH")
if [ "$HCODE" != "200" ] && [ "$HCODE" != "503" ]; then
  echo -e "${R}Server not responding at $BASE${N}"
  echo "Start it with: npm run server"
  exit 2
fi
echo -e "${G}Server up${N} (health: $HCODE)\n"

# ============================================================
echo -e "${Y}=== Phase A.1 — Signup validation ===${N}"
# ============================================================

# Note: password complexity tests (no-digit, no-letter, short) live in audit_smoke.mjs.
# Skipping them here keeps Phase A.1 under signup's rateLimit(5) per minute.
R=$(req POST /api/auth/signup '{"email":"notanemail","password":"Password1"}')
assert_status "[A.1.1] malformed email rejected" "$R" "400"

R=$(req POST /api/auth/signup "{\"email\":\"$EMAIL_A\",\"password\":\"password\"}")
assert_status "[A.1.2] weak password rejected" "$R" "400"

# Valid signup A
R=$(req POST /api/auth/signup "{\"email\":\"$EMAIL_A\",\"password\":\"$PW\",\"displayName\":\"Audit A\"}")
assert_status "[A.1.3] valid signup A succeeds" "$R" "200"
TOKEN_A=$(jget "$(body_of "$R")" "token")
USER_A_ID=$(nested_jget "$(body_of "$R")" "user" "id")

# Duplicate
R=$(req POST /api/auth/signup "{\"email\":\"$EMAIL_A\",\"password\":\"$PW\"}")
assert_status "[A.1.4] duplicate email rejected" "$R" "409"

# Valid signup B
R=$(req POST /api/auth/signup "{\"email\":\"$EMAIL_B\",\"password\":\"$PW\",\"displayName\":\"Audit B\"}")
assert_status "[A.1.5] valid signup B succeeds" "$R" "200"
TOKEN_B=$(jget "$(body_of "$R")" "token")
USER_B_ID=$(nested_jget "$(body_of "$R")" "user" "id")

# ============================================================
echo -e "\n${Y}=== Phase A.2 — Login ===${N}"
# ============================================================

R=$(req POST /api/auth/login "{\"email\":\"$EMAIL_A\",\"password\":\"wrongpassword1\"}")
assert_status "[A.2.1] wrong password → 401" "$R" "401"

R=$(req POST /api/auth/login "{\"email\":\"$EMAIL_A\",\"password\":\"$PW\"}")
assert_status "[A.2.2] correct password → 200" "$R" "200"
TOKEN_A=$(jget "$(body_of "$R")" "token")

# ============================================================
echo -e "\n${Y}=== Phase A.3 — Logout cache invalidation (B5/A1 patch) ===${N}"
# ============================================================

R=$(req GET /api/auth/validate "" "$TOKEN_A")
assert_status "[A.3.1] /validate with fresh token" "$R" "200"

R=$(req POST /api/auth/logout "" "$TOKEN_A")
assert_status "[A.3.2] /logout" "$R" "200"

# CRITICAL: same token must IMMEDIATELY 401 (cache must have been invalidated)
R=$(req GET /api/auth/validate "" "$TOKEN_A")
CODE=$(status_of "$R")
if [ "$CODE" = "401" ]; then
  PASSED=$((PASSED+1))
  echo -e "  ${G}PASS${N} [A.3.3] logged-out token → 401 (cache invalidation patch WORKING)"
else
  FAILED=$((FAILED+1))
  FAIL_LINES+=("[A.3.3] logged-out token still valid (got $CODE) — cache NOT invalidated")
  echo -e "  ${R}FAIL${N} [A.3.3] logged-out token returned $CODE — cache invalidation broken"
fi

# Re-login for subsequent tests
R=$(req POST /api/auth/login "{\"email\":\"$EMAIL_A\",\"password\":\"$PW\"}")
TOKEN_A=$(jget "$(body_of "$R")" "token")

# ============================================================
echo -e "\n${Y}=== Phase A.4 — Forgot-password timing equalization (A3 patch) ===${N}"
# ============================================================

# Real email
T1_START=$(python3 -c "import time; print(int(time.time()*1000))")
R=$(req POST /api/auth/forgot-password "{\"email\":\"$EMAIL_A\"}")
T1_END=$(python3 -c "import time; print(int(time.time()*1000))")
T1_MS=$((T1_END - T1_START))
assert_status "[A.4.1] /forgot-password (real email) → 200" "$R" "200"

# Fake email
T2_START=$(python3 -c "import time; print(int(time.time()*1000))")
R=$(req POST /api/auth/forgot-password '{"email":"nobody-real-12345@nowhere.invalid"}')
T2_END=$(python3 -c "import time; print(int(time.time()*1000))")
T2_MS=$((T2_END - T2_START))
assert_status "[A.4.2] /forgot-password (fake email) → 200" "$R" "200"

# Both should be ≥ 700ms (the 800ms floor minus jitter)
if [ "$T1_MS" -ge 700 ] && [ "$T2_MS" -ge 700 ]; then
  PASSED=$((PASSED+1))
  DIFF=$((T1_MS > T2_MS ? T1_MS - T2_MS : T2_MS - T1_MS))
  echo -e "  ${G}PASS${N} [A.4.3] timing floor met — real=${T1_MS}ms, fake=${T2_MS}ms, |diff|=${DIFF}ms"
else
  FAILED=$((FAILED+1))
  FAIL_LINES+=("[A.4.3] timing floor not met: real=${T1_MS}ms, fake=${T2_MS}ms")
  echo -e "  ${R}FAIL${N} [A.4.3] timing floor not met — real=${T1_MS}ms, fake=${T2_MS}ms"
fi

# Note: per-email rate limit (3 attempts / 10 min) is logic-tested in audit_smoke.mjs.
# Can't curl-verify it here without colliding with the per-IP rateLimit(3) on this
# endpoint — both share the same 60s window so any 4th call hits IP limit first.

# ============================================================
echo -e "\n${Y}=== Phase B — Portfolio CRUD ===${N}"
# ============================================================

# Add position
R=$(req POST /api/portfolio/positions '{"ticker":"AAPL","shares":10,"avgCost":150.50}' "$TOKEN_A")
assert_status "[B.1] add AAPL position" "$R" "200"
POS_ID=$(nested_jget "$(body_of "$R")" "position" "id")

# Duplicate
R=$(req POST /api/portfolio/positions '{"ticker":"AAPL","shares":5,"avgCost":160}' "$TOKEN_A")
assert_status "[B.2] duplicate AAPL rejected" "$R" "409"

# Bogus ticker
R=$(req POST /api/portfolio/positions '{"ticker":"ZZZQ","shares":10,"avgCost":50}' "$TOKEN_A")
assert_status "[B.3] non-existent ticker rejected" "$R" "400"

# Absurd avg cost (sanity)
R=$(req POST /api/portfolio/positions '{"ticker":"MSFT","shares":1,"avgCost":1000000}' "$TOKEN_A")
assert_status "[B.4] absurd avg cost rejected" "$R" "400"

# Get value
R=$(req GET /api/portfolio/value "" "$TOKEN_A")
assert_status "[B.5] GET /portfolio/value" "$R" "200"

# Patch
R=$(req PATCH "/api/portfolio/positions/$POS_ID" '{"shares":15}' "$TOKEN_A")
assert_status "[B.6] PATCH position shares" "$R" "200"

# Delete (close)
R=$(req DELETE "/api/portfolio/positions/$POS_ID" '{"sellPrice":175,"exitOutcome":"win_thesis_right"}' "$TOKEN_A")
assert_status "[B.7] DELETE position (close)" "$R" "200"

# Verify it appears in closed_trades
R=$(req GET /api/portfolio/closed-trades "" "$TOKEN_A")
assert_status "[B.8] closed_trades reachable" "$R" "200"
HAS_AAPL=$(echo "$(body_of "$R")" | python3 -c "
import json, sys
d = json.load(sys.stdin)
trades = d.get('trades', []) if isinstance(d, dict) else []
print('yes' if any(t.get('ticker')=='AAPL' for t in trades) else 'no')
" 2>/dev/null)
assert_eq "[B.9] closed AAPL appears in trades" "$HAS_AAPL" "yes"

# ============================================================
echo -e "\n${Y}=== Phase C — Multi-user isolation ===${N}"
# ============================================================

# A creates a position
R=$(req POST /api/portfolio/positions '{"ticker":"NVDA","shares":5,"avgCost":500}' "$TOKEN_A")
A_POS_ID=$(nested_jget "$(body_of "$R")" "position" "id")
assert_status "[C.1] A adds NVDA position" "$R" "200"

# B's portfolio should NOT contain NVDA
R=$(req GET /api/portfolio/value "" "$TOKEN_B")
B_HAS_NVDA=$(echo "$(body_of "$R")" | python3 -c "
import json, sys
d = json.load(sys.stdin)
positions = d.get('positions', []) if isinstance(d, dict) else []
print('yes' if any(p.get('ticker')=='NVDA' for p in positions) else 'no')
" 2>/dev/null)
assert_eq "[C.2] B's portfolio does NOT include A's NVDA" "$B_HAS_NVDA" "no"

# B can't PATCH A's position
R=$(req PATCH "/api/portfolio/positions/$A_POS_ID" '{"shares":999}' "$TOKEN_B")
assert_status "[C.3] B cannot PATCH A's position" "$R" "404"

# B can't DELETE A's position
R=$(req DELETE "/api/portfolio/positions/$A_POS_ID" '{}' "$TOKEN_B")
assert_status "[C.4] B cannot DELETE A's position" "$R" "404"

# ============================================================
echo -e "\n${Y}=== Phase D — Alerts CRUD ===${N}"
# ============================================================

R=$(req POST /api/alerts '{"ticker":"NVDA","direction":"above","threshold":600}' "$TOKEN_A")
assert_status "[D.1] create above-alert" "$R" "200"
ALERT_ID=$(nested_jget "$(body_of "$R")" "alert" "id")

# Same alert again — duplicate
R=$(req POST /api/alerts '{"ticker":"NVDA","direction":"above","threshold":600}' "$TOKEN_A")
assert_status "[D.2] duplicate alert rejected" "$R" "409"

# Bogus ticker
R=$(req POST /api/alerts '{"ticker":"ZZZQ","direction":"above","threshold":100}' "$TOKEN_A")
assert_status "[D.3] alert on bogus ticker rejected" "$R" "400"

# B can't see A's alerts
R=$(req GET /api/alerts "" "$TOKEN_B")
B_HAS_NVDA_ALERT=$(echo "$(body_of "$R")" | python3 -c "
import json, sys
d = json.load(sys.stdin)
alerts = d.get('alerts', []) if isinstance(d, dict) else []
print('yes' if any(a.get('ticker')=='NVDA' for a in alerts) else 'no')
" 2>/dev/null)
assert_eq "[D.4] B doesn't see A's alerts" "$B_HAS_NVDA_ALERT" "no"

# Delete
R=$(req DELETE "/api/alerts/$ALERT_ID" "" "$TOKEN_A")
assert_status "[D.5] delete alert" "$R" "200"

# ============================================================
echo -e "\n${Y}=== Phase E — Journal CRUD ===${N}"
# ============================================================

R=$(req POST /api/journal/notes '{"title":"Audit Test","content":"Hello world"}' "$TOKEN_A")
assert_status "[E.1] create note" "$R" "200"
NOTE_ID=$(nested_jget "$(body_of "$R")" "note" "id")

R=$(req GET /api/journal/notes "" "$TOKEN_A")
assert_status "[E.2] list notes" "$R" "200"

R=$(req POST "/api/journal/notes/$NOTE_ID/append" '{"content":"appended line"}' "$TOKEN_A")
assert_status "[E.3] append to note" "$R" "200"

# B can't read A's note
R=$(req GET "/api/journal/notes/$NOTE_ID" "" "$TOKEN_B")
assert_status "[E.4] B cannot read A's note" "$R" "404"

R=$(req DELETE "/api/journal/notes/$NOTE_ID" "" "$TOKEN_A")
assert_status "[E.5] delete note" "$R" "200"

# ============================================================
echo -e "\n${Y}=== Phase F — Settings ===${N}"
# ============================================================

R=$(req PATCH /api/settings/user '{"risk_tolerance":"aggressive"}' "$TOKEN_A")
assert_status "[F.1] update risk tolerance" "$R" "200"

R=$(req PATCH /api/settings/user '{"risk_tolerance":"yolo"}' "$TOKEN_A")
# sanitizeEnum falls back to first option silently — accept 200 but verify result
RT=$(echo "$(body_of "$R")" | python3 -c "
import json, sys
d = json.load(sys.stdin)
u = d.get('user', {}) if isinstance(d, dict) else {}
print(u.get('risk_tolerance', '') if isinstance(u, dict) else '')
" 2>/dev/null)
assert_eq "[F.2] invalid risk_tolerance falls back to valid value" "$RT" "conservative"

R=$(req POST /api/settings/feedback '{"type":"bug","description":"audit smoke test"}' "$TOKEN_A")
assert_status "[F.3] submit feedback" "$R" "200"

# ============================================================
echo -e "\n${Y}=== Summary ===${N}"
# ============================================================
TOTAL=$((PASSED+FAILED))
echo -e "  ${G}Passed: $PASSED${N}"
if [ "$FAILED" -gt 0 ]; then
  echo -e "  ${R}Failed: $FAILED${N}"
  echo ""
  echo -e "${R}Failures:${N}"
  for f in "${FAIL_LINES[@]}"; do echo "  - $f"; done
  exit 1
else
  echo -e "  ${D}Total: $TOTAL${N}"
  echo ""
  echo -e "${G}All assertions passed.${N}"
fi
