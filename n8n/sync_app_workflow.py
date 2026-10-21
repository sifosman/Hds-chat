#!/usr/bin/env python3
"""[HDS-APP-2026-10-21] Generate/refresh the n8n "HDS App Channel" workflow from PROD William.

The app channel is NOT hand-edited: it is prod William (cyaeNrCXWi8YGQXa) with only the WhatsApp edges
changed. Re-run after every prod deploy (patchlib.deploy calls this automatically):

    python3 sync_app_workflow.py [--dry-run] [--no-activate]

Transforms (each asserted, the sync aborts if an anchor is missing so drift is never silent):
  1. webhook path hds-whatsapp -> hds-app-channel (stable webhookId)
  2. every https://graph.facebook.com/ -> <PUBLIC_URL>/api/wa/<GATEWAY_SECRET>/   (gateway proxies non-app recipients to Meta)
  3. Extract Meta Payload only accepts calls carrying x-hds-app-key
  4. Chatwoot handover inbox 3 -> HDS App inbox (handover + Send Acknowledgment human-owner check)
  5. ai_conversations rows written by this workflow carry conversation_metadata.channel='app'
  6. one CHANNEL note appended to the customer context (customer is in the HDS app, not WhatsApp)
  7. prod-only schedulers removed (Payment Check Sweep + chase email: prod/clone already run them)
"""
import copy, json, os, re, subprocess, sys, tempfile, urllib.request, urllib.error, uuid, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
HARNESS = os.path.join(ROOT, "..", "Chatbot Tests", "harness")
PROD_ID = "cyaeNrCXWi8YGQXa"
N8N = "https://n8n.owdsolutions.co.za/api/v1"
STATE = os.path.join(HERE, "app-workflow.json")
BACKUPS = os.path.join(HERE, "backups")
NAME = "HDS App Channel (generated from William prod - do not edit)"
DROP = {"Payment Check Sweep Trigger", "Payment Check Sweep", "Payment Chase Email"}


def env_file(path):
    out = {}
    for l in open(path):
        l = l.strip()
        if "=" in l and not l.startswith("#"):
            k, v = l.split("=", 1); out[k.strip()] = v.strip()
    return out


APP = env_file(os.path.join(ROOT, ".env.local"))
N8N_KEY = env_file(os.path.join(HARNESS, ".env"))["N8N_API_KEY"]
PUBLIC_URL = APP["PUBLIC_URL"].rstrip("/")
GATEWAY = f"{PUBLIC_URL}/api/wa/{APP['GATEWAY_SECRET']}/"
APP_KEY = APP["N8N_APP_KEY"]
APP_INBOX = int(APP["CHATWOOT_APP_INBOX_ID"])


def req(method, path, data=None):
    r = urllib.request.Request(N8N + path, data=json.dumps(data).encode() if data is not None else None, method=method)
    r.add_header("X-N8N-API-KEY", N8N_KEY); r.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(r, timeout=120) as resp:
            return json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        raise SystemExit(f"n8n API {method} {path} -> {e.code}: {e.read().decode()[:500]}")


def node_check(code, name):
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False) as t:
        t.write("async function __n8n_main() {\n" + code + "\n}\n"); p = t.name
    r = subprocess.run(["node", "--check", p], capture_output=True, text=True); os.unlink(p)
    if r.returncode: raise SystemExit(f"ABORT: syntax error after transform in {name}: {r.stderr[:400]}")


def sub(code, old, new, name, count=1):
    n = code.count(old)
    if n != count:
        raise SystemExit(f"ABORT [{name}]: expected {count}x anchor, found {n}: {old[:90]!r}")
    return code.replace(old, new)


CHANNEL_NOTE = (
    "\\n\\n=== CHANNEL: HDS APP ===\\n"
    "This customer is chatting with you in the HDS app (our own chat app), not on WhatsApp. Everything works exactly the same: "
    "quotes, PDFs, payment links, branches, photos, voice notes and handover to the team. Never tell them to message us on WhatsApp or "
    "to save our WhatsApp number - they are already talking to us here. Do not mention this note."
)


