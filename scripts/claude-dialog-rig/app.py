#!/usr/bin/env python3
"""Stands in for the Jean desktop app.

Owns a unix socket (Jean's jean_mcp_socket.rs). Holds pending dialogs until a
human answers them via answer.py. Also serves an instant tool so we can prove a
parked dialog does not starve other Jean MCP tools.
"""
import json, os, socket, socketserver, threading, time, sys

SOCK = os.environ.get("JEAN_RIG_SOCK","/tmp/jean-rig-app.sock")
PENDING = {}          # id -> {"questions":…, "event":Event, "answers":…, "t0":…}
LOCK = threading.Lock()
SEQ = [0]

def log(*a): print("[app]", *a, file=sys.stderr, flush=True)

class H(socketserver.StreamRequestHandler):
    def handle(self):
        line = self.rfile.readline()
        if not line: return
        req = json.loads(line)
        op = req.get("op")

        if op == "dialog":                       # blocks, like a real UI prompt
            with LOCK:
                SEQ[0] += 1; did = SEQ[0]
                ev = threading.Event()
                PENDING[did] = {"questions": req["questions"], "event": ev,
                                "answers": None, "t0": time.time(),
                                "tool_use_id": req.get("tool_use_id")}
            log(f"dialog #{did} parked ({len(req['questions'])} question(s))")
            ev.wait()                            # ← no timeout: the human takes as long as they take
            with LOCK:
                answers = PENDING.pop(did)["answers"]
            log(f"dialog #{did} answered: {answers}")
            self.wfile.write((json.dumps({"result": {"answers": answers}}) + "\n").encode())

        elif op == "tool":                       # instant, non-dialog Jean MCP tool
            self.wfile.write((json.dumps({"result": {
                "ok": True, "tool": req.get("name"),
                "served_at": round(time.time(), 3)}}) + "\n").encode())

        elif op == "list":
            with LOCK:
                out = [{"id": k, "waited_s": round(time.time() - v["t0"], 1),
                        "questions": [q["question"] for q in v["questions"]],
                        "options": [[o["label"] for o in q["options"]] for q in v["questions"]]}
                       for k, v in PENDING.items()]
            self.wfile.write((json.dumps({"result": out}) + "\n").encode())

        elif op == "answer":
            with LOCK:
                e = PENDING.get(req["id"])
                if e: e["answers"] = req["answers"]; ev = e["event"]
                else: ev = None
            if ev: ev.set()
            self.wfile.write((json.dumps({"result": {"ok": ev is not None}}) + "\n").encode())

class Srv(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True; allow_reuse_address = True

if __name__ == "__main__":
    try: os.unlink(SOCK)
    except FileNotFoundError: pass
    os.makedirs(os.path.dirname(SOCK), exist_ok=True)
    log("listening on", SOCK)
    Srv(SOCK, H).serve_forever()
