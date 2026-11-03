"""Run against fictional, private staging fixtures only. No credentials in this file."""
import json,sys,pathlib,urllib.request,urllib.error,datetime,uuid
ctx=json.loads(pathlib.Path(sys.argv[1]).read_text())
url='https://yfjiculexbzpkvtapudk.supabase.co/functions/v1/staff-workspace-v6'
def call(body,token,expect=200):
    req=urllib.request.Request(url,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Authorization':'Bearer '+token})
    try:
        with urllib.request.urlopen(req,timeout=90) as r:status=r.status;out=json.load(r)
    except urllib.error.HTTPError as e:status=e.code;out=json.load(e)
    assert status==expect,(body['action'],status,out)
    print('PASS',body['action'],status,flush=True);return out
s=ctx['SUPERVISOR'];a=ctx['ASSISTANT'];pid=ctx['project']
# Separate open task: preserve the time/import regression task and its evidence.
tid=call({'action':'task_create','project_id':pid,'assigned_to':s['staff_id'],'task_name':'V6 QA handover '+uuid.uuid4().hex[:8],'description':'Fictional routing regression','due_date':str(datetime.date.today())},s['access_token'])['task_id']
def task(token):return next(t for t in call({'action':'workspace'},token)['tasks'] if t['task_id']==tid)
def route(token,recipient,operation,message,rev,expect=200):return call({'action':'task_escalate','task_id':tid,'assigned_to':recipient,'operation':operation,'reason':message,'revision':rev},token,expect)
t=task(s['access_token'])
c=call({'action':'task_recipients','task_id':tid},s['access_token'])['recipients'];assert any(x['staff_id']==a['staff_id'] for x in c)
route(s['access_token'],a['staff_id'],'Forward','',t['revision'],400)
route(s['access_token'],a['staff_id'],'Escalate','Review this task',t['revision'],403)
route(s['access_token'],str(uuid.uuid4()),'Forward','Invalid recipient',t['revision'],403)
message='Please review the purchase mapping and record missing supplier details.'
route(s['access_token'],a['staff_id'],'Forward',message,t['revision'])
route(s['access_token'],a['staff_id'],'Forward','Stale request',t['revision'],409)
w=call({'action':'workspace'},a['access_token']);t=next(t for t in w['tasks'] if t['task_id']==tid)
assert t['assigned_to']==a['staff_id']
assert any(n['task_id']==tid and message in n['message'] for n in w['notifications'])
assert any(e['task_id']==tid and e['reason']==message and e['event_type']=='Forwarded' for e in w['task_events'])
route(a['access_token'],s['staff_id'],'Escalate','Client bank statement missing; please follow up.',t['revision'])
w=call({'action':'workspace'},a['access_token']);assert not any(t['task_id']==tid for t in w['tasks'])
assert any(e['task_id']==tid and e['created_by']==a['staff_id'] and e['event_type']=='Escalated' for e in w['task_events'])
call({'action':'task_recipients','task_id':tid},a['access_token']) # Empty list after handover; no new access.
route(a['access_token'],s['staff_id'],'Forward','Cannot route someone else task',t['revision'],403)
t=task(s['access_token'])
call({'action':'task_status','task_id':tid,'revision':t['revision'],'status':'Completed','blocked_reason':''},s['access_token'])
t=task(s['access_token'])
route(s['access_token'],a['staff_id'],'Forward','Completed task cannot move',t['revision'],400)
print('PASS routing ownership, required messages, history, recipient alerts and access denials',flush=True)