def transform(prod):
    wf = copy.deepcopy(prod)
    report = []
    wf["nodes"] = [n for n in wf["nodes"] if n["name"] not in DROP]
    conns = {}
    for src, v in wf["connections"].items():
        if src in DROP: continue
        nv = {}
        for typ, outs in v.items():
            nv[typ] = [[c for c in o if c["node"] not in DROP] for o in outs]
        conns[src] = nv
    wf["connections"] = conns
    report.append(f"dropped {len(DROP)} scheduler nodes")

    state = json.load(open(STATE)) if os.path.exists(STATE) else {}
    webhook_id = state.get("webhookId") or str(uuid.uuid4())

    by = {n["name"]: n for n in wf["nodes"]}
    wh = by["WhatsApp Webhook"]
    assert wh["parameters"]["path"] == "hds-whatsapp", "prod webhook path changed"
    wh["parameters"]["path"] = "hds-app-channel"
    wh["webhookId"] = webhook_id
    wh["name"] = "WhatsApp Webhook"  # name kept: other nodes reference it via $('...')

    total = 0
    for n in wf["nodes"]:
        s = json.dumps(n["parameters"])
        c = s.count("https://graph.facebook.com/")
        if c:
            n["parameters"] = json.loads(s.replace("https://graph.facebook.com/", GATEWAY)); total += c
    report.append(f"graph.facebook.com -> gateway: {total} refs")

    def code_of(name):
        return by[name]["parameters"]["jsCode"]

    def set_code(name, code):
        node_check(code, name); by[name]["parameters"]["jsCode"] = code

    # 3. auth guard
    set_code("Extract Meta Payload",
             "// [HDS-APP-CHANNEL] only the HDS app backend may call this webhook\n"
             f"const __hdr = ($input.first().json.headers || {{}});\nif (__hdr['x-hds-app-key'] !== '{APP_KEY}') {{ return []; }}\n"
             + "const __msg = $input.first().json.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];\n"
             + "if (!__msg) return [];\n"
             + "const __claim = await this.helpers.httpRequest({method:'POST', "
             + f"url:{json.dumps(PUBLIC_URL + '/api/internal/turn/claim')}, headers:{{'x-internal-key':{json.dumps(APP['INTERNAL_KEY'])}}}, "
             + "body:{wa_id:__msg.id,phone:__msg.from,execution:String($execution.id)},json:true,timeout:15000});\n"
             + "if (!__claim?.claimed) return []; // retries must never repeat quote/payment side effects\n"
             + code_of("Extract Meta Payload"))

    # 4. Chatwoot inbox
    hc = by["handover"]["parameters"]
    key = "jsCode" if "jsCode" in hc else "code"
    hc[key] = sub(hc[key], "const inboxId = 3;", f"const inboxId = {APP_INBOX}; // [HDS-APP-CHANNEL]", "handover")
    set_code("Send Acknowledgment", sub(code_of("Send Acknowledgment"), "c.inbox_id === 3", f"c.inbox_id === {APP_INBOX}", "Send Acknowledgment"))

    # 5. channel tag on ai_conversations rows
    smu = code_of("Store User Message")
    smu = sub(smu, "    if (input.referral) {\n      insertBody.conversation_metadata = { referral: input.referral };",
              "    insertBody.conversation_metadata = { channel: 'app' }; // [HDS-APP-CHANNEL]\n    if (input.referral) {\n      insertBody.conversation_metadata = { channel: 'app', referral: input.referral };",
              "Store User Message")
    set_code("Store User Message", smu)
    lts = code_of("Log to Supabase")
    lts = sub(lts, "      tool_results: toolResults\n    };", "      tool_results: toolResults,\n      conversation_metadata: { channel: 'app' } // [HDS-APP-CHANNEL]\n    };", "Log to Supabase")
    set_code("Log to Supabase", lts)

    # 6. channel note
    lcc = code_of("Load Customer Context")
    anchor = "// [ANSWERED-QS-2026-10-20]\ntry { const __aqb"
    lcc = sub(lcc, anchor, f"contextStr += '{CHANNEL_NOTE}'; // [HDS-APP-CHANNEL]\n" + anchor, "Load Customer Context")
    set_code("Load Customer Context", lcc)

    if APP.get('TURN_RECOVERY_ENABLED') == 'true':
        # Explicit terminal outcomes: receipt of the inbound webhook is NOT completion.
        finish_call = (
            "await this.helpers.httpRequest({method:'POST',"
            + 'url:' + json.dumps(PUBLIC_URL + '/api/internal/turn/finish') + ','
            + 'headers:' + json.dumps({'x-internal-key': APP['INTERNAL_KEY']}) + ','
            + "body:{execution:String($execution.id),outcome:'completed'},json:true,timeout:25000});"
        )
        # The inherited sender swallows HTTP errors and returns sent:true. That is unsafe for the app.
        reply = code_of('Send WhatsApp Reply')
        final_return = "return [{ json: { output: output, sent: true, messageType: pdfMatch ? 'document' : 'text' } }];"
        reply = sub(reply, final_return,
            "if (!String(output).trim() || !response?.messages?.[0]?.id) throw new Error('HDS app reply delivery failed');" + '\n' + final_return,
            'Send WhatsApp Reply delivery proof')
        set_code('Send WhatsApp Reply', reply)
        store = code_of('Store User Message')
        store = sub(store, 'if (await newerUserMsgArrived()) return [];',
                    'if (await newerUserMsgArrived()) { ' + finish_call + ' return []; }', 'debounced app turn completion')
        set_code('Store User Message', store)
        complete_name = 'Complete App Turn'
        for terminal in ('Log Blocked Message', 'Send Showcase Carousel', 'Handle Branch Reply'):
            if wf['connections'].get(terminal, {}).get('main'):
                raise SystemExit('ABORT: terminal acquired connections: ' + terminal)
            wf['connections'][terminal] = {'main': [[{'node': complete_name, 'type': 'main', 'index': 0}]]}
        complete_code = finish_call + '\nreturn $input.all();'
        node_check(complete_code, complete_name)
        wf['nodes'].append({'id': str(uuid.uuid5(uuid.NAMESPACE_URL, 'hds-app-complete-turn')),
                           'name': complete_name, 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
                           'position': [3200, 300], 'parameters': {'jsCode': complete_code}})
        # Error routing is app-only, never inherit the production WhatsApp error handler.
        wf.setdefault('settings', {}).pop('errorWorkflow', None)
        recovery_state = os.path.join(HERE, 'recovery-workflow.json')
        if os.path.exists(recovery_state):
            wf['settings']['errorWorkflow'] = json.load(open(recovery_state))['id']

    # Stable delivery keys for callback retries; body hashing is done by the gateway.
    for n in wf['nodes']:
        p = n['parameters']
        ck = 'jsCode' if 'jsCode' in p else 'code' if 'code' in p else None
        if not ck or GATEWAY not in p[ck]: continue
        c = p[ck]
        c = c.replace('this.helpers.httpRequest(', '__appHttp(')
        prelude = (
            "// [HDS-APP-CHANNEL] delivery retry identity, not a replacement for business logic\n"
            "const __nativeHttp = this.helpers.httpRequest.bind(this.helpers);\n"
            "let __appSeq = 0; let __appExec = ''; try { __appExec = String($execution.id); } catch {}\n"
            "const __appHttp = async (opts) => {\n"
            f"  if (String(opts.url || '').startsWith({json.dumps(GATEWAY)}) && __appExec) {{\n"
            f"    opts = {{...opts, headers:{{...opts.headers, 'x-hds-delivery-key':__appExec + ':' + {json.dumps(n['name'])} + ':' + (++__appSeq)}}}};\n"
            "  }\n  return __nativeHttp(opts);\n};\n"
        )
        node_check(prelude + c, n['name']); p[ck] = prelude + c

    left = json.dumps(wf["nodes"]).count("graph.facebook.com")
    if left: raise SystemExit(f"ABORT: {left} graph.facebook.com refs remain")
    # sanity: no remaining inbox-3 filters in nodes on the customer path
    for n in wf["nodes"]:
        s = json.dumps(n["parameters"])
        if re.search(r"inbox_id\s*===?\s*'?3\b|inboxId\s*=\s*3\b", s) and n["name"] not in ("Handle Branch Reply",):
            raise SystemExit(f"ABORT: inbox 3 reference left in {n['name']}")
    return wf, webhook_id, report


