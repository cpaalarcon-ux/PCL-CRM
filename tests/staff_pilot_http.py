"""Staging-only integration checks. Pass a private JSON fixture path, never commit it.
The fixture contains a temporary QA Partner's login_id/password/access_token.
Created records have PILOT-QA labels. Archive them and revoke test accounts after testing.
"""
import json,sys,uuid,secrets,urllib.request,urllib.error
from datetime import date,timedelta
URL='https://yfjiculexbzpkvtapudk.supabase.co/functions/v1/staff-pilot'
PATH=sys.argv[1];ctx=json.load(open(PATH));checks=[]
def save():
 with open(PATH,'w') as f:json.dump(ctx,f)
def call(payload,token=None,expect=200):
 headers={'Content-Type':'application/json'}
 if token:headers['Authorization']='Bearer '+token
 req=urllib.request.Request(URL,data=json.dumps(payload).encode(),headers=headers,method='POST')
 try:
  with urllib.request.urlopen(req,timeout=60) as r:status=r.status;raw=r.read();ctype=r.headers.get('Content-Type','')
 except urllib.error.HTTPError as e:status=e.code;raw=e.read();ctype='application/json'
 out=json.loads(raw) if 'json' in ctype else raw
 if status!=expect:raise AssertionError(f"{payload.get('action')} expected {expect}, received {status}: {out if isinstance(out,dict) else 'binary'}")
 checks.append((payload.get('action'),status));print('PASS',payload.get('action'),status,flush=True);return out
def upload(token,client,firm,project,task,cat='Working Papers',expect=200):
 boundary='----PCL'+uuid.uuid4().hex
 fields={'client_id':client,'firm_id':firm,'project_id':project,'task_id':task,'category':cat}
 chunks=[]
 for k,v in fields.items():chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
 chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="pilot-evidence.pdf"\r\nContent-Type: application/pdf\r\n\r\n'.encode()+b'%PDF-1.4\n% Fictional pilot evidence only\n%%EOF\r\n')
 chunks.append(f'--{boundary}--\r\n'.encode())
 req=urllib.request.Request(URL,data=b''.join(chunks),headers={'Content-Type':'multipart/form-data; boundary='+boundary,'Authorization':'Bearer '+token},method='POST')
 try:
  with urllib.request.urlopen(req,timeout=60) as r:status=r.status;out=json.load(r)
 except urllib.error.HTTPError as e:status=e.code;out=json.load(e)
 if status!=expect:raise AssertionError(f'upload expected {expect}, received {status}: {out}')
 checks.append(('upload',status));return out
def staff(actor,category,suffix,firm):
 s=call({'action':'staff_save','staff_identifier':'PILOT-QA-'+suffix.upper(),'login_id':'pilot.qa.'+suffix,'full_name':'Pilot QA '+suffix+' (temporary)',
 'category_code':category,'employment_type':'Permanent' if category!='INTERN' else 'Internship','contract_end_date':str(date.today()+timedelta(days=10)) if category=='INTERN' else None,'firm_ids':[firm]},actor)
 link=call({'action':'account_link','staff_id':s['staff_id']},actor)
 raw=link['setup_url'].split('#setup=')[1];pw='Qa-7aB-'+secrets.token_hex(16)
 call({'action':'setup','token':raw,'password':pw})
 call({'action':'setup','token':raw,'password':pw},expect=400)
 auth=call({'action':'login','login_id':'pilot.qa.'+suffix,'password':pw})
 ctx[suffix]={'staff_id':s['staff_id'],'login_id':'pilot.qa.'+suffix,'password':pw,'access_token':auth['access_token']};save();return ctx[suffix]
