#!/bin/bash

# V2 Integration Tests — with rate limit protection
# Gemini free tier: 20 requests/day
# We use only a few key tests with delays

BASE="http://localhost:3143"
DELAY=8  # seconds between requests

echo "========================================="
echo "  V2 Integration Tests"
echo "========================================="
echo ""

run_test() {
  local prompt="$1"
  local mode="$2"
  local desc="$3"

  echo "▶ $desc"
  echo "  Prompt: \"$prompt\" (mode=$mode)"

  response=$(curl -s -X POST "$BASE/api/tasks" \
    -H 'Content-Type: application/json' \
    -d "{\"prompt\":\"$prompt\",\"mode\":\"$mode\"}")

  status=$(echo "$response" | grep -o '"status":"[^"]*"' | head -1 | cut -d'"' -f4)
  summary=$(echo "$response" | grep -o '"summary":"[^"]*"' | head -1 | cut -d'"' -f4)
  error=$(echo "$response" | grep -o '"error":"[^"]*"' | head -1 | cut -d'"' -f4)
  steps=$(echo "$response" | grep -o '"index":[0-9]*' | wc -l)

  if [ "$status" = "completed" ]; then
    echo "  ✅ status=$status, steps=$steps"
    if [ -n "$summary" ]; then
      echo "  Summary: $summary"
    fi
  else
    echo "  ❌ status=$status, error=$error"
  fi
  echo ""
}

# ── TESTS ──

run_test "cuanto es 2 + 2" "code" "Math: 2 + 2"
sleep $DELAY

run_test "what is 100 / 4" "code" "Math: 100 / 4"
sleep $DELAY

run_test "list files in the current directory" "code" "Code: list files"
sleep $DELAY

run_test "show me the current date and time" "code" "Code: date/time"
sleep $DELAY

run_test "create a file called test_v2.txt with the content hello from v2" "code" "Code: create file"
sleep $DELAY

echo "========================================="
echo "  Tests completed"
echo "========================================="