def main():
    dry = "--dry-run" in sys.argv
    prod = req("GET", f"/workflows/{PROD_ID}")
    wf, webhook_id, report = transform(prod)
    for r in report: print(" ", r)
    body = {"name": NAME, "nodes": wf["nodes"], "connections": wf["connections"],
            "settings": {k: v for k, v in (wf.get("settings") or {}).items() if k != "binaryMode"}}
    state = json.load(open(STATE)) if os.path.exists(STATE) else {}
    if dry:
        print("DRY RUN ok,", len(wf["nodes"]), "nodes"); return
    os.makedirs(BACKUPS, exist_ok=True)
    if state.get("id"):
        cur = req("GET", f"/workflows/{state['id']}")
        stamp = datetime.datetime.now(datetime.UTC).strftime("%Y%m%d-%H%M%S")
        json.dump(cur, open(os.path.join(BACKUPS, f"app-channel_{stamp}.json"), "w"))
        req("PUT", f"/workflows/{state['id']}", body)
        wid = state["id"]; print("updated", wid)
    else:
        created = req("POST", "/workflows", body)
        wid = created["id"]; print("created", wid)
    json.dump({"id": wid, "webhookId": webhook_id, "synced_from_prod_updatedAt": prod.get("updatedAt"),
               "synced_at": datetime.datetime.now(datetime.UTC).isoformat()}, open(STATE, "w"), indent=2)
    if "--no-activate" not in sys.argv:
        live = req("GET", f"/workflows/{wid}")
        if not live.get("active"):
            req("POST", f"/workflows/{wid}/activate"); print("activated")
    live = req("GET", f"/workflows/{wid}")
    s = json.dumps(live["nodes"])
    print("verify: active=%s graph=%d markers=%d nodes=%d" % (live.get("active"), s.count("graph.facebook.com"), s.count("[HDS-APP-CHANNEL]"), len(live["nodes"])))


if __name__ == "__main__":
    main()
