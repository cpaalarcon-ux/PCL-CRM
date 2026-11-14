import JSZip from 'jszip';
import {fail} from './validation.mjs';
import {readWorkbookSheet} from './workbook-reader.mjs';
import {checkWorkbookZip} from './workspace-rules.mjs';
export const sourceLimits={compressed:10*1024*1024,expanded:50*1024*1024,members:100,containers:3,rows:20000,columns:80};
export function parseCSV(bytes){
 let source;try{source=new TextDecoder('utf-8',{fatal:true}).decode(bytes).replace(/^\uFEFF/,'');}catch{fail(400,'Save CSV as UTF-8 and upload it again.');}
 if(source.includes('\0'))fail(400,'This CSV contains binary data.');
 const rows=[];let row=[],field='',quoted=false,closed=false;
 const endField=()=>{row.push(field);field='';closed=false;if(row.length>sourceLimits.columns)fail(400,'A CSV record exceeds 80 columns.');};
 const endRow=()=>{endField();rows.push(row);row=[];if(rows.length>sourceLimits.rows)fail(400,'Split CSV files at 20,000 records.');};
 for(let i=0;i<source.length;i++){
  const ch=source[i];
  if(quoted){if(ch==='"'){if(source[i+1]==='"'){field+='"';i++;}else{quoted=false;closed=true;}}else field+=ch;continue;}
  if(ch==='"'){if(field||closed)fail(400,'Invalid CSV quoting.');quoted=true;}
  else if(ch===',')endField();else if(ch==='\r'||ch==='\n'){if(ch==='\r'&&source[i+1]==='\n')i++;endRow();}
  else{if(closed)fail(400,'Unexpected text after a CSV quoted field.');field+=ch;}
 }
 if(quoted)fail(400,'A quoted CSV value is incomplete.');if(field!==''||row.length||closed)endRow();
 return rows;
}
function directory(bytes,state){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(view.getUint32(i,true)===0x06054b50){end=i;break;}
 if(end<0)fail(400,'Invalid ZIP directory.');const count=view.getUint16(end+10,true);let pos=view.getUint32(end+16,true);
 if(count===65535||count>sourceLimits.members)fail(400,'ZIP has too many members.');
 for(let n=0;n<count;n++){
  if(pos+46>bytes.length||view.getUint32(pos,true)!==0x02014b50)fail(400,'Invalid ZIP member directory.');
  const flags=view.getUint16(pos+8,true),compressed=view.getUint32(pos+20,true),size=view.getUint32(pos+24,true),len=view.getUint16(pos+28,true),extra=view.getUint16(pos+30,true),comment=view.getUint16(pos+32,true),attrs=view.getUint32(pos+38,true);
  if(pos+46+len+extra+comment>bytes.length)fail(400,'Invalid ZIP entry.');
  const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(pos+46,pos+46+len));
  if(flags&1||/^(\/|\\|[A-Za-z]:)|(^|[\/\\])\.\.([\/\\]|$)|[\x00-\x1f]/.test(name)||((attrs>>>16)&0xf000)===0xa000)fail(400,'Encrypted archives, unsafe paths and symbolic links are not allowed.');
  if(/\.(exe|dll|sh|bat|cmd|ps1|js|mjs|html|htm|xlsm|vbs)$/i.test(name))fail(400,'Remove executable files and macros from the ZIP.');
  if(size>sourceLimits.expanded||size>Math.max(compressed,1)*1000)fail(400,'ZIP expansion is unsafe.');
  state.expanded+=size;state.members++;if(state.expanded>sourceLimits.expanded||state.members>sourceLimits.members)fail(400,'Split this ZIP into smaller source packages.');
  pos+=46+len+extra+comment;
 }
}
export async function sourceEntries(bytes,fileName){
 if(bytes.length>sourceLimits.compressed)fail(400,'Source files must be at most 10 MB.');
 const entries=[],state={expanded:0,members:0};
 async function walk(data,name,level){
  const ext=name.split('.').at(-1).toLowerCase();
  if(ext==='zip'){
   if(level>=sourceLimits.containers)fail(400,'The archive exceeds three ZIP-container levels.');directory(data,state);
   let zip;try{zip=await JSZip.loadAsync(data);}catch{fail(400,'Invalid ZIP archive.');}
   for(const [path,e] of Object.entries(zip.files))if(!e.dir){const child=await e.async('uint8array');if(child.length>sourceLimits.expanded)fail(400,'Archive member is too large.');await walk(child,name+' / '+path,level+1);}
  }else if(ext==='csv'){const rows=parseCSV(data);entries.push({name,format:'CSV',rows:rows.length,columns:rows.reduce((n,r)=>Math.max(n,r.length),0),data,headerless:/SEC_[A-Z0-9_]+\.CSV$/i.test(name),section:name.match(/SEC_[A-Z0-9_]+\.CSV$/i)?.[0]||null});}
  else if(ext==='xlsx'){checkWorkbookZip(data);entries.push({name,format:'XLSX',data});}
  else entries.push({name,format:'Unsupported',reason:'Retained in the original archive. Choose a CSV or XLSX source adapter; this member is not imported.'});
 }
 await walk(bytes,fileName,0);if(!entries.some(e=>e.format!=='Unsupported'))fail(400,'No supported CSV or XLSX source was found.');return entries;
}
export async function readSourceSheet(bytes,fileName,selectedName){
 if(/\.xlsx$/i.test(fileName)){checkWorkbookZip(bytes);return readWorkbookSheet(bytes,selectedName);}
 const entries=await sourceEntries(bytes,fileName),supported=entries.filter(e=>e.format!=='Unsupported');
 let entry=selectedName?entries.find(e=>selectedName===e.name||selectedName.startsWith(e.name+' :: ')):supported[0];
 if(!entry||entry.format==='Unsupported')fail(400,'Choose a supported source member.');
 const inventory=entries.map(({data,...e})=>e);
 if(entry.format==='XLSX'){
  const selected=selectedName?.includes(' :: ')?selectedName.split(' :: ').at(-1):null;
  const out=await readWorkbookSheet(entry.data,selected);const name=entry.name+' :: '+out.sheet.name;out.sheet.name=name;
  return {...out,sheets:[...entries.filter(e=>e.name!==entry.name).map(e=>({name:e.name,rows:e.rows||null,columns:e.columns||null,unsupported:e.format==='Unsupported'})),...out.sheets.map(s=>({...s,name:entry.name+' :: '+s.name}))],inventory,adapter:'XLSX archive member'};
 }
 const rows=parseCSV(entry.data),columns=entry.columns;
 const sheet={name:entry.name,rowCount:rows.length,columnCount:columns,getRow:i=>({getCell:c=>({value:rows[i-1]?.[c-1]??null})})};
 return {sheet,sheets:entries.map(e=>({name:e.name,rows:e.rows||null,columns:e.columns||null,unsupported:e.format==='Unsupported'})),inventory,headerless:entry.headerless,section:entry.section,adapter:entry.section?'KRA CSV section · confirm column contract':'CSV · select header or headerless mapping'};
}
