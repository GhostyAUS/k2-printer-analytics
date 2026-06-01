#!/bin/bash
set -euo pipefail

API_BASE="${1:-http://localhost:8000}"
TOKEN="${2:-}"

if [ -z "$TOKEN" ]; then
    echo "Usage: $0 <api_base_url> <auth_token>"
    echo "  Get token from browser localStorage: k2_token"
    echo "  Example: $0 http://localhost:8000 eyJ..."
    exit 1
fi

AUTH="Authorization: Bearer $TOKEN"
PASS=0
FAIL=0

check() {
    local desc="$1" url="$2" expect="$3"
    local status
    status=$(curl -s -o /dev/null -w "%{http_code}" -m 10 -H "$AUTH" "$url")
    if [ "$status" = "$expect" ]; then
        echo "  ✓ $desc → $status"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $desc → $status (expected $expect)"
        FAIL=$((FAIL + 1))
    fi
}

check_body() {
    local desc="$1" url="$2" expect_key="$3"
    local body
    body=$(curl -s -m 10 -H "$AUTH" "$url")
    if echo "$body" | python3 -c "import sys,json; d=json.load(sys.stdin); assert '$expect_key' in str(d)" 2>/dev/null; then
        echo "  ✓ $desc → contains $expect_key"
        PASS=$((PASS + 1))
    else
        echo "  ✗ $desc → missing $expect_key"
        FAIL=$((FAIL + 1))
    fi
}

echo "=== OFD Endpoints ==="
check "GET /ofd/brands" "$API_BASE/api/v1/ofd/brands" "200"
check "GET /ofd/materials" "$API_BASE/api/v1/ofd/materials" "200"
check "GET /ofd/search" "$API_BASE/api/v1/ofd/search?limit=5" "200"
check "GET /ofd/search with brand_id" "$API_BASE/api/v1/ofd/search?brand_id=test&limit=5" "200"
check "GET /ofd/search with material" "$API_BASE/api/v1/ofd/search?material=PLA&limit=5" "200"
check "GET /ofd/search with search" "$API_BASE/api/v1/ofd/search?search=Creality&limit=5" "200"

echo ""
echo "=== OFD Data Validation ==="
check_body "OFD brands has entries" "$API_BASE/api/v1/ofd/brands" "name"
check_body "OFD materials has entries" "$API_BASE/api/v1/ofd/materials" "name"
check_body "OFD search returns results" "$API_BASE/api/v1/ofd/search?search=PLA&limit=3" "brand"

echo ""
echo "=== OFD Brand Count ==="
count=$(curl -s -m 10 -H "$AUTH" "$API_BASE/api/v1/ofd/brands" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
echo "  Brands: $count"
if [ "$count" -gt 100 ]; then
    echo "  ✓ Brand count > 100"
    PASS=$((PASS + 1))
else
    echo "  ✗ Brand count too low (expected > 100)"
    FAIL=$((FAIL + 1))
fi

echo ""
echo "=== OFD Search Quality ==="
count=$(curl -s -m 10 -H "$AUTH" "$API_BASE/api/v1/ofd/search?search=Creality&limit=10" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo "0")
echo "  Creality results: $count"
if [ "$count" -gt 0 ]; then
    echo "  ✓ Search returns results for known brand"
    PASS=$((PASS + 1))
else
    echo "  ✗ Search returned no results for Creality"
    FAIL=$((FAIL + 1))
fi

echo ""
echo "=== System / Printer Status ==="
check "GET /system/printer-status" "$API_BASE/api/v1/system/printer-status" "200"
check_body "printer-status has print_state" "$API_BASE/api/v1/system/printer-status" "print_state"
check_body "printer-status has extruder" "$API_BASE/api/v1/system/printer-status" "extruder"

echo ""
echo "=== Dashboard Data ==="
check "GET /printer/stats" "$API_BASE/api/v1/printer/stats" "200"
check "GET /cfs/state" "$API_BASE/api/v1/cfs/state" "200"
check_body "cfs/state has slot_states" "$API_BASE/api/v1/cfs/state" "slot_states"

echo ""
echo "================================"
echo "  Passed: $PASS"
echo "  Failed: $FAIL"
echo "================================"
[ "$FAIL" -eq 0 ] && echo "All tests passed!" || echo "Some tests failed."
