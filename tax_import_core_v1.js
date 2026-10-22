/* Pure import/review rules. Staging is not accounting posting or live KRA validation. */
(function(root,factory){
  const categories = typeof module==='object' && module.exports ? require('./tax_purchase_categories_v1.js') : root.PCLTaxCategories;
  const api=factory(categories);
  if(typeof module==='object' && module.exports) module.exports=api; else root.PCLTaxImport=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(categories){
  'use strict';
  const clean=v=>String(v??'').trim(), key=v=>clean(v).toLowerCase().replace(/[^a-z0-9]/g,''), pin=v=>clean(v).toUpperCase();
  const validPin=v=>/^[A-Z]\d{9}[A-Z]$/.test(pin(v));
  const aliases={date:['invoicedate','date','transactiondate','trandate'],invoice:['invoicenumber','invoiceno','cunumber','cuinvoicenumber','etimsinvoicenumber','invoicereference'],party:['suppliername','supplier','buyername','customername','customer'],partyPin:['supplierpin','buyerpin','customerpin'],entityPin:['taxpayerpin','clientpin','entitypin'],net:['taxablevalue','taxableamount','netamount','netamountkes','invoicevalue'],vat:['vat','vatamount','vatasprovided','vatassuppliedkes','taxamount'],taxType:['taxtype','vattype','taxcode','vatrate'],description:['description','narration','originalnarration','itemdescription'],lineId:['lineid','linenumber','itemid'],reference:['bankreference','reference','transactionid','referencenumber','refnum'],debit:['debit','withdrawal','payments'],credit:['credit','deposit','receipts'],account:['bankaccount','accountnumber','account'],documentType:['documenttype','type']};
  function money(v){
    if(v===null||v===undefined||clean(v)==='')return null;
    let s=clean(v).replace(/,/g,'');if(/^\(.*\)$/.test(s))s='-'+s.slice(1,-1);
    if(!/^-?\d+(\.\d{1,6})?$/.test(s))return null;
    const n=Number(s);return Number.isFinite(n)&&Math.abs(n)<1e12?Math.round((n+Math.sign(n)*Number.EPSILON)*100):null;
  }
  function date(v){
    if(v===null||v===undefined||clean(v)==='')return '';
    if(typeof v==='number'&&v>0&&v<100000)return new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000).toISOString().slice(0,10);
    let s=clean(v),m=s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(m)s=`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return '';
    const d=new Date(s+'T00:00:00Z');return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s?s:'';
  }
  function addDays(d,n){return new Date(new Date(d+'T00:00:00Z').getTime()+n*86400000).toISOString().slice(0,10);}
  function monday(d){const n=new Date(d+'T00:00:00Z').getUTCDay();return addDays(d,-((n+6)%7));}
  function weeks(project){const result=[];for(let d=monday(project.periodStart);d<=project.periodEnd;d=addDays(d,7))result.push(d);return result;}
  function suggest(headers){return Object.fromEntries(Object.entries(aliases).map(([field,names])=>[field,headers.findIndex(h=>names.includes(key(h)))]));}
  function mappingErrors(mapping,source){
    const required=source==='BANK'?['date','reference','debit','credit']:['date','invoice','partyPin','net'];
    const errors=required.filter(f=>!(Number(mapping[f])>=0)).map(f=>`Map the ${f} column.`);
    const used=Object.values(mapping).filter(i=>Number(i)>=0).map(Number);
    if(new Set(used).size!==used.length)errors.push('A source column cannot map to two fields.');
    return errors;
  }
  function canonical(values,mapping,source){
    const get=f=>Number(mapping[f])>=0?values[Number(mapping[f])]:null;
    return {source,date:date(get('date')),invoice:clean(get('invoice')),party:clean(get('party')),partyPin:pin(get('partyPin')),entityPin:pin(get('entityPin')),net:money(get('net')),vat:money(get('vat')),taxType:clean(get('taxType')),description:clean(get('description')),lineId:clean(get('lineId')),reference:clean(get('reference')),debit:money(get('debit')),credit:money(get('credit')),account:clean(get('account')),documentType:clean(get('documentType'))};
  }
  function issues(row,project,week){
    const result=[];const issue=(code,message)=>result.push({code,message});
    if(!row.date)issue('DATE','Missing or invalid date.');
    else if(row.date<project.periodStart||row.date>project.periodEnd||row.date<week||row.date>addDays(week,6))issue('PERIOD','Invoice/transaction date is outside this open week and reporting period. Escalate timing; do not change the source date.');
    if(row.entityPin&&row.entityPin!==pin(project.taxpayerPin))issue('ENTITY','Taxpayer PIN differs from the selected project.');
    if(row.source==='BANK'){
      if(!row.reference)issue('REFERENCE','Missing bank reference.');
      if(row.debit===null&&row.credit===null)issue('AMOUNT','Missing bank amount.');
      if((row.debit||0)<0||(row.credit||0)<0||((row.debit||0)>0)===( (row.credit||0)>0))issue('DIRECTION','Bank row must have one positive debit or credit.');
      return result;
    }
    if(!row.invoice)issue('INVOICE','Missing invoice / CU number.');
    if((row.source!=='SALES'||row.partyPin)&&!validPin(row.partyPin))issue('PIN','Missing or invalid supplier/buyer PIN.');
    if(row.net===null)issue('NET','Missing or invalid taxable/net amount.');
    if(row.net!==null&&row.net<0&&!/credit/i.test(row.documentType))issue('CREDIT_NOTE','Negative amount needs an identified credit note and reviewer check.');
    if(row.source==='BOOKS')return result;
    if(row.vat===null)issue('VAT','VAT amount not supplied. Do not replace a missing amount with zero.');
    const type=key(row.taxType);let rate=null;
    if(['16','16percent','standard','standard16','generalrate','general16'].includes(type))rate=0.16;
    else if(['0','0percent','zero','zerorated','exempt','nonvatable'].includes(type))rate=0;
    else issue('TAX_TYPE','Tax type/rate needs verification against the source invoice, including historical Other Rate entries.');
    if(rate!==null&&row.net!==null&&row.vat!==null&&Math.abs(Math.round(row.net*rate)-row.vat)>100)issue('TAX_MISMATCH','VAT amount differs from the stated tax type/rate by more than KES 1.');
    return result;
  }
  const invoiceKey=r=>[r.source==='SALES'?'SALES':'PURCHASE',pin(r.partyPin),clean(r.invoice).toUpperCase().replace(/^\|/,'')].join('|');
  function identity(r,entity){return JSON.stringify(r.source==='BANK'?[pin(entity),'BANK',r.account,r.reference,r.date,r.debit,r.credit]:[pin(entity),r.source,invoiceKey(r),r.lineId||'',r.lineId?'':r.date,r.lineId?'':r.net,r.lineId?'':r.vat,r.lineId?'':r.description,r.lineId?'':r.taxType]);}
  function prepare(input,existing,project,week){
    const accepted=[],duplicates=[],seen=new Map(existing.filter(r=>r.entityPin===pin(project.taxpayerPin)).map(r=>[r.identity,r]));
    for(const item of input){
      const id=identity(item.sourceData,project.taxpayerPin), prior=seen.get(id);
      if(prior&&JSON.stringify(prior.sourceData)===JSON.stringify(item.sourceData)){duplicates.push(item);continue;}
      const row={...item,identity:id,entityPin:pin(project.taxpayerPin),projectId:project.id,clientId:project.clientId,firmId:project.firmId,week,issues:issues(item.sourceData,project,week),allocations:[],review:{status:'Pending'}};
      if(prior)row.issues.push({code:'CONFLICT',message:'Same invoice line or bank reference has changed source values. Review as a correction, not an additional claim.'});
      if(!item.sourceData.lineId&&item.sourceData.source!=='BANK'&&[...seen.values()].some(r=>r.sourceData.source===item.sourceData.source&&invoiceKey(r.sourceData)===invoiceKey(item.sourceData)))row.issues.push({code:'MULTILINE',message:'Repeated invoice without a line ID: verify distinct lines versus corrected or duplicate amounts.'});
      accepted.push(row);seen.set(id,row);
    }
    return {rowsRead:input.length,rows:accepted,duplicates};
  }
  function mappingIssues(row,allocations=row.allocations||[]){
    if(!['PURCHASES','BOOKS'].includes(row.sourceData.source))return [];
    const errors=[];
    if(!allocations.length)return ['Choose resale goods, expenditure or PPE and a category.'];
    let total=0;
    for(const a of allocations){
      const c=categories.find(c=>c.code===a.categoryCode);
      if(!c||c.route!==Number(a.route)||c.kind!=='Purchase')errors.push('Choose a purchase category matching the route. Payroll and adjustments use separate schedules.');
      if(!clean(a.description))errors.push('Enter the actual item or expenditure narration.');
      if(!Number.isSafeInteger(a.amount)||a.amount===0||Math.sign(a.amount)!==Math.sign(row.sourceData.net))errors.push('Each allocation needs a non-zero amount with the same sign as the invoice.');
      else total+=a.amount;
      if(Number(a.route)===3&&(!clean(a.assetDescription)||!clean(a.assetLocation)||!date(a.firstUseDate)))errors.push('For PPE enter asset description, location and first-use date.');
    }
    if(total!==row.sourceData.net)errors.push('Allocation total must equal the original net amount.');
    return [...new Set(errors)];
  }
  function isExcluded(row){return row.review?.status==='Excluded';}
  function unresolved(row){return isExcluded(row)?[]:(row.issues||[]).filter(i=>!row.resolutions?.[i.code]);}
  function gross(row){const s=row.sourceData;return s.net===null||s.vat===null?null:s.net+s.vat;}
  function bankIssues(row,rows,links=row.bankLinks||[],explanation=row.bankExplanation||''){
    if(row.sourceData.source!=='BANK')return [];
    const errors=[],source=row.sourceData,targetKind=(source.credit||0)>0?'SALES':'PURCHASES',amount=source.credit||source.debit||0;
    let total=0;
    for(const link of links){
      const target=rows.find(r=>r.id===link.rowId);
      if(!target||target.projectId!==row.projectId||target.sourceData.source!==targetKind||isExcluded(target)||gross(target)===null){errors.push('Bank allocation must reference an invoice in this project with known gross amount.');continue;}
      if(!Number.isSafeInteger(link.amount)||link.amount<=0){errors.push('Bank allocation amount must be positive.');continue;}
      const used=rows.filter(r=>r.id!==row.id&&!isExcluded(r)).flatMap(r=>r.bankLinks||[]).filter(l=>l.rowId===target.id).reduce((n,l)=>n+l.amount,0);
      const own=links.filter(l=>l.rowId===target.id).reduce((n,l)=>n+l.amount,0);
      if(used+own>gross(target))errors.push('Bank allocations exceed the invoice gross amount.');
      total+=link.amount;
    }
    if(total>amount)errors.push('Bank allocations exceed this bank transaction.');
    if(total!==amount&&!clean(explanation))errors.push('Explain the unmatched balance (timing, cash/M-Pesa, transfer or other reason).');
    return [...new Set(errors)];
  }
  function variance(rows,projectId,week){
    const scoped=rows.filter(r=>r.projectId===projectId&&r.week===week&&!isExcluded(r)),books=scoped.filter(r=>r.sourceData.source==='BOOKS'),etims=scoped.filter(r=>r.sourceData.source==='PURCHASES');
    const matches=(r,set)=>set.some(x=>invoiceKey(x.sourceData)===invoiceKey(r.sourceData)&&x.sourceData.net===r.sourceData.net);
    return {booksOnly:books.filter(r=>!matches(r,etims)),etimsOnly:etims.filter(r=>!matches(r,books)),booksProvided:books.length>0};
  }
  function summary(state,project,week){
    const rows=state.rows.filter(r=>r.projectId===project.id&&r.week===week),batches=state.batches.filter(b=>b.projectId===project.id&&b.week===week),kinds=['SALES','PURCHASES','BANK'];
    const sources=Object.fromEntries(kinds.map(source=>{const rs=rows.filter(r=>r.sourceData.source===source);return [source,{rows:rs.length,valid:rs.filter(r=>!isExcluded(r)&&!unresolved(r).length).length,rejected:rs.filter(r=>!isExcluded(r)&&unresolved(r).length).length,excluded:rs.filter(isExcluded).length,present:batches.some(b=>b.source===source),duplicates:batches.filter(b=>b.source===source).reduce((n,b)=>n+b.duplicates,0)}];}));
    const openRows=rows.filter(r=>!isExcluded(r)&&(unresolved(r).length||mappingIssues(r).length||r.review?.status!=='Approved'||bankIssues(r,state.rows).length));
    const v=variance(state.rows,project.id,week),varianceRows=v.booksProvided?[...v.booksOnly,...v.etimsOnly].filter(r=>!r.resolutions?.BOOKS_VARIANCE):[];
    const missing=kinds.filter(s=>!sources[s].present),openIds=new Set([...openRows,...varianceRows].map(r=>r.id));
    const deposits=rows.filter(r=>r.sourceData.source==='BANK'&&!isExcluded(r)).reduce((n,r)=>n+(r.sourceData.credit||0),0);
    const salesRows=rows.filter(r=>r.sourceData.source==='SALES'&&!isExcluded(r)),salesGross=salesRows.some(r=>gross(r)===null)?null:salesRows.reduce((n,r)=>n+gross(r),0);
    return {sources,missing,open:openIds.size,returned:rows.filter(r=>r.review?.status==='Returned').length,resolved:rows.filter(r=>['Approved','Excluded'].includes(r.review?.status)).length,ready:!missing.length&&!openIds.size,variance: v,bankVariance:salesGross===null?null:deposits-salesGross,bankUnmatched:rows.filter(r=>r.sourceData.source==='BANK'&&!isExcluded(r)&&r.review?.status!=='Approved').length};
  }
  function csv(rows){return rows.map(row=>row.map(v=>{let s=String(v??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';}).join(',')).join('\r\n');}
  return {categories,aliases,clean,key,pin,validPin,money,date,addDays,monday,weeks,suggest,mappingErrors,canonical,issues,identity,invoiceKey,prepare,mappingIssues,isExcluded,unresolved,gross,bankIssues,variance,summary,csv};
});
