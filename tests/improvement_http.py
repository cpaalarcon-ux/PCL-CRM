"""Connected staging acceptance using an operator-provisioned fictional Partner only.
The private fixture and all credentials must remain outside the repository.
"""
import sys,json,pathlib,urllib.request,urllib.error,secrets,io,datetime
from openpyxl import Workbook
fixture=pathlib.Path(sys.argv[1]);ctx=json.loads(fixture.read_text());URL='https://yfjiculexbzpkvtapudk.supabase.co/functions/v1/staff-workspace-v8';origin='https://backend-staging-foundation.pcl-crm.pages.dev';checks=[]
def save():fixture.write_text(json.dumps(ctx));fixture.chmod(0o600)
def call(body,token=None,expect=200):
 req=urllib.request.Request(URL,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':origin,**({'Authorization':'Bearer '+token} if token else {})})
 try:
  with urllib.request.urlopen(req,timeout=90) as r:status=r.status;out=json.load(r)
 except urllib.error.HTTPError as e:status=e.code;out=json.load(e)
 assert status==expect,(body['action'],status,out.get('error','Unexpected response'))
 checks.append(body['action']);print('PASS',body['action'],status,flush=True);return out
if not ctx.get('setup_done'):call({'action':'setup','token':ctx['setup_token'],'password':ctx['password']});ctx['setup_done']=True;save()
P=call({'action':'login','login_id':ctx['login_id'],'password':ctx['password']})['access_token'];ctx['access_token']=P;save()
for role in ['MANAGER','ASSISTANT']:
 if role not in ctx:
  r=call({'action':'staff_save','staff_identifier':'V3'+role+ctx['suffix'],'login_id':'v3.'+role.lower()+'.'+ctx['suffix'],'full_name':'Fictional V3 '+role+' - temporary','category_code':role,'employment_type':'Permanent','billing_status':'Billable','branch_location':'Nairobi','firm_ids':[ctx['firm']]},P);ctx[role]={**r,'login_id':'v3.'+role.lower()+'.'+ctx['suffix'],'password':'V3test!'+secrets.token_hex(20)};save()
 s=ctx[role]
 if not s.get('setup_done'):
  link=call({'action':'account_link','staff_id':s['staff_id']},P);call({'action':'setup','token':link['setup_url'].split('#setup=')[1],'password':s['password']});s['setup_done']=True;save()
 s['access_token']=call({'action':'login','login_id':s['login_id'],'password':s['password']})['access_token'];save()
A=ctx['ASSISTANT']['access_token'];M=ctx['MANAGER']['access_token'];call({'action':'workspace'},P)
if 'client' not in ctx:ctx['client']=call({'action':'client_save','company_name':'Fictional V3 release client '+ctx['suffix'],'primary_sector':'SME/Startup','branch_location':'Nairobi','client_category':'Corporate','firm_ids':[ctx['firm']]},P)['client_id'];save()
c=call({'action':'v3_client_read','client_id':ctx['client']},P)['client'];call({'action':'v3_identity_save','client_id':ctx['client'],'revision':c['revision'],'legal_entity_type':'Limited company','entity_evidence':'Fictional incorporation verification for acceptance testing only','year_end_month':'6','year_end_day':'30'},P)
if 'activity' not in ctx:ctx['activity']=call({'action':'v3_activity_add','client_id':ctx['client'],'pack_code':'Wholesale','activity_name':'Fictional wholesale','income_stream':'Business','effective_from':'2026-01-01','evidence':'Fictional client activity verification'},P)['activity_id'];save()
if 'policy' not in ctx:ctx['policy']=call({'action':'v3_stock_policy_add','client_id':ctx['client'],'activity_id':ctx['activity'],'inventory_method':'Periodic','effective_from':'2026-01-01','count_frequency':'Monthly','variance_threshold':100,'valuation_basis':'Fictional supported cost','evidence':'Fictional acceptance policy'},P)['policy_id'];save()
if 'project' not in ctx:ctx['project']=call({'action':'project_save','client_id':ctx['client'],'firm_id':ctx['firm'],'service_code':'TAX-COMP','frequency':'Once-off','pack':'Tax Compilation','starts_on':'2026-09-01','ends_on':'2026-09-30','assigned_to':ctx['ASSISTANT']['staff_id'],'reviewer_id':ctx['MANAGER']['staff_id'],'obligations':['VAT']},P)['project_id'];save()
pid=ctx['project'];call({'action':'v3_project_read','project_id':pid},A);call({'action':'v3_identity_save','client_id':ctx['client'],'revision':c['revision']},A,403)
if 'task' not in ctx:ctx['task']=call({'action':'task_create','project_id':pid,'assigned_to':ctx['ASSISTANT']['staff_id'],'task_name':'Fictional V3 source mapping acceptance','due_date':'2026-12-31'},P)['task_id'];save()
w=Workbook();s=w.active;s.title='Fictional Purchases';s.append(['Date','Invoice','Supplier','PIN','Net','VAT'])
for n in range(205):s.append([datetime.datetime(2026,9,10),'V3-'+ctx['suffix']+'-'+str(n+1),'Fictional supplier','P000000001A',100,0])
s.append([datetime.datetime(2026,9,10),'V3-BAD-'+ctx['suffix'],'Fictional supplier','P000000001A',datetime.datetime(2026,9,10),0]);buf=io.BytesIO();w.save(buf)
if 'document' not in ctx:
 boundary='V3'+secrets.token_hex(16);parts=[]
 for k,v in {'client_id':ctx['client'],'firm_id':ctx['firm'],'project_id':pid,'task_id':ctx['task'],'category':'Working Papers'}.items():parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
 parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="Fictional_V3_Purchases.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'.encode()+buf.getvalue()+b'\r\n');parts.append(f'--{boundary}--\r\n'.encode())
 with urllib.request.urlopen(urllib.request.Request(URL,data=b''.join(parts),headers={'Origin':origin,'Authorization':'Bearer '+P,'Content-Type':'multipart/form-data; boundary='+boundary}),timeout=90) as r:ctx['document']=json.load(r)['document_id']
 save();print('PASS private fictional XLSX upload',flush=True)
base={'action':'workbook_commit','document_id':ctx['document'],'sheet_name':s.title,'header_row':1,'dataset':'Purchases','period_start':'2026-09-01','period_end':'2026-09-30','column_map':{'date':1,'invoice':2,'party':3,'party_pin':4,'amount':5,'vat':6}}
first=call(base,P);assert first['source_count']==206 and first['rejected_count']==1
second=call(base,P);assert second['new_count']==0 and second['duplicate_count']==205
rows=call({'action':'workbook_rows','project_id':pid,'dataset':'Costs'},A);assert rows['total']==205
selection=call({'action':'v3_mapping_select','project_id':pid,'dataset':'Costs','mapping':'All','search':'Fictional supplier'},A);assert selection['count']==205 and selection['net']==20500
mapping={'action':'workbook_map_bulk','project_id':pid,'selection_id':selection['selection_id'],'selection_hash':selection['selection_hash'],'route':1,'account_code':'50000','activity_id':ctx['activity'],'stock_class':'Merchandise'}
assert call(mapping,A)['count']==205;assert call(mapping,A)['count']==205
rows=call({'action':'workbook_rows','project_id':pid,'dataset':'Costs'},A);row=rows['rows'][0];assert row['account_code']=='50000'
call({'action':'workbook_mapping_undo','project_id':pid,'row_id':row['row_id'],'revision':row['revision']},A)
row=next(x for x in call({'action':'workbook_rows','project_id':pid,'dataset':'Costs'},A)['rows'] if x['row_id']==row['row_id']);assert row['account_code'] is None
call({'action':'workbook_map','project_id':pid,'row_id':row['row_id'],'revision':row['revision'],'route':1,'account_code':'50000','activity_id':ctx['activity'],'stock_class':'Merchandise'},A)
r=call({'action':'v3_category_request','project_id':pid,'row_id':row['row_id'],'proposed_name':'Fictional category request','reason':'Fictional missing category acceptance case','evidence':'Fictional source invoice'},A)
pending=next(x for x in call({'action':'v3_project_read','project_id':pid},M)['requests'] if x['request_id']==r['request_id']);call({'action':'v3_category_decide','project_id':pid,'request_id':r['request_id'],'revision':pending['revision'],'status':'Approved','account_code':'61010','decision_note':'Use the existing detailed account after confirming actual item use.'},M)
if 'control' not in ctx:ctx['control']=call({'action':'v3_stock_create','project_id':pid,'activity_id':ctx['activity'],'stock_class':'Merchandise','starts_on':'2026-09-01','ends_on':'2026-09-30'},A)['control_id'];save()
stock=call({'action':'v3_stock_read','project_id':pid,'control_id':ctx['control']},A);assert stock['source']['selected_count']==205
call({'action':'v3_stock_submit','project_id':pid,'control_id':ctx['control'],'revision':stock['record']['revision']},A,400)
ready=call({'action':'v3_export_readiness','project_id':pid,'kind':'IT2C','starts_on':'2026-01-01','ends_on':'2026-12-31'},M);assert ready['ready'] is False
ctx['checks']=checks;save();print('PASS connected release: XLSX date controls, 205-row duplicate-safe imports, snapshot mapping, idempotent retry, undo, category review, stock submission gate and unsupported-return gate.',flush=True)