partner=ctx['access_token']
if '--resume' not in sys.argv:
 call({'action':'workspace'},expect=401)
 call({'action':'workspace'},'forged-token',expect=401)
 call({'action':'setup','token':ctx['setup_token'],'password':ctx['password']},expect=400)
 initial=call({'action':'workspace'},partner);assert initial['me']['category_code']=='PARTNER'
 for code in ['QAONE','QATWO']:
  if not any(f['firm_code']==code for f in initial['firms']):call({'action':'firm_save','firm_code':code,'legal_name':'Pilot QA firm '+code+' (temporary)'},partner)
 w=call({'action':'workspace'},partner);fa=next(f['firm_id'] for f in w['firms'] if f['firm_code']=='QAONE');fb=next(f['firm_id'] for f in w['firms'] if f['firm_code']=='QATWO');ctx['firms']=[fa,fb];save()
 m=staff(partner,'MANAGER','manager',fa);a=staff(m['access_token'],'ASSISTANT','assistant',fa);i=staff(m['access_token'],'INTERN','intern',fa)
 call({'action':'firm_save','firm_code':'FORBIDDEN','legal_name':'Forbidden'},m['access_token'],expect=403)
 call({'action':'staff_save','staff_identifier':'QA-BAD','login_id':'qa.bad','full_name':'Forbidden','category_code':'PARTNER','employment_type':'Permanent','firm_ids':[fa]},m['access_token'],expect=403)
 ca=call({'action':'client_save','company_name':'Pilot QA Client A','firm_ids':[fa]},m['access_token'])['client_id']
 cb=call({'action':'client_save','company_name':'Pilot QA Client B','firm_ids':[fb]},partner)['client_id'];ctx['clients']=[ca,cb];save()
 pa=call({'action':'project_save','client_id':ca,'firm_id':fa,'project_name':'Pilot QA Project A','service_code':'TAX-COMP','staff_id':a['staff_id']},m['access_token'])['project_id']
 pb=call({'action':'project_save','client_id':cb,'firm_id':fb,'project_name':'Pilot QA Project B','service_code':'TAX-COMP'},partner)['project_id'];ctx['projects']=[pa,pb];save()
 for person,label in [(a,'Assistant'),(i,'Intern')]:call({'action':'task_create','project_id':pa,'assigned_to':person['staff_id'],'task_name':'Pilot QA '+label+' task','due_date':str(date.today()),'description':'Fictional QA task.'},m['access_token'])
else:
 fa,fb=ctx['firms'];m,a,i=ctx['manager'],ctx['assistant'],ctx['intern'];ca,cb=ctx['clients'];pa,pb=ctx['projects']
aw=call({'action':'workspace'},a['access_token']);iw=call({'action':'workspace'},i['access_token']);mw=call({'action':'workspace'},m['access_token'])
assert {c['client_id'] for c in aw['clients']}=={ca}
assert all(p['handling_firm_id']==fa for p in mw['projects'])
assert iw['clients']==[] and iw['projects']==[]
assert len(iw['tasks'])==1 and iw['tasks'][0]['assigned_to']==i['staff_id']
assert all(t['assigned_to']==a['staff_id'] for t in aw['tasks'])
assert next(c for c in aw['clients'] if c['client_id']==ca)['missing_fields']==['KRA PIN','Primary Sector','Branch Location','Client Category']
ta=aw['tasks'][0];ti=iw['tasks'][0]
call({'action':'task_status','task_id':ta['task_id'],'revision':ta['revision'],'status':'In Progress'},a['access_token'])
call({'action':'task_status','task_id':ta['task_id'],'revision':ta['revision'],'status':'Completed'},a['access_token'],expect=409)
call({'action':'task_status','task_id':ti['task_id'],'revision':ti['revision'],'status':'Completed'},a['access_token'],expect=409)
call({'action':'staff_save'},a['access_token'],expect=403)
call({'action':'client_save'},i['access_token'],expect=403)
call({'action':'project_save','client_id':cb,'firm_id':fb,'project_name':'Forbidden','service_code':'TAX-COMP'},m['access_token'],expect=403)
da=upload(a['access_token'],ca,fa,pa,ta['task_id'])['document_id']
di=upload(partner,ca,fa,pa,ti['task_id'])['document_id']
db=upload(partner,cb,fb,pb,'','BRS Receipts')['document_id'];ctx['documents']=[da,di,db];save()
assert call({'action':'download','document_id':da},a['access_token']).startswith(b'%PDF-')
call({'action':'download','document_id':db},a['access_token'],expect=403)
call({'action':'download','document_id':da},i['access_token'],expect=403)
assert call({'action':'download','document_id':di},i['access_token']).startswith(b'%PDF-')
upload(i['access_token'],ca,fa,pa,ti['task_id'],expect=403)
link=call({'action':'account_link','staff_id':a['staff_id']},m['access_token'])
call({'action':'workspace'},a['access_token'],expect=401)
call({'action':'staff_disable','staff_id':i['staff_id']},m['access_token'])
call({'action':'workspace'},i['access_token'],expect=401)
call({'action':'logout'},m['access_token'])
call({'action':'workspace'},m['access_token'],expect=401)
ctx['test_result']={'requests_passed':len(checks),'checks':checks};save()
print(json.dumps({'status':'PASS','requests_passed':len(checks),'coverage':['staff ID login','single-use links','cross-firm denial','manager promotion denial','assigned tasks','optimistic concurrency','private uploads/downloads','intern restrictions','reset/disable/logout revocation']}))
