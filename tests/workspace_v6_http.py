"""Connected staging regression. Takes a private temporary Partner fixture; never commit credentials."""
import json,sys,uuid,secrets,urllib.request,urllib.error,pathlib,datetime
URL='https://yfjiculexbzpkvtapudk.supabase.co/functions/v1/staff-workspace-v6'
p=pathlib.Path(sys.argv[1]);ctx=json.loads(p.read_text());checks=[]
def save():p.write_text(json.dumps(ctx))
def call(body,token=None,expect=200):
 req=urllib.request.Request(URL,data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
 try:
  with urllib.request.urlopen(req,timeout=90) as r:status=r.status;out=json.load(r)
 except urllib.error.HTTPError as e:status=e.code;out=json.load(e)
 assert status==expect,(body.get('action'),status,out)
 checks.append((body['action'],status));print('PASS',body['action'],status,flush=True);return out
partner=ctx['access_token'];today=datetime.date.today();suffix=ctx['login_id'].split('.')[-1]
def upload(token,client,firm,project,task,path):
 boundary='---pcl'+uuid.uuid4().hex;chunks=[]
 for k,v in {'client_id':client,'firm_id':firm,'project_id':project,'task_id':task,'category':'Working Papers'}.items():chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
 chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="QA_working_paper.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'.encode()+pathlib.Path(path).read_bytes()+b'\r\n');chunks.append(f'--{boundary}--\r\n'.encode())
 req=urllib.request.Request(URL,data=b''.join(chunks),headers={'Authorization':'Bearer '+token,'Content-Type':'multipart/form-data; boundary='+boundary})
 with urllib.request.urlopen(req,timeout=90) as r:out=json.load(r);assert r.status==200
 print('PASS private XLSX upload',flush=True);return out['document_id']
def staff(category,firm):
 login='v6.'+category.lower()+'.'+suffix
 r=call({'action':'staff_save','staff_identifier':login,'login_id':login,'full_name':'V6 QA '+category,'category_code':category,'employment_type':'Permanent','firm_ids':[firm]},partner)
 link=call({'action':'account_link','staff_id':r['staff_id']},partner);pw='Qa-7aB-'+secrets.token_hex(15)
 call({'action':'setup','token':link['setup_url'].split('#setup=')[1],'password':pw})
 auth=call({'action':'login','login_id':login,'password':pw});out={'staff_id':r['staff_id'],'access_token':auth['access_token'],'login_id':login,'password':pw};ctx[category]=out;save();return out
if '--resume' not in sys.argv:
 call({'action':'workspace'},expect=401);call({'action':'workspace'},'forged',expect=401)
 call({'action':'firm_save','firm_code':'Q'+suffix.upper(),'legal_name':'V6 QA fictional firm'},partner)
 w=call({'action':'workspace'},partner);firm=next(f['firm_id'] for f in w['firms'] if f['firm_code']=='Q'+suffix.upper());ctx['firm']=firm;save()
 s=staff('SUPERVISOR',firm);a=staff('ASSISTANT',firm)
 c=call({'action':'client_save','company_name':'V6 QA fictional client','firm_ids':[firm]},partner)['client_id'];ctx['client']=c;save()
 base={'action':'project_save','client_id':c,'firm_id':firm,'service_code':'TAX-COMP','frequency':'Weekly + Monthly','pack':'Tax Compilation','starts_on':'2026-10-01','ends_on':'2026-12-31','assigned_to':a['staff_id'],'reviewer_id':s['staff_id'],'obligations':['VAT','PAYE']}
 r=call(base,partner);ctx['project']=r['project_id'];ctx['base']=base;save()
else:firm=ctx['firm'];c=ctx['client'];s=ctx['SUPERVISOR'];a=ctx['ASSISTANT'];base=ctx.get('base')
if 'project' not in ctx:
 base={'action':'project_save','client_id':c,'firm_id':firm,'service_code':'TAX-COMP','frequency':'Weekly + Monthly','pack':'Tax Compilation','starts_on':'2026-10-01','ends_on':'2026-12-31','assigned_to':a['staff_id'],'reviewer_id':s['staff_id'],'obligations':['VAT','PAYE']}
 r=call(base,partner);ctx['project']=r['project_id'];ctx['base']=base;save()
pid=ctx['project'];sw=call({'action':'workspace'},s['access_token']);aw=call({'action':'workspace'},a['access_token'])
assert len(sw['staff'])==1,'Supervisor should not receive HR directory'
assert all(t['assigned_to']==a['staff_id'] for t in aw['tasks'])
assert all(p['handling_firm_id']==firm for p in sw['projects'])
if 'supervisor_project' not in ctx:
 r=call({**base,'project_name':'V6 QA Supervisor-created project','frequency':'Once-off','pack':'General','starts_on':str(today),'ends_on':str(today)},s['access_token']);ctx['supervisor_project']=r['project_id'];save()
call({**base,'project_name':'Forbidden'},a['access_token'],403)
call({'action':'staff_save'},s['access_token'],403)
call({'action':'generate_tasks','project_id':pid},a['access_token'],403)
r=call({'action':'generate_tasks','project_id':pid},s['access_token']);assert r['generated']==0
r=call({'action':'schedule_preview','project_id':pid},s['access_token']);assert any(x['template_key']=='monthly-vat' for x in r['occurrences'])
if 'task' not in ctx:
 r=call({'action':'task_create','project_id':pid,'assigned_to':a['staff_id'],'task_name':'V6 QA assigned work','description':'Fictional test','due_date':str(today)},s['access_token']);ctx['task']=r['task_id'];save()
tid=ctx['task']
if 'time' not in ctx:
 r=call({'action':'timesheet_save','task_id':tid,'work_date':str(today),'hours':2,'description':'QA workbook review','status':'Submitted'},a['access_token']);ctx['time']=r['timesheet_id'];save()
w=call({'action':'workspace'},partner);tm=next(t for t in w['timesheets'] if t['timesheet_id']==ctx['time'])
if tm['status']=='Submitted':
 call({'action':'timesheet_review','timesheet_id':tm['timesheet_id'],'revision':tm['revision'],'status':'Approved'},a['access_token'],403)
 call({'action':'timesheet_review','timesheet_id':tm['timesheet_id'],'revision':tm['revision'],'status':'Approved'},s['access_token'],403)
 call({'action':'timesheet_review','timesheet_id':tm['timesheet_id'],'revision':tm['revision'],'status':'Approved'},partner)
call({'action':'timesheet_save','timesheet_id':tm['timesheet_id'],'task_id':tid,'revision':tm['revision'],'work_date':str(today),'hours':3,'description':'Tamper approved time'},a['access_token'],409)
if 'reversal' not in ctx:
 ctx['reversal']=call({'action':'timesheet_reverse','timesheet_id':tm['timesheet_id'],'reason':'QA correction'},partner)['timesheet_id'];save()
if 'document' not in ctx:ctx['document']=upload(a['access_token'],c,firm,pid,tid,sys.argv[2]);save()
doc=ctx['document'];preview=call({'action':'workbook_preview','document_id':doc,'sheet_name':'Purchases','header_row':1},a['access_token']);assert preview['headers'][0]=='Date'
imp={'action':'workbook_commit','document_id':doc,'sheet_name':'Purchases','header_row':1,'first_row':2,'last_row':5,'dataset':'Purchases','period_start':str(today.replace(day=1)),'period_end':str(today),'column_map':{'date':1,'invoice':2,'party_pin':3,'amount':4,'vat':5,'description':6}}
r=call(imp,a['access_token']);assert (r['new_count'],r['duplicate_count'],r['rejected_count']) in [(2,1,1),(0,3,1)],r
r=call(imp,a['access_token']);assert (r['source_count'],r['new_count'],r['duplicate_count'],r['rejected_count'])==(4,0,3,1),r
rows=call({'action':'workbook_rows','project_id':pid},a['access_token']);row=rows['rows'][0];cat=next(c for c in rows['categories'] if c['route']==1)
call({'action':'workbook_map','row_id':row['row_id'],'revision':row['revision'],'route':1,'category_code':cat['code'],'narration':'QA resalable goods'},a['access_token'])
report=call({'action':'project_report','project_id':pid},s['access_token']);assert report['imports']
# Editing a schedule keeps previously generated task IDs and future releases for the current period.
w=call({'action':'workspace'},s['access_token']);project=next(p for p in w['projects'] if p['project_id']==pid);before={t['task_id'] for t in w['tasks'] if t['project_id']==pid}
call({**base,'project_id':pid,'revision':project['revision'],'project_name':project['project_name'],'frequency':'Monthly'},s['access_token'])
w=call({'action':'workspace'},s['access_token']);assert before.issubset({t['task_id'] for t in w['tasks'] if t['project_id']==pid})
ctx['checks']=checks;save();print('PASS all connected V6 regression checks',len(checks),flush=True)
