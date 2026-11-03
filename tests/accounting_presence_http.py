"""Connected staging acceptance; private fictional staff fixture only. Archives are handled by the operator after validation. No real data or credentials belong in git."""
import json,sys,pathlib,urllib.request,urllib.error,uuid,datetime,io
from openpyxl import Workbook
fixture=pathlib.Path(sys.argv[1]);ctx=json.loads(fixture.read_text());state=fixture.with_suffix('.accounting-session.json');D=json.loads(state.read_text()) if state.exists() else {}
URL='https://yfjiculexbzpkvtapudk.supabase.co/functions/v1/staff-workspace-v7';origin='https://backend-staging-foundation.pcl-crm.pages.dev'
def save():state.write_text(json.dumps(D));state.chmod(0o600)
def call(body,token=None,expect=200):
 req=urllib.request.Request(URL,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':origin,**({'Authorization':'Bearer '+token} if token else {})})
 try:
  with urllib.request.urlopen(req,timeout=90) as r:status=r.status;out=json.load(r)
 except urllib.error.HTTPError as e:status=e.code;out=json.load(e)
 assert status==expect,(body['action'],status,out.get('error','Unexpected response'))
 print('PASS',body['action'],status,flush=True);return out
P=call({'action':'login','login_id':ctx['login_id'],'password':ctx['password']})['access_token'];A=call({'action':'login',**{k:ctx['ASSISTANT'][k] for k in ['login_id','password']}})['access_token'];S=call({'action':'login',**{k:ctx['SUPERVISOR'][k] for k in ['login_id','password']}})['access_token']
D['tokens']={'PARTNER':P,'ASSISTANT':A,'SUPERVISOR':S};D['suffix']=D.get('suffix') or uuid.uuid4().hex[:7];save()
if 'client' not in D:D['client']=call({'action':'client_save','company_name':'A9 QA fictional '+D['suffix'],'primary_sector':'SME/Startup','branch_location':'Nairobi','client_category':'Corporate','firm_ids':[ctx['firm']]},P)['client_id'];save()
if 'project' not in D:D['project']=call({'action':'project_save','client_id':D['client'],'firm_id':ctx['firm'],'service_code':'TAX-COMP','frequency':'Weekly + Monthly','pack':'Tax Compilation','starts_on':'2026-09-01','ends_on':'2026-12-31','assigned_to':ctx['ASSISTANT']['staff_id'],'reviewer_id':ctx['SUPERVISOR']['staff_id'],'obligations':['VAT']},P)['project_id']
save();pid=D['project']
call({'action':'accounting_policy_save','project_id':pid,'inventory_method':'Perpetual','notes':'Fictional QA stock policy.'},A,403)
policy=call({'action':'accounting_read','project_id':pid},P)['policy']
if not policy:call({'action':'accounting_policy_save','project_id':pid,'inventory_method':'Perpetual','notes':'Fictional QA perpetual stock policy.'},P)
catalog=call({'action':'accounting_catalog'},A)['accounts'];assert len(catalog)==273
if 'task' not in D:D['task']=call({'action':'task_create','project_id':pid,'assigned_to':ctx['ASSISTANT']['staff_id'],'task_name':'Fictional timer QA','due_date':str(datetime.date.today())},P)['task_id'];save()
w=Workbook();w.remove(w.active)
for name,rows in [('Purchases',[['Date','Invoice','Supplier','PIN','Net','VAT'],['2026-09-10','QA-P1','Example supplier','P000000001A',1000,160],['2026-09-11','QA-P2','Example supplier','P000000001A',400,64]]),('Sales',[['Date','Invoice','Buyer','PIN','Net','VAT'],['2026-09-10','QA-S1','Example buyer','P000000002A',1000,160]]),('Bank',[['Date','Reference','Credit'],['2026-09-10','QA-B1',1160]])]:
 s=w.create_sheet(name)
 for row in rows:s.append(row)
buf=io.BytesIO();w.save(buf);boundary='A9'+uuid.uuid4().hex;parts=[]
for k,v in {'client_id':D['client'],'firm_id':ctx['firm'],'project_id':pid,'task_id':D['task'],'category':'Working Papers'}.items():parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="Fictional_accounting_QA.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'.encode()+buf.getvalue()+b'\r\n');parts.append(f'--{boundary}--\r\n'.encode())
with urllib.request.urlopen(urllib.request.Request(URL,data=b''.join(parts),headers={'Origin':origin,'Authorization':'Bearer '+P,'Content-Type':'multipart/form-data; boundary='+boundary}),timeout=90) as r:D['document']=json.load(r)['document_id']
save();print('PASS private synthetic workbook upload',flush=True)
for dataset in ['Purchases','Sales','Bank']:
 columns={'date':1,'reference':2,'credit':3} if dataset=='Bank' else {'date':1,'invoice':2,'party':3,'party_pin':4,'amount':5,'vat':6}
 base={'action':'workbook_commit','document_id':D['document'],'sheet_name':dataset,'dataset':dataset,'header_row':1,'period_start':'2026-09-01','period_end':'2026-09-30','column_map':columns}
 result=call(base,A);assert result['new_count']==(2 if dataset=='Purchases' else 1) and result['rejected_count']==0
 if dataset=='Purchases':assert call(base,A)['duplicate_count']==2
rows=call({'action':'workbook_rows','project_id':pid},A)['rows'];costs=[r for r in rows if r['dataset']=='Purchases'];refs=[{'row_id':r['row_id'],'revision':r['revision']} for r in costs]
call({'action':'workbook_map_bulk','project_id':pid,'rows':refs,'route':2,'account_code':'61010'},A)
call({'action':'workbook_map_bulk','project_id':pid,'rows':refs,'route':2,'account_code':'61010'},A,409)
rows=call({'action':'workbook_rows','project_id':pid},A)['rows'];mapped_row=next(x for x in rows if x['normalized'].get('invoice')=='QA-P2');r=next(r for r in rows if r['normalized'].get('invoice')=='QA-P1');parts=[{'route':1,'account_code':'10190','amount':600,'vat':96,'narration':'Inventory allocation'},{'route':2,'account_code':'61010','amount':400,'vat':64,'narration':'Expenditure allocation'}]
call({'action':'workbook_split','project_id':pid,'row_id':r['row_id'],'revision':r['revision'],'parts':parts},A)
preview=call({'action':'accounting_preview','project_id':pid},A);assert preview['debit']==preview['credit']==1624
call({'action':'presence_team'},A,403)

call({'action':'presence_heartbeat'},A)
call({'action':'clock','operation':'in','location':'Remote','reason':'Fictional QA attendance test'},A)
call({'action':'presence_state','state':'Break'},A)
call({'action':'timer_start','task_id':D['task']},A,400)
call({'action':'presence_state','state':'Auto'},A)
call({'action':'timer_start','task_id':D['task']},A)
call({'action':'timer_start','task_id':D['task']},A,400)
for r in rows:
 if r['dataset'] in ['Sales','Bank']:call({'action':'tax_row_review','row_id':r['row_id'],'revision':r['revision'],'decision':'Confirmed','vat_rate_key':'VAT_GENERAL','reason':'Fictional source confirmed by independent reviewer'},S)
D['reconciliation']=call({'action':'sales_recon_create','project_id':pid,'review_type':'Monthly','starts_on':'2026-09-01','ends_on':'2026-09-30'},A)['reconciliation_id'];save()
def recon():return call({'action':'sales_recon_read','project_id':pid,'reconciliation_id':D['reconciliation']},A)
c=recon();call({'action':'sales_recon_save','project_id':pid,'reconciliation_id':D['reconciliation'],'revision':c['record']['revision'],'inputs':{'pos_not_applicable_reason':'Fictional service client has no POS.','conclusion':'Synthetic sales gross exactly agrees to bank deposits.','allocations':[]}},A)
c=recon();assert c['result']['residual_gross']==0 and not c['result']['issues'];call({'action':'sales_recon_submit','project_id':pid,'reconciliation_id':D['reconciliation'],'revision':c['record']['revision']},A)
c=recon();call({'action':'sales_recon_review','project_id':pid,'reconciliation_id':D['reconciliation'],'revision':c['record']['revision'],'status':'Locked','review_note':'Own approval must fail.'},A,403)
call({'action':'sales_recon_review','project_id':pid,'reconciliation_id':D['reconciliation'],'revision':c['record']['revision'],'status':'Locked','review_note':'Independent synthetic reconciliation validated.'},S)
c=recon();assert c['record']['status']=='Locked' and c['result']['etims']['net']==1000
call({'action':'workbook_map_bulk','project_id':pid,'rows':[{'row_id':mapped_row['row_id'],'revision':mapped_row['revision']}],'route':2,'account_code':'61010'},A,400)
print('PASS accounting, independent review, source locks, presence scopes and timers; age the saved QA timer, then complete time/logout checks.',flush=True)
