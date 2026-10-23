"""Setup-link staging checks using a private fictional fixture. Never pass real staff credentials."""
import json,sys,pathlib,urllib.request,urllib.error,secrets,datetime,hashlib
p=pathlib.Path(sys.argv[1]);ctx=json.loads(p.read_text());phase=sys.argv[2]
URL='https://yfjiculexbzpkvtapudk.supabase.co/functions/v1/staff-workspace-v6'
def save():p.write_text(json.dumps(ctx))
def call(body,auth=None,expect=200):
 req=urllib.request.Request(URL,data=json.dumps(body).encode(),headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+auth} if auth else {})})
 try:
  with urllib.request.urlopen(req,timeout=60) as r:status=r.status;out=json.load(r)
 except urllib.error.HTTPError as e:status=e.code;out=json.load(e)
 assert status==expect,(body['action'],status,out)
 print('PASS',body['action'],status,out.get('state',''),flush=True);return out
def state(token,expected):
 r=call({'action':'setup_status','token':token});assert r['state']==expected;return r
def issue():
 r=call({'action':'account_link','staff_id':ctx['target_staff_id']},ctx['access_token'])
 assert r['expires_in_hours']==24
 seconds=(datetime.datetime.fromisoformat(r['expires_at'].replace('Z','+00:00'))-datetime.datetime.fromisoformat(r['created_at'].replace('Z','+00:00'))).total_seconds()
 assert seconds==86400
 return r['setup_url'].split('#setup=')[1]
if phase=='initial':
 state(ctx['setup_token'],'ready');call({'action':'setup','token':ctx['setup_token'],'password':ctx['password']})
 ctx['access_token']=call({'action':'login','login_id':ctx['login_id'],'password':ctx['password']})['access_token'];save()
 ctx['first']=issue();state(ctx['first'],'ready');state(ctx['first'],'ready')
 ctx['second']=issue();save();state(ctx['first'],'replaced');state(ctx['second'],'ready')
 s=ctx['target_staff_id'];h=hashlib.sha256(ctx['second'].encode()).hexdigest()
 p.parent.joinpath('age.sql').write_text(f"UPDATE erp_private.setup_tokens SET created_at=now()-interval '23 hours 55 minutes',expires_at=now()+interval '5 minutes' WHERE staff_id='{s}' AND token_hash='{h}';")
elif phase=='near_expiry':
 state(ctx['second'],'ready');pw='Qa-7aB-'+secrets.token_hex(16)
 call({'action':'setup','token':ctx['second'],'password':pw});state(ctx['second'],'used')
 r=call({'action':'setup','token':ctx['second'],'password':pw},expect=400);assert 'already been used' in r['error']
 call({'action':'login','login_id':ctx['target_login_id'],'password':pw})
 ctx['third']=issue();save();state(ctx['third'],'ready')
 h=hashlib.sha256(ctx['third'].encode()).hexdigest();s=ctx['target_staff_id']
 p.parent.joinpath('expire.sql').write_text(f"UPDATE erp_private.setup_tokens SET created_at=now()-interval '24 hours 1 second',expires_at=now()-interval '1 second' WHERE staff_id='{s}' AND token_hash='{h}';")
elif phase=='expired':
 state(ctx['third'],'expired');r=call({'action':'setup','token':ctx['third'],'password':ctx['password']},expect=400);assert '24-hour' in r['error']
 state('0'*64,'unavailable')
 print('PASS first setup, regeneration, repeated opening, fresh 24-hour expiry, used replay and expired rejection',flush=True)
