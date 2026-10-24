"""Staging-only procedure verification. Requires private fictional fixture IDs and staff credentials. No real clients, KRA filings, mail or payments are used."""
import pathlib,json,sys,urllib.request,urllib.error,uuid,io,datetime,zoneinfo,base64,zipfile
from concurrent.futures import ThreadPoolExecutor
from reportlab.pdfgen import canvas
ctx=json.loads(pathlib.Path(sys.argv[1]).read_text());fixture=pathlib.Path(sys.argv[2]);q=json.loads(fixture.read_text());url='https://yfjiculexbzpkvtapudk.supabase.co/functions/v1/staff-workspace-v7';today=str(datetime.datetime.now(zoneinfo.ZoneInfo('Africa/Nairobi')).date())
def call(body,token=None,expected=200):
 req=urllib.request.Request(url,data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+token} if token else {})})
 try:
  with urllib.request.urlopen(req,timeout=90) as r:status=r.status;out=json.load(r)
 except urllib.error.HTTPError as e:status=e.code;out=json.load(e)
 assert status==expected,(body['action'],status,out.get('error','Unexpected response'));print('PASS',body['action'],body.get('operation',''),status,flush=True);return out
with ThreadPoolExecutor(max_workers=3) as pool:
 args=[ctx,ctx['ASSISTANT'],ctx['SUPERVISOR']];tokens=list(pool.map(lambda c:call({'action':'login','login_id':c['login_id'],'password':c['password']})['access_token'],args))
P,A,S=tokens;q['tokens']={'PARTNER':P,'ASSISTANT':A,'SUPERVISOR':S};fixture.write_text(json.dumps(q));fixture.chmod(0o600)
def upload(label):
 out=io.BytesIO();p=canvas.Canvas(out);p.drawString(72,720,'FICTIONAL UAT ONLY - NOT FOR FILING');p.drawString(72,700,label+' - no real client approval or KRA acknowledgment');p.save();boundary='PR9'+uuid.uuid4().hex;parts=[]
 for k,v in {'client_id':q['client'],'firm_id':ctx['firm'],'project_id':q['project'],'task_id':q['task'],'category':'Working Papers'}.items():parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
 parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="Fictional_{label}.pdf"\r\nContent-Type: application/pdf\r\n\r\n'.encode()+out.getvalue()+b'\r\n');parts.append(f'--{boundary}--\r\n'.encode());req=urllib.request.Request(url,data=b''.join(parts),headers={'Authorization':'Bearer '+A,'Content-Type':'multipart/form-data; boundary='+boundary})
 with urllib.request.urlopen(req,timeout=90) as r:data=json.load(r)
 print('PASS fictional PDF upload',label,flush=True);return data['document_id']
if 'approval' in q and 'receipt' in q:approval,receipt=q['approval'],q['receipt']
else:
 with ThreadPoolExecutor(max_workers=2) as pool:approval,receipt=list(pool.map(upload,['written_approval','acknowledgment']))
q['approval']=approval;q['receipt']=receipt;fixture.write_text(json.dumps(q))
def read(token=A):return call({'action':'procedure_read','task_id':q['task']},token)['record']
def act(op,token=A,expected=200,**fields):
 w=read(token);return call({'action':'procedure_action','task_id':q['task'],'revision':w['revision'],'operation':op,'message':'Fictional UAT: verify '+op+' with no real legal effect.',**fields},token,expected)
stage=read()['stage']
if stage in ['Pending preparer','Pending client documents']:
 act('file',expected=400,filing_date=today,filing_document_id=receipt)
 act('setup',profile='Tax filing',case_id=q['case'],reviewer_id=ctx['SUPERVISOR']['staff_id'],contact_id=q['contact'],protocol='Secure email',authority_reference='Fictional EL Section 11 fixture',cutoff_on=str(datetime.date.fromisoformat(today)+datetime.timedelta(days=1)),statutory_due_on=str(datetime.date.fromisoformat(today)+datetime.timedelta(days=2)),protocol_note='Fictional encrypted email delivery; passwords through another channel.',received_on=today)
 act('query');act('resume',received_on=today);act('note',message='Fictional supporting records mapped; reviewer to confirm source reconciliation.');act('submit');stage='Pending supervisor review'
if stage=='Pending supervisor review':act('approve',expected=403);act('approve',token=S);stage='Awaiting client approval'
if stage=='Awaiting client approval':
 pdf=call({'action':'suite_export','kind':'ApprovalSummary','record_id':q['task']},S);assert pdf['mime']=='application/pdf' and base64.b64decode(pdf['base64']).startswith(b'%PDF')
 act('file',expected=400,filing_date=today,filing_document_id=receipt,testing_simulation_confirmed=True);act('client-approval',approval_document_id=approval,approved_on=today);stage='Ready to file'
if stage=='Ready to file':
 act('file',expected=400,filing_date=today,filing_document_id=receipt,no_prn_reason='Fictional nil return - no PRN issued.');act('file',filing_date=today,filing_document_id=receipt,no_prn_reason='Fictional nil return - no PRN issued.',testing_simulation_confirmed=True);stage='Filed - pending payment'
if stage=='Filed - pending payment':
 act('close',expected=403,evidence_verified=True,payment_outcome='Not payable');act('close',token=S,expected=403,evidence_verified=True,payment_outcome='Not payable');act('close',token=P,evidence_verified=True,payment_outcome='Not payable',message='Fictional zero-liability fixture. Manager verified the simulated filing and that no payment is payable.')
assert read()['stage']=='Closed';act('note',expected=400)
r=call({'action':'suite_export','kind':'Procedure','record_id':q['task']},P);z=zipfile.ZipFile(io.BytesIO(base64.b64decode(r['base64'])));assert '01_Status_Report.pdf' in z.namelist() and '02_Status_Register.xlsx' in z.namelist()
# Preview a separate WHT case to ensure provisional schedules apply only as test calculations.
c=q.get('preview_case') or call({'action':'tax_create','project_id':q['project'],'kind':'WHT','starts_on':'2026-09-01','ends_on':'2026-09-30'},A)['case_id'];q['preview_case']=c;fixture.write_text(json.dumps(q));w=call({'action':'tax_read','case_id':c},A)
r=call({'action':'tax_preview','case_id':c,'revision':w['case']['revision'],'inputs':{'payment_code':'KE_WHT_CONTRACT_RES','taxable_payment':100000,'return_tied':False}},A);assert r['result']['testing_only'] and any(x.get('approval_scope')=='Testing' for x in r['applied_rates'])
# Attendance ignores forged clock timestamps and keyed break amounts.
w=call({'action':'workspace'},P);clock_token=P
if any(x['staff_id']==ctx['staff_id'] and x['work_date'].startswith(today) for x in w['suite']['attendance']):clock_token=S
r=call({'action':'clock','operation':'in','location':'Remote','reason':'Fictional automatic time test','clock_in':'2000-01-01T00:00:00Z'},clock_token);assert r['clock_in'].startswith(today)
r=call({'action':'presence_clock_out','clock_out':'2000-01-01T00:00:00Z','break_minutes':9999},clock_token);assert r['clock_out'].startswith(today) and r['break_minutes']==0
print('PASS complete simulated procedure, independent closure, test-rate preview and automatic attendance timestamps.',flush=True)
