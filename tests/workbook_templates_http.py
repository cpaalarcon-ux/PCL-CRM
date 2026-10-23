"""Staging workbook regression; private fixture credentials and real workbooks stay outside git."""
import json,sys,pathlib,urllib.request,urllib.error,uuid
ctx_path=pathlib.Path(sys.argv[1]);ctx=json.loads(ctx_path.read_text());token=ctx['access_token'];assistant=ctx['ASSISTANT']['access_token'];checks=[]
URL='https://yfjiculexbzpkvtapudk.supabase.co/functions/v1/staff-workspace-v6'
def call(body,auth=token,expect=200):
 req=urllib.request.Request(URL,data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+auth} if auth else {})})
 try:
  with urllib.request.urlopen(req,timeout=90) as r:status=r.status;out=json.load(r)
 except urllib.error.HTTPError as e:status=e.code;out=json.load(e)
 assert status==expect,(body.get('action'),status,out)
 checks.append([body['action'],status]);print('PASS',body['action'],status,flush=True);return out
if 'template_document' not in ctx:
 boundary='pcl'+uuid.uuid4().hex;chunks=[]
 for k,v in {'client_id':ctx['client'],'firm_id':ctx['firm'],'project_id':ctx['project'],'task_id':ctx['task'],'category':'Working Papers'}.items():chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
 chunks.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="QA_template_workbook.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'.encode()+pathlib.Path(sys.argv[2]).read_bytes()+b'\r\n');chunks.append(f'--{boundary}--\r\n'.encode())
 req=urllib.request.Request(URL,data=b''.join(chunks),headers={'Authorization':'Bearer '+token,'Content-Type':'multipart/form-data; boundary='+boundary})
 with urllib.request.urlopen(req,timeout=90) as r:ctx['template_document']=json.load(r)['document_id']
 ctx_path.write_text(json.dumps(ctx));print('PASS private template upload',flush=True)
doc=ctx['template_document'];base={'document_id':doc,'period_start':'2026-10-01','period_end':'2026-10-31'}
call({'action':'workbook_preview','document_id':doc},auth=None,expect=401)
r=call({'action':'workbook_preview','document_id':doc},auth=assistant);assert r['template']['kind']=='B02' and len(r['template']['blocks'])==2
call({**base,'action':'workbook_commit','dataset':'General'},expect=400)
call({**base,'action':'workbook_commit','last_row':308},expect=400)
r=call({**base,'action':'workbook_commit'},auth=assistant);assert (r['source_count'],r['duplicate_count'],r['rejected_count']) in [(6,1,2),(6,4,2)],r;assert r['new_count'] in [0,3]
r=call({**base,'action':'workbook_commit'},auth=assistant);assert (r['source_count'],r['new_count'],r['duplicate_count'],r['rejected_count'])==(6,0,4,2),r
r=call({**base,'action':'workbook_preview','header_row':307});assert r['template']['selected']['period_start']=='2026-11-01'
r=call({**base,'action':'workbook_commit','sheet_name':'B03 Expenditure Review','header_row':5});assert r['source_count']==2 and r['rejected_count']==1 and r['new_count']+r['duplicate_count']==1,r
r=call({**base,'action':'workbook_commit','sheet_name':'D09 Non-eTIMS Expenditure','header_row':21});assert r['source_count']==2 and r['rejected_count']==0 and r['new_count']+r['duplicate_count']==2,r
r=call({'action':'workbook_rows','project_id':ctx['project']},auth=assistant)
rows=[x for x in r['rows'] if x['document_id']==doc];assert len(rows)==6,len(rows)
assert sum(x['dataset']=='Non-eTIMS' for x in rows)==2
assert any(x['normalized']['amount']==-100 for x in rows)
n=next(x for x in rows if x['normalized'].get('invoice')=='QA-RECEIPT-001')
assert 'Approved' in n['raw_values'].values() and any('reviewer confirmation' in w for w in n['warnings'])
p=next(x for x in rows if x['dataset']=='Purchases')
call({'action':'workbook_map','row_id':p['row_id'],'revision':p['revision'],'route':3,'category_code':'PPE00','narration':'QA asset'},auth=assistant,expect=400)
call({'action':'workbook_map','row_id':n['row_id'],'revision':n['revision'],'route':2,'category_code':'EXP01','narration':'QA licence review','legal_category':'Other supported exception','legal_basis':'Needs reviewer verification','evidence':'QA receipt.pdf'},auth=assistant)
call({'action':'workbook_map','row_id':n['row_id'],'revision':n['revision'],'route':2,'category_code':'EXP01','narration':'stale edit'},auth=assistant,expect=409)
r=call({'action':'workbook_rows','project_id':ctx['project']},auth=assistant);updated=next(x for x in r['rows'] if x['row_id']==n['row_id']);assert updated['normalized']==n['normalized'] and updated['raw_values']==n['raw_values'];assert updated['review_details']['evidence']=='QA receipt.pdf'
call({'action':'workbook_rows','project_id':str(uuid.uuid4())},auth=assistant,expect=403)
call({'action':'project_report','project_id':ctx['project']})
ctx['template_checks']=checks;ctx_path.write_text(json.dumps(ctx));print('PASS all connected workbook checks',len(checks),flush=True)
