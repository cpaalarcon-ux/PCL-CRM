// Client payroll confirmation report (build 2820). Laid on the firm letterhead from the stored snapshot, so the same version always produces the same bytes.
// pdf-lib is passed in by the caller. Standard fonts cover Windows-1252 only; other characters are replaced rather than failing the report.
import {safe,wrap} from './letter-pdf.mjs';
const m2=v=>(Number(v)||0).toLocaleString('en-KE',{minimumFractionDigits:2,maximumFractionDigits:2});
export const monthLabel=ym=>{const [y,m]=String(ym).split('-').map(Number);return new Intl.DateTimeFormat('en-GB',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(Date.UTC(y,m-1,1)));};
export async function confirmationPdf(r,{PDFDocument,StandardFonts,rgb}){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const when=new Date(r.issued_at);doc.setTitle(safe(`Payroll confirmation ${r.snapshot.client_name} ${r.snapshot.month} v${r.version}`));doc.setAuthor(safe(r.firm.legal_name));doc.setCreator('PCL Nexus');doc.setProducer('PCL Nexus');doc.setCreationDate(when);doc.setModificationDate(when);
 const W=841.89,H=595.28,M=40,green=rgb(0.05,0.25,0.18),grey=rgb(0.35,0.35,0.35),text=W-2*M,s=r.snapshot;
 let page=doc.addPage([W,H]),y=H-M,pageNo=1;
 const footer=()=>page.drawText(safe(`Version ${r.version} · fingerprint ${r.digest.slice(0,16)} · issued ${r.issued_on} from PCL Nexus · Page ${pageNo}`),{x:M,y:20,size:7.5,font,color:grey});
 const header=()=>{page.drawText(safe(r.firm.legal_name).toUpperCase(),{x:M,y:H-M,size:13,font:bold,color:green});
  page.drawText(safe([r.firm.physical_address,r.firm.phone,r.firm.email].filter(Boolean).join(' · ')),{x:M,y:H-M-13,size:8,font,color:grey});
  page.drawLine({start:{x:M,y:H-M-20},end:{x:W-M,y:H-M-20},thickness:1,color:green});y=H-M-40;};
 const need=h=>{if(y-h<M+20){footer();page=doc.addPage([W,H]);pageNo++;header();}};
 const para=(t,size=10,f=font,gap=4)=>{for(const ln of wrap(f,size,t,text)){need(size+3);page.drawText(ln,{x:M,y,size,font:f});y-=size+3;}y-=gap;};
 header();
 para(`Payroll confirmation for ${monthLabel(s.month)}`,15,bold,2);
 para(`${s.client_name}${s.trading_name?' (trading as '+s.trading_name+')':''} · Version ${r.version} · Prepared by ${r.issued_by_name}`,10,font,8);
 para('Please check the people, their pay and the deductions below. Tell us if anyone should be added, removed or paid differently. Once you confirm, the payroll is sent for our review and the statutory returns are prepared from these figures.',10,font,8);
 const cols=[{k:'name',h:'Employee',w:150,t:1},{k:'pin',h:'KRA PIN',w:70,t:1},{k:'gross',h:'Gross pay',w:78},{k:'taxable_benefits',h:'Benefits',w:62},{k:'paye',h:'PAYE',w:66},{k:'employee_nssf',h:'NSSF',w:56},{k:'shif',h:'SHIF',w:56},{k:'employee_ahl',h:'Hsg levy',w:56},{k:'other_deductions',h:'Other ded.',w:60},{k:'net_pay',h:'Net pay',w:78}];
 const row=(vals,f,fill)=>{need(14);if(fill)page.drawRectangle({x:M-2,y:y-4,width:text+4,height:14,color:fill});let x=M;cols.forEach((c,i)=>{const v=safe(vals[i]);const w=f.widthOfTextAtSize(v,8.5);page.drawText(v,{x:c.t?x:x+c.w-6-w,y,size:8.5,font:f});x+=c.w;});y-=14;};
 row(cols.map(c=>c.h),bold,rgb(0.9,0.94,0.92));
 for(const l of s.lines)row(cols.map(c=>c.t?String(l[c.k]||''):m2(l[c.k])),font);
 const t=s.totals;row(['Total ('+t.employees+')','',m2(t.gross),'',m2(t.paye),m2(t.employee_nssf),m2(t.shif),m2(t.employee_ahl),m2(t.other_deductions),m2(t.net)],bold,rgb(0.9,0.94,0.92));
 y-=8;
 para(`Employer costs on this payroll: NSSF ${m2(t.employer_nssf)}, housing levy ${m2(t.employer_ahl)}, NITA ${m2(t.nita)}.`,9,font,8);
 const ch=s.changes,lines=[];
 if(ch.first_month)lines.push('This is the first month on the system; there is no earlier month to compare with.');
 else{for(const x of ch.new_staff)lines.push(`Added: ${x.name} (gross ${m2(x.gross)})`);for(const x of ch.left)lines.push(`Not on this month's payroll: ${x.name}`);for(const x of ch.salary_changes)lines.push(`Pay changed: ${x.name} from ${m2(x.from)} to ${m2(x.to)}`);}
 for(const x of s.inactive)lines.push(`Inactive: ${x.name} from ${x.from}${x.to?' to '+x.to:''}${x.reason?' ('+x.reason+')':''}`);
 para('Changes since last month',11,bold,2);
 if(lines.length)for(const l of lines)para('• '+l,9.5,font,1);else para('No changes.',9.5,font,2);
 need(110);y-=12;
 para('Client response',11,bold,4);
 para('We confirm that the payroll above is correct and may be used to prepare the statutory returns.      We ask for these changes: ______________________________________________',9.5,font,12);
 para('Name: ____________________________    Position: ____________________    Date: ______________    Signature: ____________________',9.5,font,6);
 footer();
 return await doc.save({useObjectStreams:false});
}
