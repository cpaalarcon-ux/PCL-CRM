// Build 2867: the client's Permanent File summary. Laid on the firm letterhead from recorded data only: the live KYC facts, the approved
// "Understanding the Client" version and the AML profile status. pdf-lib is passed in by the caller. The same inputs give the same bytes.
import {safe,wrap} from './letter-pdf.mjs';
import {SECTIONS} from './client-understanding-rules.mjs';
export async function permanentFilePdf(r,{PDFDocument,StandardFonts,rgb}){
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 doc.setTitle(safe(`Permanent File ${r.client.name}`));doc.setAuthor(safe(r.firm.legal_name));doc.setCreator('PCL Nexus');doc.setProducer('PCL Nexus');
 const when=new Date(r.issued_at);doc.setCreationDate(when);doc.setModificationDate(when);
 const W=595.28,H=841.89,M=42,green=rgb(0.05,0.25,0.18),grey=rgb(0.35,0.35,0.35),red=rgb(0.7,0.1,0.1),text=W-2*M;
 let page=doc.addPage([W,H]),y=H-M,pageNo=1;
 const footer=()=>page.drawText(safe(`${r.draft?'DRAFT, not filed · ':''}Fingerprint ${String(r.digest).slice(0,16)} · issued ${r.issued_on} from PCL Nexus · Page ${pageNo}`),{x:M,y:20,size:7.5,font,color:grey});
 const header=()=>{page.drawText(safe(r.firm.legal_name).toUpperCase(),{x:M,y:H-M,size:13,font:bold,color:green});
  page.drawText(safe([r.firm.physical_address,r.firm.phone,r.firm.email].filter(Boolean).join(' · ')),{x:M,y:H-M-13,size:8,font,color:grey});
  page.drawLine({start:{x:M,y:H-M-20},end:{x:W-M,y:H-M-20},thickness:1,color:green});y=H-M-40;};
 const need=h=>{if(y-h<M+16){footer();page=doc.addPage([W,H]);pageNo++;header();}};
 const para=(t,size=9.5,f=font,gap=4,color=undefined,indent=0)=>{for(const ln of wrap(f,size,t,text-indent)){need(size+3);page.drawText(ln,{x:M+indent,y,size,font:f,color});y-=size+3;}y-=gap;};
 const head=t=>{need(34);y-=6;page.drawRectangle({x:M-2,y:y-4,width:text+4,height:16,color:rgb(0.9,0.94,0.92)});page.drawText(safe(t),{x:M+2,y,size:10.5,font:bold,color:green});y-=20;};
 header();
 para('Permanent File',16,bold,2);
 para(`${r.client.name}${r.client.trading_name?' (trading as '+r.client.trading_name+')':''}${r.client.kra_pin?' · KRA PIN '+r.client.kra_pin:''}`,10.5,font,2);
 para(`${r.client.entity_type||'Entity type not recorded'} · issued ${r.issued_on} by ${r.issued_by_name}`,9,font,6,grey);
 if(r.draft)para('DRAFT. This preview was made before an approved "Understanding the Client" existed. It is not filed and must not be relied on.',9.5,bold,6,red);

 head('Part A. Client facts (KYC)');
 if(!r.facts.length)para('No client facts are recorded yet.',9.5,font,4);
 else{
  para(`${r.facts.length} live facts. Verified means a different Supervisor, Manager or Partner checked the fact against its source. Recorded facts are not yet checked.`,8.5,font,4,grey);
  const lw=165,vw=165;
  for(const f of r.facts){
   const v=wrap(font,8.5,f.value,vw),s=wrap(font,7.5,f.source+(f.status==='Verified'?` · Verified${f.verified_by?' by '+f.verified_by:''}${f.verified_on?' on '+f.verified_on:''}`:' · Not yet verified'),text-lw-vw-8),l=wrap(bold,8.5,f.label,lw-6);
   const n=Math.max(v.length,s.length,l.length);need(n*11+4);
   for(let i=0;i<n;i++){if(l[i])page.drawText(l[i],{x:M,y:y-i*11,size:8.5,font:bold});if(v[i])page.drawText(v[i],{x:M+lw,y:y-i*11,size:8.5,font});if(s[i])page.drawText(s[i],{x:M+lw+vw+8,y:y-i*11,size:7.5,font,color:f.status==='Verified'?green:grey});}
   y-=n*11+3;
  }
 }
 head('Part B. Understanding the client');
 if(!r.understanding)para('There is no approved understanding of this client.',9.5,font,4,red);
 else{
  const u=r.understanding;
  para(`Version ${u.version}. Prepared by ${u.prepared_by_name}. Approved by ${u.approved_by_name} on ${u.approved_on}${u.sole_partner_approval?' (sole active Partner; no second approver was available)':''}.`,8.5,font,6,grey);
  for(const s of SECTIONS){const v=u.sections[s.key];if(!v&&!s.required)continue;need(30);para(s.label,10,bold,1);para(v||'Not written.',9.5,font,6,v?undefined:red);}
 }
 head('Part C. Anti-money-laundering status');
 if(!r.aml)para('The AML profile is not visible to the person who issued this, or has not been started. Ask the MLRO for its status.',9.5,font,4);
 else{
  const a=r.aml;
  para(`Stage: ${a.stage||'Not started'}${a.decision?' · Decision: '+a.decision:''}${a.risk_rating?' · Risk rating: '+a.risk_rating:''}`,9.5,font,2);
  para(`${a.decided_on?'Decided on '+a.decided_on+'. ':''}${a.next_review?'Next review due '+a.next_review+'. ':''}${a.edd_required?'Enhanced due diligence is required. ':''}`.trim()||'No decision has been recorded.',9.5,font,4);
  para('This part repeats the status only. The reasoning and any reports stay with the MLRO.',8,font,4,grey);
 }
 footer();
 return await doc.save({useObjectStreams:false});
}
