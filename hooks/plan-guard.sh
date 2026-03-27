#!/bin/bash
# PostToolUse hook — plan announcement guard.
# Ensures agents announce their plan to Discord via `anc plan`.
# If agent hasn't called `anc plan` after 8 Bash tool calls, posts a fallback.
#
# Reads hook event JSON from stdin. Uses env vars set by ANC spawn script:
#   ANC_WORKSPACE_ROOT, AGENT_ROLE, ANC_ISSUE_KEY, ANC_SERVER_URL

WORKSPACE="${ANC_WORKSPACE_ROOT:-$(pwd)}"
MARKER="$WORKSPACE/.anc/plan-announced"
COUNTER="$WORKSPACE/.anc/tool-count"

# Already announced? Exit immediately (zero overhead).
[ -f "$MARKER" ] && exit 0

# Ensure .anc dir exists
mkdir -p "$WORKSPACE/.anc" 2>/dev/null

# Read stdin (hook event JSON) — must consume it
INPUT=$(cat)

# Increment tool call counter
COUNT=$(cat "$COUNTER" 2>/dev/null || echo 0)
COUNT=$((COUNT + 1))
echo "$COUNT" > "$COUNTER"

# Check if this Bash call was `anc plan` or `anc-sdk plan`
if echo "$INPUT" | grep -q 'anc plan\|anc-sdk plan'; then
  touch "$MARKER"
  exit 0
fi

# After 8 Bash calls without plan announcement, post fallback
if [ "$COUNT" -ge 8 ] && [ ! -f "$MARKER" ]; then
  touch "$MARKER"  # prevent repeat fallback
  ROLE="${AGENT_ROLE:-agent}"
  ISSUE="${ANC_ISSUE_KEY:-unknown}"
  SERVER="${ANC_SERVER_URL:-http://localhost:3849}"
  curl -s -X POST "$SERVER/plan-announce" \
    -H 'Content-Type: application/json' \
    -d "{\"role\":\"$ROLE\",\"issueKey\":\"$ISSUE\",\"plan\":\"Working on this issue (no plan announced)\"}" \
    > /dev/null 2>&1 &
fi

exit 0
