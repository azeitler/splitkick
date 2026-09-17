"""Faithful model of claude.rs: stream-event path, then assistant-message path,
sharing seen_tool_use_ids. Reports the first path that would kill the CLI."""
import json, sys
BLOCKING = ('AskUserQuestion', 'ExitPlanMode')
def run(path, new_logic):
    pending, bufs, seen = {}, {}, set()
    for n, l in enumerate(open(path), 1):
        try: d = json.loads(l)
        except: continue
        if d.get('type') == 'stream_event':
            ev = d['event']
            cb = ev.get('content_block', {})
            if ev.get('type') == 'content_block_start' and cb.get('type') == 'tool_use':
                pending[ev['index']] = (cb['id'], cb['name'], cb.get('input', {})); bufs[ev['index']] = ''
            elif ev.get('type') == 'content_block_delta' and ev.get('delta', {}).get('type') == 'input_json_delta':
                i = ev['index']
                if i not in pending: continue
                tid, name, start_input = pending[i]
                if tid in seen: continue
                bufs[i] += ev['delta']['partial_json']; b = bufs[i]
                if new_logic:
                    if not b.strip(): continue
                    try: inp = json.loads(b)
                    except: continue
                else:
                    if not b.strip(): inp = start_input
                    else:
                        try: inp = json.loads(b)
                        except: continue
                if name in BLOCKING:
                    return ('stream_event', n, name, inp)
        elif d.get('type') == 'assistant':
            for b in d['message']['content']:
                if b.get('type') != 'tool_use' or b['id'] in seen: continue
                seen.add(b['id'])
                if b['name'] in BLOCKING:
                    return ('assistant', n, b['name'], b.get('input', {}))
    return None
for f in sys.argv[1:]:
    for label, new in (('OLD', False), ('NEW', True)):
        r = run(f, new)
        if not r: print(f'{f:15s} {label}: no kill'); continue
        path, n, name, inp = r
        detail = (f"questions={len(inp.get('questions') or [])}" if name == 'AskUserQuestion'
                  else f"plan chars={len(inp.get('plan') or '')}")
        print(f'{f:15s} {label}: kills via {path:12s} at line {n:3d} | {name} | {detail}')
