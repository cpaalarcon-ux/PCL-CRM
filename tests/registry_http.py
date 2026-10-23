"""Staging integration, fictional fixtures only. Private credentials remain outside git."""
import pathlib,sys,json,datetime,uuid,io,base64,zipfile
# Reuse request/upload helpers without running the older acceptance sequence.
exec(compile(pathlib.Path(__file__).with_name('suite_http.py').read_text().split("P=call(",1)[0],str(pathlib.Path(__file__).with_name('suite_http.py')),'exec'))
state=fixture.with_suffix('.registry.json');D={};state.write_text('{}');state.chmod(0o600)
def save():state.write_text(json.dumps(D))
P=call({'action':'login','login_id':ctx['login_id'],'password':ctx['password']})['access_token'];A=call({'action':'login','login_id':ctx['ASSISTANT']['login_id'],'password':ctx['ASSISTANT']['password']})['access_token'];S=call({'action':'login','login_id':ctx['SUPERVISOR']['login_id'],'password':ctx['SUPERVISOR']['password']})['access_token']
D['sessions']=[P,A,S];save()
def w(token=P):return call({'action':'workspace'},token)
def get(key,col,value):return next(x for x in w()['suite'][key] if x[col]==value)
firm=ctx['firm'];today=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(hours=3)).date().isoformat();stamp=uuid.uuid4().hex[:8]
cid=call({'action':'client_save','company_name':'R8 QA fictional '+stamp,'kra_pin':'P'+str(int(stamp,16)).zfill(10)[-9:]+'Q','primary_sector':'SME/Startup','branch_location':'Nairobi','client_category':'Individual','firm_ids':[firm]},P)['client_id'];D['client']=cid;save()
lead_payload={'action':'lead_save','request_id':str(uuid.uuid4()),'firm_id':firm,'company_name':'R8 QA fictional '+stamp,'kra_pin':'P'+str(int(stamp,16)).zfill(10)[-9:]+'Q','primary_sector':'SME/Startup','branch_location':'Nairobi','service_code':'TAX-COMP','lead_source':'Referral','temperature':'Warm','stage':'Scoping & KYC','contact_name':'Fictional contact'}
call(lead_payload,A,403)
lid=call(lead_payload,P)['lead_id'];assert call(lead_payload,P)['lead_id']==lid;D['lead']=lid;save()
l=get('leads','lead_id',lid);call({'action':'lead_convert','lead_id':lid,'revision':l['revision']},P,409)
converted=call({'action':'lead_convert','lead_id':lid,'revision':l['revision'],'client_id':cid},P);assert converted['client_id']==cid
assert call({'action':'lead_convert','lead_id':lid,'revision':l['revision'],'client_id':cid},P)['already_converted']
assert not w(A)['suite']['leads']
lead_payload={**lead_payload,'request_id':str(uuid.uuid4()),'company_name':'R8 QA new lead '+stamp,'kra_pin':None}
lid2=call(lead_payload,P)['lead_id'];l2=get('leads','lead_id',lid2);newclient=call({'action':'lead_convert','lead_id':lid2,'revision':l2['revision']},P)['client_id'];D['lead_client']=newclient;save()
assert not any(p['client_id']==newclient for p in w()['projects'])
pid=call({'action':'project_save','client_id':cid,'firm_id':firm,'service_code':'TAX-COMP','frequency':'Weekly + Monthly + Annually','pack':'Tax Compilation','starts_on':'2026-10-01','ends_on':'2026-12-31','assigned_to':ctx['ASSISTANT']['staff_id'],'reviewer_id':ctx['SUPERVISOR']['staff_id'],'obligations':['VAT','PAYE']},P)['project_id'];D['project']=pid;save()
r=call({'action':'schedule_preview','project_id':pid},P);assert any(x['template_key'].startswith('annual-') for x in r['occurrences'])
r=call({'action':'engagement_read','project_id':pid},P);assert r['is_audit']==False and not all(x['ok'] for x in r['checks'])
call({'action':'engagement_save_activate','project_id':pid,'stage':'Accepted','eqr_required':True,'notes':'Must roll back without KYC'},P,400)
assert not any(x['project_id']==pid for x in w()['suite']['engagements'])
call({'action':'engagement_save','project_id':pid,'stage':'Accepted','eqr_required':True,'eqr_reviewer_id':ctx['SUPERVISOR']['staff_id'],'notes':'Tax has no audit EQR'},P)
e=get('engagements','project_id',pid);assert not e['eqr_required'] and e['eqr_reviewer_id'] is None
out=io.BytesIO();pdf=canvas.Canvas(out);pdf.drawString(72,720,'Fictional R8 QA evidence only');pdf.save();raw=out.getvalue()
permanent=multipart({'client_id':cid,'firm_id':firm,'category':'Permanent File'},raw,'R8_identity.pdf','application/pdf',P)['document_id'];letter=multipart({'client_id':cid,'firm_id':firm,'project_id':pid,'category':'Signed Engagement Letters'},raw,'R8_signed_letter.pdf','application/pdf',P)['document_id'];D['documents']=[permanent,letter];save()
call({'action':'compliance_save','client_id':cid,'entity_type':'Sole proprietor','risk_rating':'Low','is_pep':False,'conflict_checked':True,'sanctions_date':today,'sanctions_result':'Fictional QA check','review_due':'2027-10-01','incorporation_document':permanent,'pin_document':permanent,'notes':'QA only'},P)
k=get('compliance','client_id',cid);call({'action':'compliance_verify','client_id':cid,'revision':k['revision']},P)
call({'action':'engagement_save_activate','project_id':pid,'revision':e['revision'],'stage':'Accepted','signed_letter_id':letter,'letter_expires_on':'2027-10-01','eqr_required':True},P)
assert next(p for p in w()['projects'] if p['project_id']==pid)['status']=='Active'
profile=call({'action':'tax_profile_save','client_id':cid,'entity_type':'Individual','residency':'Resident','regime':'Standard','obligations':['VAT','PAYE','Individual'],'annual_turnover':2000000,'effective_from':'2026-01-01','effective_to':'2026-12-31','notes':'Fictional reviewed profile'},P)['profile_id'];D['profile']=profile;save()
p=get('tax_profiles','profile_id',profile);call({'action':'tax_profile_verify','profile_id':profile,'revision':p['revision'],'confirm_obligations':True},A,403);call({'action':'tax_profile_verify','profile_id':profile,'revision':p['revision'],'confirm_obligations':True},P)
case=call({'action':'tax_create','project_id':pid,'kind':'PAYE','starts_on':'2026-10-01','ends_on':'2026-10-31'},A)['case_id'];D['case']=case;save()
c=call({'action':'tax_read','case_id':case},A)['case'];preview=call({'action':'tax_preview','case_id':case,'revision':c['revision'],'source_document_id':letter,'inputs':{'employees':[{'name':'Fictional employee','gross':200000,'resident':True,'source_paye':0}]}},A,403) # restricted signed letter is not staff workpaper evidence
preview=call({'action':'tax_preview','case_id':case,'revision':c['revision'],'inputs':{'employees':[{'name':'Fictional employee','gross':200000,'resident':True,'source_paye':0}]}},A);assert any('Applicable approved rate missing' in x for x in preview['issues']);assert preview['profile']['profile_id']==profile
call({'action':'tax_submit','case_id':case,'revision':c['revision']},A,400)
catalog=[r for r in w()['suite']['rates'] if r.get('catalog_source')=='KE-20261024'];assert len(catalog)==35 and all(r['status']=='Draft' for r in catalog)
rate=catalog[0];call({'action':'rate_approve','rate_id':rate['rate_id'],'revision':rate['revision'],'confirm_legal_basis':False},P,400)
call({'action':'release_read'},A,403);ready=call({'action':'release_read'},P);assert len(ready['checks'])==12
comm=call({'action':'communication_save','client_id':cid,'firm_id':firm,'project_id':pid,'signatory_id':ctx['staff_id'],'request_id':str(uuid.uuid4()),'channel':'Letter','subject':'Fictional QR test','purpose':'Testing','details':'Fictional communication','communication_date':today},P)['communication_id'];D['communication']=comm;save()
qr=call({'action':'communication_qr','communication_id':comm},P);call({'action':'communication_resolve','opaque_reference':qr['opaque_reference']},None,401);resolved=call({'action':'communication_resolve','opaque_reference':qr['opaque_reference']},A);assert resolved['communication']['communication_id']==comm
other=call({'action':'client_save','company_name':'R8 QA unassigned '+stamp,'firm_ids':[firm]},P)['client_id'];D['other_client']=other;save()
private=call({'action':'communication_save','client_id':other,'firm_id':firm,'signatory_id':ctx['staff_id'],'request_id':str(uuid.uuid4()),'channel':'Letter','subject':'Private QA letter','purpose':'Access test','details':'Fictional','communication_date':today},P)['communication_id'];privateqr=call({'action':'communication_qr','communication_id':private},P);call({'action':'communication_resolve','opaque_reference':privateqr['opaque_reference']},A,403)
export=call({'action':'suite_export','kind':'Tax','record_id':case},A);z=zipfile.ZipFile(io.BytesIO(base64.b64decode(export['base64'])));assert '02_Working_Papers.xlsx' in z.namelist()
assert w()['suite']['tax_profiles'];D['complete']=True;save();print('PASS leads, registry, activation, combined recurrence, QR privacy and draft export integration')
