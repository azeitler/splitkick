#!/usr/bin/env python3
"""The human. `answer.py list` / `answer.py <id> <label>[,<label>…]`"""
import json, os, socket, sys
SOCK = os.environ.get("JEAN_RIG_SOCK","/tmp/jean-rig-app.sock")
def call(req):
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM); s.connect(SOCK)
    s.sendall((json.dumps(req) + "\n").encode())
    return json.loads(s.makefile().readline())["result"]
if sys.argv[1] == "list":
    print(json.dumps(call({"op": "list"}), indent=2))
else:
    did = int(sys.argv[1]); labels = sys.argv[2].split(",")
    pend = {d["id"]: d for d in call({"op": "list"})}[did]
    answers = {q: labels[i] for i, q in enumerate(pend["questions"])}
    print(call({"op": "answer", "id": did, "answers": answers}))
