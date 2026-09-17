#!/bin/zsh
# Pre-implementation acceptance rig for the Claude dialog tool harness.
#
#   ./run.sh [human_delay_s] [degrade] [idle_ms]
#
#   degrade  none  all fixes on                      -> expect PASS
#            b1    pinger disabled                   -> FAIL with RIG_NO_SERVER_TIMEOUT=1 + idle_ms
#            b2    _meta/progressToken dropped       -> same failure as b1 (pinger can't run)
#            b3    serial request loop (today's Rust)
#            b4    120s socket read timeout          -> FAIL only if delay > 120
#            r1    wrong permission-prompt-tool name -> FAIL exit=1 (risk 1)
#   idle_ms  sets CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT (floor 30000). Default: CLI
#            default of 30 min, which no sane delay will trip.
#
# Proves the Jean-shaped topology (stdio shim -> unix socket -> app holding a
# human) carries AskUserQuestion end-to-end, before any Rust is written.
RIG="${0:A:h}"
DELAY="${1:-40}"
DEGRADE="${2:-none}"
IDLE_MS="${3:-}"
CLI="${CLAUDE_CLI:-$HOME/Library/Application Support/com.jean.desktop/claude-cli/claude}"
WORK="$(mktemp -d)"
sed "s#\$RIG#$RIG#g" "$RIG/mcp.json" > "$WORK/mcp.json"
# RIG_NO_SERVER_TIMEOUT=1 drops the per-server "timeout", which otherwise raises
# the idle-abort threshold and masks the b1/b2 degrades.
if [[ -n "$RIG_NO_SERVER_TIMEOUT" ]]; then
  python3 -c "import json,sys;p=sys.argv[1];d=json.load(open(p));d['mcpServers']['jeanrig'].pop('timeout',None);json.dump(d,open(p,'w'))" "$WORK/mcp.json"
fi

TOOL="mcp__jeanrig__permission_prompt"
[[ "$DEGRADE" == "r1" ]] && TOOL="mcp__jean__permission_prompt"   # server that isn't configured

pkill -f "$RIG/app.py" 2>/dev/null
sleep 0.5
python3 "$RIG/app.py" > "$WORK/app.out" 2> "$WORK/app.err" &
APP=$!
sleep 1
trap 'kill $APP 2>/dev/null' EXIT

( sleep "$DELAY"
  python3 "$RIG/answer.py" list > "$WORK/parked.json" 2>&1
  id=$(python3 -c "import json;d=json.load(open('$WORK/parked.json'));print(d[0]['id'] if d else '')" 2>/dev/null)
  lbl=$(python3 -c "import json;d=json.load(open('$WORK/parked.json'));print(d[0]['options'][0][0] if d else '')" 2>/dev/null)
  [[ -n "$id" ]] && python3 "$RIG/answer.py" "$id" "$lbl" >/dev/null 2>&1 ) &

echo "rig: human answers after ${DELAY}s | degrade=$DEGRADE | idle=${IDLE_MS:-default(30min)}"
t0=$(date +%s)
if [[ -n "$IDLE_MS" ]]; then
  cat "$RIG/prompt.jsonl" | DEGRADE="$DEGRADE" JEAN_RIG_LOG="$WORK/shim.log" \
    CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT="$IDLE_MS" "$CLI" \
    --print --output-format stream-json --input-format stream-json --verbose \
    --tools default --permission-mode acceptEdits --model haiku \
    --permission-prompt-tool "$TOOL" --mcp-config "$WORK/mcp.json" --strict-mcp-config \
    --allowedTools mcp__jeanrig --allowedTools 'mcp__jeanrig__*' > "$WORK/run.txt" 2>"$WORK/run.err"
else
  cat "$RIG/prompt.jsonl" | DEGRADE="$DEGRADE" JEAN_RIG_LOG="$WORK/shim.log" "$CLI" \
    --print --output-format stream-json --input-format stream-json --verbose \
    --tools default --permission-mode acceptEdits --model haiku \
    --permission-prompt-tool "$TOOL" --mcp-config "$WORK/mcp.json" --strict-mcp-config \
    --allowedTools mcp__jeanrig --allowedTools 'mcp__jeanrig__*' > "$WORK/run.txt" 2>"$WORK/run.err"
fi
CODE=$?
echo "exit=$CODE elapsed=$(( $(date +%s) - t0 ))s pings=$(grep -c ping "$WORK/shim.log" 2>/dev/null || echo 0)"
[[ -s "$WORK/run.err" ]] && echo "stderr: $(head -c 180 "$WORK/run.err")"

python3 - "$WORK/run.txt" "$CODE" <<'PY'
import json, sys
ok = False
for l in open(sys.argv[1]):
    try: d = json.loads(l)
    except Exception: continue
    if d.get('type') == 'user':
        for b in (d.get('message', {}).get('content') or []):
            if isinstance(b, dict) and b.get('type') == 'tool_result':
                c = json.dumps(b.get('content'))
                if 'have been answered' in c:
                    ok = True; print("  dialog answered out-of-band:", c[:110])
                elif 'tool_use_error' in c:
                    print("  tool error:", c[:180])
                elif 'did not answer' in c:
                    print("  dialog resolved empty")
ok = ok and sys.argv[2] == "0"
print("\nRESULT:", "PASS" if ok else "FAIL")
PY
echo "logs: $WORK"
