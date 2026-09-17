#!/usr/bin/env python3
"""Stands in for jean_mcp_stdio.rs — WITH the four fixes B1-B4 applied.

Differences from today's Rust shim, each one a thing to port:
  B2  threads params._meta through to the app (progressToken survives)
  B1  background pinger emits notifications/progress every PING_S seconds
  B3  stdout write mutex + one thread per request (no serial starvation)
  B4  no 120s socket read timeout on a dialog call
Set DEGRADE=b1|b2|b3 to disable a fix and watch the corresponding failure.
"""
import json, os, socket, sys, threading, time

SOCK = os.environ.get("JEAN_RIG_SOCK","/tmp/jean-rig-app.sock")
PING_S = float(os.environ.get("PING_S", "10"))
DEGRADE = os.environ.get("DEGRADE", "")
OUT = threading.Lock()                                    # B3

import os as _os
LOGF = open(_os.environ.get("JEAN_RIG_LOG","/tmp/jean-rig-shim.log"),"a")
def log(*a): print("[shim]", *a, file=LOGF, flush=True)

def send(obj):
    with OUT:                                             # B3
        sys.stdout.write(json.dumps(obj) + "\n"); sys.stdout.flush()

def app_call(req, read_timeout=None):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(read_timeout)                            # B4: None on dialogs
    s.connect(SOCK)
    s.sendall((json.dumps(req) + "\n").encode())
    return json.loads(s.makefile().readline())["result"]

TOOLS = [
  {"name": "permission_prompt",
   "description": "Handles permission prompts and interactive dialogs.",
   "inputSchema": {"type": "object",
     "properties": {"tool_name": {"type": "string"}, "input": {"type": "object"},
                    "tool_use_id": {"type": "string"}},
     "required": ["tool_name", "input"]}},
  {"name": "get_current_context",
   "description": "Return the calling session's Jean context. Returns instantly.",
   "inputSchema": {"type": "object", "properties": {}, "additionalProperties": False}},
]

def handle_tools_call(mid, params):
    name = params.get("name")
    args = params.get("arguments") or {}
    meta = params.get("_meta") or {}                      # B2
    token = meta.get("progressToken")
    if DEGRADE == "b2": token = None

    if name == "get_current_context":
        r = app_call({"op": "tool", "name": name}, read_timeout=30)
        send({"jsonrpc":"2.0","id":mid,"result":{"content":[{"type":"text","text":json.dumps(r)}]}})
        return

    tool_name, tinput = args.get("tool_name"), (args.get("input") or {})

    if tool_name != "AskUserQuestion":                    # plan-mode default arm
        allow = tool_name in ("Read","Glob","Grep","WebFetch","ToolSearch","Bash")
        payload = ({"behavior":"allow","updatedInput":tinput} if allow else
                   {"behavior":"deny","message":f"{tool_name} is not permitted in plan mode."})
        send({"jsonrpc":"2.0","id":mid,"result":{"content":[{"type":"text","text":json.dumps(payload)}]}})
        return

    stop = threading.Event()
    def pinger():                                         # B1
        n = 0
        while not stop.wait(PING_S):
            n += 1
            send({"jsonrpc":"2.0","method":"notifications/progress",
                  "params":{"progressToken":token,"progress":n,
                            "message":"waiting for the user to answer"}})
            log(f"ping {n} (token={token})")
    if token is not None and DEGRADE != "b1":
        threading.Thread(target=pinger, daemon=True).start()

    t0 = time.time()
    try:
        r = app_call({"op":"dialog","questions":tinput.get("questions") or [],
                      "tool_use_id": args.get("tool_use_id")},
                     read_timeout=120 if DEGRADE == "b4" else None)   # B4
        payload = {"behavior":"allow",
                   "updatedInput":{"questions":tinput.get("questions") or [],
                                   "answers": r["answers"]}}
    except Exception as e:
        payload = {"behavior":"deny","message":f"dialog failed: {e}"}
    finally:
        stop.set()
    log(f"dialog resolved after {time.time()-t0:.1f}s")
    send({"jsonrpc":"2.0","id":mid,"result":{"content":[{"type":"text","text":json.dumps(payload)}]}})

for line in sys.stdin:
    line = line.strip()
    if not line: continue
    msg = json.loads(line)
    method, mid = msg.get("method"), msg.get("id")
    if method == "initialize":
        send({"jsonrpc":"2.0","id":mid,"result":{
            "protocolVersion": msg.get("params",{}).get("protocolVersion","2025-06-18"),
            "capabilities":{"tools":{}},"serverInfo":{"name":"jeanrig","version":"0.0.1"}}})
    elif method == "tools/list":
        send({"jsonrpc":"2.0","id":mid,"result":{"tools":TOOLS}})
    elif method == "tools/call":
        target = handle_tools_call
        if DEGRADE == "b3": target(mid, msg.get("params") or {})       # serial, like today
        else: threading.Thread(target=target, args=(mid, msg.get("params") or {}), daemon=True).start()
    elif mid is not None:
        send({"jsonrpc":"2.0","id":mid,"result":{}})
