# Execute the helper definitions only from the repository regression script.
import pathlib
root=pathlib.Path(__file__).resolve().parents[1]
s=(root/'tests/suite_http.py').read_text();exec(s[:s.index('P=call(')])
from concurrent.futures import ThreadPoolExecutor
with ThreadPoolExecutor(max_workers=2) as pool:
    futures=[pool.submit(call,{'action':'login','login_id':x['login_id'],'password':x['password']}) for x in [ctx,ctx['ASSISTANT']]]
    P,A=[f.result()['access_token'] for f in futures]
d=json.loads(state.read_text());cid=d['client'];pid=d['project'];firm=ctx['firm']
w=call({'action':'workspace'},A);tid=next(t['task_id'] for t in w['tasks'] if t['project_id']==pid)
existing=next((c for c in w['suite']['tax_cases'] if c['project_id']==pid and c['kind']=='VAT'),None)
if existing:case=existing['case_id']
else:
    b=Workbook();b.remove(b.active)
    for name,rows in {
    'Sales':[['Date','CU number','PIN','Net','VAT','Description'],['2026-10-01','QA-VAT-S-1','P000000001A',1000,160,'Fictional sale']],
    'Purchases':[['Date','CU number','PIN','Net','VAT','Description'],['2026-10-01','QA-VAT-P-1','P000000001A',400,64,'Fictional expense']],
    'Bank':[['Date','Reference','Debit','Credit','Description'],['2026-10-01','QA-BANK-1',0,1160,'Fictional sale receipt']]}.items():
        sh=b.create_sheet(name)
        for row in rows:sh.append(row)
    iofile=io.BytesIO();b.save(iofile)
    doc=multipart({'client_id':cid,'firm_id':firm,'project_id':pid,'task_id':tid,'category':'Working Papers'},iofile.getvalue(),'QA_VAT.xlsx',xlsx,A)['document_id']
    for ds in ['Sales','Purchases','Bank']:
        mp={'date':1,'invoice':2,'party_pin':3,'amount':4,'vat':5,'description':6} if ds!='Bank' else {'date':1,'reference':2,'debit':3,'credit':4,'description':5}
        call({'action':'workbook_commit','document_id':doc,'sheet_name':ds,'header_row':1,'first_row':2,'last_row':2,'dataset':ds,'period_start':'2026-10-01','period_end':'2026-10-23','column_map':mp},A)
    case=call({'action':'tax_create','project_id':pid,'kind':'VAT','starts_on':'2026-10-01','ends_on':'2026-10-23'},A)['case_id']
r=call({'action':'tax_read','case_id':case},A);assert r['unreviewed']>=0
row=next(x for x in r['rows'] if x['dataset']=='Purchases');call({'action':'workbook_map','row_id':row['row_id'],'revision':row['revision'],'route':2,'category_code':'EXP01','narration':'Fictional admin expense'},A)
r=call({'action':'tax_read','case_id':case},P)
purchase=next(x for x in r['rows'] if x['dataset']=='Purchases')
for row in r['rows']:
    call({'action':'tax_row_review','row_id':row['row_id'],'revision':row['revision'],'decision':'Eligible' if row['dataset']=='Purchases' else 'Confirmed','deductible_percentage':50,'reason':'Fictional independent verification and bank reconciliation'},P)
r=call({'action':'tax_read','case_id':case},A);assert r['result']['payable']==128,r['result']
call({'action':'tax_save','case_id':case,'revision':r['case']['revision'],'inputs':{'bank_reconciliation':'Fictional deposits agreed; differences reviewed against source invoices.','return_tied':True}},A)
r=call({'action':'tax_read','case_id':case},A);assert not r['issues'],r['issues']
call({'action':'tax_submit','case_id':case,'revision':r['case']['revision']},A)
r=call({'action':'tax_read','case_id':case},P);call({'action':'tax_review','case_id':case,'revision':r['case']['revision'],'status':'Locked','review_note':'Fictional independent review'},P)
call({'action':'workbook_map','row_id':purchase['row_id'],'revision':purchase['revision'],'route':2,'category_code':'EXP01','narration':'Blocked alteration'},A,400)
x=call({'action':'suite_export','kind':'Tax','record_id':case},P);z=zipfile.ZipFile(io.BytesIO(base64.b64decode(x['base64'])));assert '01_Summary_Report.pdf' in z.namelist()
print('PASS VAT uploaded sources, partial eligibility, independent decisions, bank control, locked source and reviewed export',flush=True)
