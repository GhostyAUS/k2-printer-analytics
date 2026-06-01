#!/bin/bash
set -euo pipefail
echo "=== K2 Printer Analytics Smoke Test ==="

PASS=0
FAIL=0

SSH_CMD="ssh root@192.168.1.248"

get_token() {
    $SSH_CMD 'pct exec 104 -- docker exec k2-printer-analytics-backend-1 python3 -c "from app.core.auth import create_access_token; print(create_access_token({\"sub\":\"clint\",\"is_admin\":True}))"' 2>/dev/null | head -1 | tr -d '[:space:]'
}

echo "--- Auth ---"
TOKEN=$(get_token)
if [ -n "$TOKEN" ]; then echo "  ✓ Token obtained"; PASS=$((PASS+1)); else echo "  ✗ No token"; FAIL=$((FAIL+1)); exit 1; fi

echo ""
echo "--- Backend Health ---"
h=$($SSH_CMD "pct exec 104 -- curl -s -o /dev/null -w '%{http_code}' -m 5 http://localhost:8000/api/v1/health" 2>/dev/null)
[ "$h" = "200" ] && { echo "  ✓ Health → $h"; PASS=$((PASS+1)); } || { echo "  ✗ Health → $h"; FAIL=$((FAIL+1)); }

echo ""
echo "--- OFD Endpoints ---"
for ep in "/api/v1/ofd/brands" "/api/v1/ofd/materials" "/api/v1/ofd/search?limit=5" "/api/v1/ofd/search?search=Creality&limit=5"; do
    name=$(echo "$ep" | sed 's|/api/v1/||' | sed 's|?.*||')
    s=$($SSH_CMD "pct exec 104 -- curl -s -o /dev/null -w '%{http_code}' -m 5 -H 'Authorization: Bearer $TOKEN' 'http://localhost:8000$ep'" 2>/dev/null)
    [ "$s" = "200" ] && { echo "  ✓ $name → $s"; PASS=$((PASS+1)); } || { echo "  ✗ $name → $s"; FAIL=$((FAIL+1)); }
done

bc=$($SSH_CMD "pct exec 104 -- bash -c 'TOKEN=\$(docker exec k2-printer-analytics-backend-1 python3 -c \"from app.core.auth import create_access_token; print(create_access_token({\\\"sub\\\":\\\"clint\\\",\\\"is_admin\\\":True}))\") && curl -s -m 5 -H \"Authorization: Bearer \$TOKEN\" http://localhost:8000/api/v1/ofd/brands | python3 -c \"import sys,json;print(len(json.load(sys.stdin)))\"'" 2>/dev/null)
echo "  Brands: $bc"
[ "${bc:-0}" -ge 100 ] 2>/dev/null && { echo "  ✓ Brand count healthy"; PASS=$((PASS+1)); } || { echo "  ✗ Brand count low"; FAIL=$((FAIL+1)); }

echo ""
echo "--- System Endpoints ---"
for ep in "/api/v1/system/printer-status" "/api/v1/printer/stats" "/api/v1/cfs/state"; do
    name=$(echo "$ep" | sed 's|/api/v1/||' | sed 's|?.*||')
    s=$($SSH_CMD "pct exec 104 -- curl -s -o /dev/null -w '%{http_code}' -m 5 -H 'Authorization: Bearer $TOKEN' 'http://localhost:8000$ep'" 2>/dev/null)
    [ "$s" = "200" ] && { echo "  ✓ $name → $s"; PASS=$((PASS+1)); } || { echo "  ✗ $name → $s"; FAIL=$((FAIL+1)); }
done

echo ""
echo "--- Frontend ---"
s=$($SSH_CMD "pct exec 104 -- curl -s -o /dev/null -w '%{http_code}' -m 5 http://localhost:3000/" 2>/dev/null)
[ "$s" = "200" ] && { echo "  ✓ Frontend → $s"; PASS=$((PASS+1)); } || { echo "  ✗ Frontend → $s"; FAIL=$((FAIL+1)); }

echo ""
echo "================================"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "================================"
[ "$FAIL" -eq 0 ] && echo "All smoke tests passed!" || echo "Some tests failed."
