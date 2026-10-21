#!/usr/bin/env python3
"""Deploy the separate, additive app notification reconciliation schedule.
Reads authoritative HDS state via our protected API; never changes WhatsApp workflows.
"""
import json, os, uuid
from sync_app_workflow import APP, PUBLIC_URL, req
HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, 'async-workflow.json')
node_code = (
    "const result = await this.helpers.httpRequest({method:'POST',"
    + 'url:' + json.dumps(PUBLIC_URL + '/api/internal/reconcile') + ','
    + "headers:{'x-internal-key':" + json.dumps(APP['INTERNAL_KEY']) + "},body:{},json:true,timeout:55000});\n"
    + "if (!result.ok) throw new Error('HDS app reconciliation needs review; failures=' + result.failures);\nreturn [{json:result}];"
)
body = {'name':'HDS App Async Updates (app-only)', 'nodes':[
    {'id':str(uuid.uuid4()),'name':'Every minute','type':'n8n-nodes-base.scheduleTrigger','typeVersion':1.2,
     'position':[0,0],'parameters':{'rule':{'interval':[{'field':'minutes','minutesInterval':1}]}}},
    {'id':str(uuid.uuid4()),'name':'Reconcile app notifications','type':'n8n-nodes-base.code','typeVersion':2,
     'position':[240,0],'parameters':{'jsCode':node_code}}
], 'connections':{'Every minute':{'main':[[{'node':'Reconcile app notifications','type':'main','index':0}]]}},
'settings':{'executionOrder':'v1','timezone':'Africa/Johannesburg'}}
if os.path.exists(STATE):
    wid=json.load(open(STATE))['id'];req('PUT','/workflows/'+wid,body)
else:
    wid=req('POST','/workflows',body)['id'];json.dump({'id':wid},open(STATE,'w'),indent=2)
live=req('GET','/workflows/'+wid)
if not live.get('active'):req('POST','/workflows/'+wid+'/activate')
print('App-only reconciliation workflow:',wid,'active=',req('GET','/workflows/'+wid).get('active'))
