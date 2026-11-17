import test from 'node:test';import assert from 'node:assert/strict';
const R=await import('../supabase/functions/staff-workspace-v12/p9-rules.mjs');
const U=await import('../staff-p9.mjs');
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
// Fictional figures. The payroll run applied: pension = lower of actual and the monthly cap; mortgage and medical capped; deductions J = E+F+G+H+I.
const LIM={rate_key:'KE_PAYROLL_LIMITS',parameters:{pension_monthly_cap:30000,mortgage_monthly_cap:30000,medical_monthly_cap:15000}};
const emp=(n,pin,x={})=>({name:'Employee '+n,pin,employee_id:'2000000'+n,source_row:n,employment_type:'Permanent',other_pension:0,postretirement_medical:0,mortgage_interest:0,...x});
const calc=(n,x={})=>({source_row:n,gross:100000,taxable_benefits:0,employee_nssf:2160,shif:2750,employee_ahl:1500,allowed_deductions:6410,exemption:0,taxable:93590,gross_tax:21000,personal_relief:2400,insurance_relief:0,paye:18600,...x});
const month=(m,rows,calcs,rules=[LIM])=>({month:m,import_id:'i'+m,employees:rows,calculated:calcs,rules});
const reg={surname:'Fictional',other_names:'Person One'};
const people=[{kra_pin:'A000000001Z',...reg}];
const all12=(rows,calcs)=>Array.from({length:12},(_,i)=>month(`2026-${String(i+1).padStart(2,'0')}`,rows,calcs));
test('a card copies the KRA columns A to O in order, with E in three parts, and the total row and footer',()=>{
 assert.deepEqual(R.P9_COLUMNS.map(c=>c[0]),['A','B','C','D','E1','E2','E3','E','F','G','H','I','J','K','L','M','N','O']);
 const r=R.buildP9({year:2026,months:all12([emp(1,'A000000001Z')],[calc(1)]),people,client:{name:'Fictional Client',pin:'P000000001A'}});
 assert.deepEqual(r.issues,[]);assert.equal(r.employees.length,1);
 const e=r.employees[0],m=e.rows[0];
 assert.equal(m.A,10000000);assert.equal(m.D,10000000);assert.equal(m.E2,216000);assert.equal(m.E3,3000000);assert.equal(m.E,216000);assert.equal(m.E1,null);
 assert.equal(m.J,641000,'E+F+G+H+I');assert.equal(m.K,9359000,'D minus J');assert.equal(m.O,1860000,'L minus M minus N');
 assert.equal(e.totals.K,9359000*12);assert.equal(e.totals.O,1860000*12);
 const csv=R.p9Csv({...e,year:2026},r.client);assert.match(csv,/Total chargeable pay \(Col\. K\),1123080\.00/);assert.match(csv,/Total tax \(Col\. O\),223200\.00/);assert.match(csv,/Employee PIN,A000000001Z/);assert.equal(csv.split('\r\n').filter(l=>/^(January|February|December),/.test(l)).length,3);
 assert.match(R.p9FileName({...e,year:2026},r.client),/^P9_2026_Fictional_Client_Employee_1_A000000001Z\.csv$/);
});
test('the pension deduction is the lower of the actual contribution and the cap, and relief columns are capped',()=>{
 const rich=calc(1,{gross:900000,employee_nssf:2160,allowed_deductions:30000+1500+2750+15000+30000,taxable:900000-79250,shif:2750,employee_ahl:1500,gross_tax:2400,paye:0});
 const e=emp(1,'A000000001Z',{other_pension:40000,postretirement_medical:20000,mortgage_interest:50000});
 const m=R.monthRow({e,c:rich,limits:LIM.parameters});
 assert.equal(m.E2,4216000);assert.equal(m.E3,3000000);assert.equal(m.E,3000000);assert.equal(m.H,1500000);assert.equal(m.I,3000000);assert.deepEqual(m.issues,[]);
});
test('a column that does not agree with the payroll run is named, never smoothed over',()=>{
 const c=calc(1,{allowed_deductions:6000});const m=R.monthRow({e:emp(1,'A000000001Z'),c,limits:LIM.parameters});
 assert.ok(m.issues.some(x=>/total deductions \(J\)/.test(x)));
 assert.ok(R.monthRow({e:emp(1,'A000000001Z'),c:calc(1,{taxable:90000}),limits:LIM.parameters}).issues.some(x=>/chargeable pay \(K\)/.test(x)));
 assert.ok(R.monthRow({e:emp(1,'A000000001Z'),c:calc(1,{exemption:500}),limits:LIM.parameters}).issues.some(x=>/exemption/.test(x)));
 assert.ok(R.monthRow({e:emp(1,'A000000001Z'),c:calc(1,{paye:100}),limits:LIM.parameters}).issues.some(x=>/PAYE \(O\)/.test(x)));
 assert.match(R.monthRow({e:emp(1,'A000000001Z'),c:calc(1),limits:null}).issues[0],/was not stored with this month/);
 const r=R.buildP9({year:2026,months:all12([emp(1,'A000000001Z')],[calc(1,{allowed_deductions:6000})]),people,client:{name:'C',pin:'P000000001A'}});
 assert.ok(r.issues.some(x=>/January 2026: total deductions/.test(x)));
});
test('a month with no confirmed payroll blocks the cards unless the preparer says none ran; a person who was not on a month has a blank row',()=>{
 const some=[month('2026-01',[emp(1,'A000000001Z')],[calc(1)]),month('2026-02',[emp(2,'A000000002Z')],[calc(2)])];
 const r=R.buildP9({year:2026,months:some,people:[],client:{name:'C',pin:'P000000001A'}});
 assert.ok(r.issues.some(x=>/March 2026: there is no confirmed payroll/.test(x)));
 const r2=R.buildP9({year:2026,months:some,people:[{kra_pin:'A000000001Z',...reg},{kra_pin:'A000000002Z',...reg}],client:{name:'C',pin:'P000000001A'},emptyMonths:['2026-03','2026-04','2026-05','2026-06','2026-07','2026-08','2026-09','2026-10','2026-11','2026-12']});
 assert.deepEqual(r2.issues,[]);const one=r2.employees.find(e=>e.pin==='A000000001Z');
 assert.equal(one.rows[0].O>0,true);assert.equal(one.rows[1],null,'not on February payroll: blank, not zero');assert.equal(one.months_on_payroll,1);
 assert.equal(r2.coverage.filter(c=>c.status==='Confirmed as no payroll').length,10);
});
test('missing register names and a person with no PIN are reported; PAYE of people without a PIN is accounted for, not dropped',()=>{
 const rows=[emp(1,'A000000001Z'),emp(2,'',{employment_type:'Casual',name:'Casual Worker'})],calcs=[calc(1),calc(2,{paye:300,gross:30000,taxable:28000,allowed_deductions:2000,gross_tax:2700,personal_relief:2400})];
 const r=R.buildP9({year:2026,months:all12(rows,calcs),people:[{kra_pin:'A000000001Z',surname:'',other_names:''}],client:{name:'C',pin:'P000000001A'}});
 assert.ok(r.issues.some(x=>/surname and other names are missing/.test(x)));assert.ok(r.notes.some(x=>/Casual Worker has no KRA PIN/.test(x)));assert.equal(r.employees.length,1);
 assert.equal(r.issues.some(x=>/the cards carry PAYE/.test(x)),false,'PAYE without a PIN is part of the month total');
 // a line that was dropped would under-declare: the month total no longer matches the cards
 const bad=R.buildP9({year:2026,months:[{...month('2026-01',[emp(1,'A000000001Z')],[calc(1),calc(9)]),employees:[emp(1,'A000000001Z')]}],people,client:{name:'C',pin:'P000000001A'},emptyMonths:Array.from({length:11},(_,i)=>`2026-${String(i+2).padStart(2,'0')}`)});
 assert.ok(bad.issues.some(x=>/January 2026: the cards carry PAYE of 18600\.00 and the confirmed summary 37200\.00/.test(x)));
});
test('the card text and the printable page escape names and carry one page per employee',()=>{
 const r=R.buildP9({year:2026,months:all12([emp(1,'A000000001Z',{name:'=HYPERLINK("x")'})],[calc(1)]),people:[{kra_pin:'A000000001Z',surname:'<b>Bad</b>',other_names:'Name'}],client:{name:'C',pin:'P000000001A'}});
 const csv=R.p9Csv({...r.employees[0],year:2026},r.client);assert.match(csv,/'<b>Bad<\/b>|<b>Bad<\/b>/);
 const x={year:2026,client:r.client,columns:R.P9_COLUMNS.map(([letter,label])=>({letter,label})),employees:r.employees.map(e=>({...e,totals:Object.fromEntries(Object.entries(e.totals).map(([k,v])=>[k,v/100])),rows:e.rows.map(row=>row&&Object.fromEntries(Object.entries(row).map(([k,v])=>[k,v===null?null:v/100])))}))};
 const html=U.p9PrintHtml(x,esc);assert.doesNotMatch(html,/<b>Bad<\/b>/);assert.match(html,/&lt;b&gt;Bad/);assert.equal((html.match(/class="p9page"/g)||[]).length,1);assert.match(html,/Total tax \(Col\. O\)/);
});
test('the ZIP writer produces a valid archive of stored entries with correct checksums',async()=>{
 const files=[{name:'a.csv',text:'hello,world\r\n'},{name:'b é.csv',text:'x'.repeat(5000)}];
 const z=U.zipStore(files),dv=new DataView(z.buffer);
 assert.equal(dv.getUint32(0,true),0x04034b50);const end=z.length-22;assert.equal(dv.getUint32(end,true),0x06054b50);assert.equal(dv.getUint16(end+10,true),2);
 let off=dv.getUint32(end+16,true),found=[];
 for(let i=0;i<2;i++){assert.equal(dv.getUint32(off,true),0x02014b50);const crc=dv.getUint32(off+16,true),size=dv.getUint32(off+24,true),nl=dv.getUint16(off+28,true),lo=dv.getUint32(off+42,true);
  const name=new TextDecoder().decode(z.slice(off+46,off+46+nl)),ln=dv.getUint16(lo+26,true),data=z.slice(lo+30+ln,lo+30+ln+size);
  assert.equal(U.crc32(data),crc);found.push([name,new TextDecoder().decode(data)]);off+=46+nl;}
 assert.deepEqual(found.map(x=>x[0]),['a.csv','b é.csv']);assert.equal(found[0][1],'hello,world\r\n');assert.equal(found[1][1].length,5000);
 assert.equal(U.crc32(new TextEncoder().encode('123456789')),0xCBF43926);
 // it also unpacks with a real unzip tool when one is installed
 const {execFileSync}=await import('node:child_process'),fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p9zip-')),f=path.join(dir,'t.zip');fs.writeFileSync(f,z);
 try{const out=execFileSync('python3',['-c','import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print(z.testzip());print(sorted(z.namelist()))',f]).toString();assert.match(out,/^None/);}catch(e){if(e.code!=='ENOENT')throw e;}
});
test('the panels show the intro, the months and the release only when ready',()=>{
 const p=U.p9Panel({years:[{year:2026,confirmed_months:12}],released:[]},esc);assert.match(p,/Prepare 2026 cards/);assert.match(p,/columns A to O/);
 const base={year:2026,client:{name:'C'},issues:[],notes:['n'],coverage:[{month:'2026-01',status:'Confirmed payroll'}],employees:[{name:'E',pin:'A000000001Z',months_on_payroll:12,totals:{K:1,O:2}}],columns:[],ready:true};
 assert.match(U.p9Result(base,esc),/Release and download \(ZIP\)/);
 const blocked=U.p9Result({...base,ready:false,issues:['March 2026: no confirmed payroll'],coverage:[{month:'2026-03',status:'No confirmed payroll'}]},esc);
 assert.doesNotMatch(blocked,/Release and download/);assert.match(blocked,/Not ready to release/);assert.match(blocked,/class="p9Empty" value="2026-03"/);
});
