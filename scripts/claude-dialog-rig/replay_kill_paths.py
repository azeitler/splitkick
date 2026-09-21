"""Model of where Jean kills the Claude CLI on a blocking tool.

OLD = the removed stream-event kill (fires on the first parseable input chunk),
NEW = the current rule (the finished `assistant` line only).

For each, reports the kill line, the input Jean hands to the UI, and whether
the run log up to the kill point still holds the finished tool call — which is
what chat history is rebuilt from after a session switch, restart or remote
load (azeitler/jean#32)."""
import json, sys
BLOCKING = ('AskUserQuestion', 'ExitPlanMode')
def run(path, new_logic):
    lines = open(path).read().split('\n')
    pending, bufs, seen = {}, {}, set()
    for n, l in enumerate(lines, 1):
        try: d = json.loads(l)
        except: continue
        if d.get('type') == 'stream_event' and not new_logic:
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
                if not b.strip(): continue
                try: inp = json.loads(b)
                except: continue
                if name in BLOCKING:
                    return ('stream_event', n, name, inp, on_disk(lines, n, tid))
        elif d.get('type') == 'assistant':
            for b in d['message']['content']:
                if b.get('type') != 'tool_use' or b['id'] in seen: continue
                seen.add(b['id'])
                if b['name'] in BLOCKING:
                    return ('assistant', n, b['name'], b.get('input', {}), on_disk(lines, n, b['id']))
    return None

def on_disk(lines, kill_line, tool_id):
    """Did a finished assistant line for this tool reach the file by the kill?"""
    for l in lines[:kill_line]:
        try: d = json.loads(l)
        except: continue
        if d.get('type') == 'assistant' and any(
                b.get('id') == tool_id for b in d['message'].get('content', [])):
            return True
    return False

for f in sys.argv[1:]:
    for label, new in (('OLD', False), ('NEW', True)):
        r = run(f, new)
        if not r: print(f'{f:15s} {label}: no kill'); continue
        path, n, name, inp, saved = r
        detail = (f"questions={len(inp.get('questions') or [])}" if name == 'AskUserQuestion'
                  else f"plan chars={len(inp.get('plan') or '')}")
        print(f'{f:15s} {label}: kills via {path:12s} at line {n:3d} | {name} | {detail} | '
              f'history keeps it: {"yes" if saved else "NO"}')
