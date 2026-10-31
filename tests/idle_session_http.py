"""Connected staging regression. Use temporary fictional staff, never real users.

Run active phase, age ONLY the saved session's last_seen_at by one day using
the privileged staging SQL runner, then run persisted phase. Revoke/disable QA
staff afterwards. Credentials remain in the private fixture directory.
"""
import argparse,json,pathlib,urllib.request,urllib.error

parser=argparse.ArgumentParser()
parser.add_argument('fixture',type=pathlib.Path)
parser.add_argument('--phase',choices=['active','persisted'],required=True)
args=parser.parse_args()
ctx=json.loads(args.fixture.read_text())
state_path=args.fixture.with_suffix('.idle-session.json')
url='https://yfjiculexbzpkvtapudk.supabase.co/functions/v1/staff-workspace-v7'
origin='https://backend-staging-foundation.pcl-crm.pages.dev'

def call(body,token=None,age=None,expect=200):
    headers={'Content-Type':'application/json','Origin':origin}
    if token:headers['Authorization']='Bearer '+token
    if age is not None:headers['x-erp-activity-age-ms']=str(age)
    req=urllib.request.Request(url,data=json.dumps(body).encode(),headers=headers)
    try:
        with urllib.request.urlopen(req,timeout=90) as r:status=r.status;out=json.load(r)
    except urllib.error.HTTPError as e:status=e.code;out=json.load(e)
    assert status==expect,(body['action'],status,out.get('error','Unexpected response'))
    print('PASS',body['action'],status,flush=True)
    return out

def login():
    return call({'action':'login','login_id':ctx['login_id'],'password':ctx['password']})

if args.phase=='active':
    req=urllib.request.Request(url,method='OPTIONS',headers={'Origin':origin,'Access-Control-Request-Headers':'authorization,x-erp-activity-age-ms'})
    with urllib.request.urlopen(req,timeout=90) as r:
        assert r.status==204 and 'x-erp-activity-age-ms' in r.headers['Access-Control-Allow-Headers']
    print('PASS browser activity CORS preflight',flush=True)
    session=login()
    assert session['idle_timeout_seconds'] is None and session['logout_policy']=='manual' and session['refresh_token']
    call({'action':'workspace'},session['access_token'],0)
    call({'action':'session_activity'},session['access_token'],1000)
    call({'action':'workspace'},session['access_token'],1800000)
    call({'action':'workspace'},session['access_token'],-1,400)
    refreshed=call({'action':'refresh_session','refresh_token':session['refresh_token']},age=1000)
    assert refreshed['session_id']==session['session_id'] and refreshed['refresh_token']
    call({'action':'workspace'},refreshed['access_token'])
    state_path.write_text(json.dumps(refreshed));state_path.chmod(0o600)
    print('PASS active renewal; private session ready for isolated idle ageing',flush=True)
else:
    session=json.loads(state_path.read_text())
    call({'action':'workspace'},session['access_token'],86400000)
    call({'action':'refresh_session','refresh_token':session['refresh_token']},age=86400000)
    print('PASS idle session still accesses records and renews after a day without activity',flush=True)
    fresh=login()
    call({'action':'logout'},fresh['access_token'])
    call({'action':'workspace'},fresh['access_token'],0,401)
    call({'action':'refresh_session','refresh_token':fresh['refresh_token']},age=0,expect=401)
    state_path.unlink()
    print('PASS explicit logout invalidates access and refresh',flush=True)
