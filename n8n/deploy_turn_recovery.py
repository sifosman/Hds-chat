#!/usr/bin/env python3
"""App-only error workflow plus periodic stalled-turn watchdog. Never edits WhatsApp workflows."""
import json, os, sys, uuid
from sync_app_workflow import APP, PUBLIC_URL, req
HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, 'recovery-workflow.json')
APP_ID = json.load(open(os.path.join(HERE, 'app-workflow.json')))['id']
HEADERS = {'x-internal-key': APP['INTERNAL_KEY']}
error_code = (
    "const e = $input.first().json;\n"
    + f"if (e.workflow?.id !== {json.dumps(APP_ID)} || !e.execution?.id) return [];\n"
    + "const result = await this.helpers.httpRequest({method:'POST',"
    + 'url:' + json.dumps(PUBLIC_URL + '/api/internal/turn/finish') + ','
    + 'headers:' + json.dumps(HEADERS) + ','
    + "body:{execution:String(e.execution.id),outcome:e.execution.lastNodeExecuted === 'Complete App Turn' ? 'completed' : 'failed'},json:true,timeout:25000});\n"
    + "return [{json:result}];"
)
watch_code = (
    "const result = await this.helpers.httpRequest({method:'POST',"
    + 'url:' + json.dumps(PUBLIC_URL + '/api/internal/turn/recover') + ','
    + 'headers:' + json.dumps(HEADERS) + ','
    + "body:{},json:true,timeout:25000});\nreturn [{json:result}];"
)
body = {'name':'HDS App Turn Recovery (app-only)', 'nodes':[
    {'id':str(uuid.uuid4()),'name':'App workflow failed','type':'n8n-nodes-base.errorTrigger','typeVersion':1,
     'position':[0,0],'parameters':{}},
    {'id':str(uuid.uuid4()),'name':'Record interrupted app turn','type':'n8n-nodes-base.code','typeVersion':2,
     'position':[240,0],'parameters':{'jsCode':error_code}},
    {'id':str(uuid.uuid4()),'name':'Check stalled app turns','type':'n8n-nodes-base.scheduleTrigger','typeVersion':1.2,
     'position':[0,240],'parameters':{'rule':{'interval':[{'field':'minutes','minutesInterval':1}]}}},
    {'id':str(uuid.uuid4()),'name':'Recover app notices','type':'n8n-nodes-base.code','typeVersion':2,
     'position':[240,240],'parameters':{'jsCode':watch_code}}
], 'connections':{
    'App workflow failed':{'main':[[{'node':'Record interrupted app turn','type':'main','index':0}]]},
    'Check stalled app turns':{'main':[[{'node':'Recover app notices','type':'main','index':0}]]}
}, 'settings':{'executionOrder':'v1','timezone':'Africa/Johannesburg'}}
if os.path.exists(STATE):
    wid=json.load(open(STATE))['id'];req('PUT','/workflows/'+wid,body)
else:
    wid=req('POST','/workflows',body)['id'];json.dump({'id':wid},open(STATE,'w'),indent=2)
if '--no-activate' not in sys.argv and not req('GET','/workflows/'+wid).get('active'):
    req('POST','/workflows/'+wid+'/activate')
print('App-only turn recovery:',wid,'active=',req('GET','/workflows/'+wid).get('active'))
