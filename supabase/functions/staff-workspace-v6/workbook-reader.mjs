import JSZip from 'jszip';
import {SaxesParser} from 'saxes';
import {fail} from './validation.mjs';
// Inflate only metadata, shared strings and the selected worksheet. Full-workbook
// formatting/formula graphs can exceed an Edge Function's CPU/memory budget.
function xml(source,handlers){
 const parser=new SaxesParser();parser.on('doctype',()=>fail(400,'XML document types are not supported in workbooks.'));
 for(const [event,fn] of Object.entries(handlers))parser.on(event,fn);
 try{parser.write(source).close();}catch(e){if(e?.status)throw e;fail(400,'Invalid workbook XML. Save a valid XLSX and try again.');}
}
const local=name=>name.split(':').at(-1);
export async function readWorkbookSheet(bytes,selectedName){
 const zip=await JSZip.loadAsync(bytes);
 const read=async path=>{const entry=zip.file(path);if(!entry)fail(400,'A required workbook component is missing.');return entry.async('string');};
 const sheets=[],relations={};let dates1904=false;
 xml(await read('xl/workbook.xml'),{opentag:n=>{if(local(n.name)==='sheet')sheets.push({name:n.attributes.name,id:n.attributes['r:id']});if(local(n.name)==='workbookPr')dates1904=['1','true'].includes(n.attributes.date1904);}});
 if(dates1904)fail(400,'Save this workbook using the standard 1900 date system before importing.');
 if(sheets.length>50)fail(400,'Split workbooks with more than 50 sheets.');
 xml(await read('xl/_rels/workbook.xml.rels'),{opentag:n=>{if(local(n.name)==='Relationship'&&n.attributes.TargetMode!=='External')relations[n.attributes.Id]=n.attributes.Target;}});
 const chosen=selectedName?sheets.find(s=>s.name===selectedName):sheets.find(s=>/^B02A\b/i.test(s.name))||sheets[0];
 if(!chosen)fail(400,'Choose a worksheet.');
 let target=relations[chosen.id];if(!target)fail(400,'The worksheet is unavailable.');
 target=target.startsWith('/')?target.slice(1):'xl/'+target;
 if(!/^xl\/worksheets\/[^/]+\.xml$/.test(target))fail(400,'Unsupported worksheet location.');
 const strings=[];
 if(zip.file('xl/sharedStrings.xml')){
  let active=false,inText=false,phonetic=false,value='';
  xml(await read('xl/sharedStrings.xml'),{opentag:n=>{const tag=local(n.name);if(tag==='si'){active=true;value='';}if(tag==='rPh')phonetic=true;if(tag==='t'&&active&&!phonetic)inText=true;},text:t=>{if(inText)value+=t;},closetag:n=>{const tag=local(n.name);if(tag==='t')inText=false;if(tag==='rPh')phonetic=false;if(tag==='si'){strings.push(value);active=false;}}});
 }
 // A date-formatted number must stay a date, particularly in amount columns.
 // Do not guess dates from a numeric value: 46023 can be a genuine KES amount.
 const formats=new Map(),styles=[];let inCellXfs=false;
 if(zip.file('xl/styles.xml'))xml(await read('xl/styles.xml'),{opentag:n=>{
  const tag=local(n.name);if(tag==='numFmt')formats.set(Number(n.attributes.numFmtId),String(n.attributes.formatCode||''));
  if(tag==='cellXfs')inCellXfs=true;
  if(tag==='xf'&&inCellXfs){const id=Number(n.attributes.numFmtId||0),fmt=(formats.get(id)||'').replace(/"[^"]*"|\\.|\[[^\]]*\]/g,'');styles.push(id>=14&&id<=22||id>=45&&id<=47||/[yd]/i.test(fmt)||/h.*[ms]|m.*s/i.test(fmt));}
 },closetag:n=>{if(local(n.name)==='cellXfs')inCellXfs=false;}});
 const cells=new Map();let rowCount=0,columnCount=0,cell=null,mode='';
 xml(await read(target),{opentag:n=>{
  const tag=local(n.name);
  if(tag==='c'){
   const match=String(n.attributes.r||'').match(/^([A-Z]+)([1-9]\d*)$/);if(!match)fail(400,'A worksheet cell has no valid address.');
   const col=[...match[1]].reduce((v,c)=>v*26+c.charCodeAt(0)-64,0),row=Number(match[2]);
   if(row>20000||col>80)fail(400,'Split the worksheet into at most 80 columns and 20,000 rows.');
   rowCount=Math.max(rowCount,row);columnCount=Math.max(columnCount,col);cell={row,col,type:n.attributes.t,style:Number(n.attributes.s||0),value:'',inline:'',formula:false};
  }else if(cell&&['v','t','f'].includes(tag)){mode=tag;if(tag==='f')cell.formula=true;}
 },text:t=>{if(cell){if(mode==='v')cell.value+=t;if(mode==='t')cell.inline+=t;}},closetag:n=>{
  const tag=local(n.name);if(['v','t','f'].includes(tag))mode='';
  if(tag==='c'&&cell){let value=cell.type==='s'?strings[Number(cell.value)]:cell.type==='inlineStr'?cell.inline:cell.type==='d'?cell.value.slice(0,10):cell.type==='b'?cell.value==='1':cell.type==='str'||cell.type==='e'?cell.value:cell.value===''?'':Number(cell.value);
   if(value===undefined||typeof value==='number'&&!Number.isFinite(value))fail(400,'A worksheet cell contains an invalid value.');
   if(cell.type==='d')value=new Date(cell.value);
   else if(typeof value==='number'&&styles[cell.style])value=new Date(Date.UTC(1899,11,30)+Math.round(value*86400000));
   if(value instanceof Date&&!Number.isFinite(value.getTime()))fail(400,'A worksheet date is invalid.');
   if(cell.formula)value={formula:'cached worksheet formula',result:value};
   cells.set(cell.row+':'+cell.col,value);cell=null;
  }
 }});
 const sheet={name:chosen.name,rowCount,columnCount,getRow:i=>({getCell:c=>({value:cells.get(i+':'+c)??null})})};
 return {sheet,sheets:sheets.map(s=>({name:s.name,rows:s.name===chosen.name?rowCount:null,columns:s.name===chosen.name?columnCount:null}))};
}
