const assert=require('node:assert/strict');
const http=require('node:http');
const {readFile}=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');

const root=path.resolve(__dirname,'..');
const fixture=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/staff-pilot.css"><div id="messenger"></div>
<dialog id="erp"><input id="erpInput"><button type="button" data-messenger-open>Messenger</button><button id="share" data-messenger-share-task="task">Share task</button></dialog>
<script type="module">
 import {createMessenger} from '/staff-messenger.mjs';
 import {postMessengerFile} from '/staff-messenger-upload.mjs';
 const group={channel_id:'group',kind:'Group',title:'Tax team',unread:2};
 const data={me:{staff_id:'me',category_code:'ASSISTANT'},tasks:[{task_id:'task',task_name:'Prepare VAT Return'}],documents:[]};
 const message=sequence=>({sequence,message_id:'message-'+sequence,author_id:'colleague',body:'Message '+sequence,created_at:'2026-11-19T10:00:00Z'});
 window.messages=Array.from({length:100},(_,i)=>message(i+1));
 const callbacks=[];
 window.setInterval=callback=>callbacks.push(callback);
 const request=async payload=>{
  if(payload.action==='discussion_list')return {channels:[group]};
  if(payload.action==='discussion_group_overview')return {groups:[]};
  if(payload.action==='discussion_messages'){
   const rows=messages.filter(m=>!payload.before_sequence||m.sequence<payload.before_sequence);
   return {channel:group,messages:rows.slice(-60),has_older:rows.length>60};
  }
  if(payload.action==='discussion_shared_link')throw Object.assign(Error('Forbidden'),{status:403});
  if(payload.action==='discussion_send')window.sent=payload;
  return {};
 };
 const uploadMessenger=(attachment,id,options)=>{
  const form=new FormData();form.append('file',attachment.file);form.append('attachment_id',attachment.id);
  window.uploadIds.push(attachment.id);
  return postMessengerFile('/upload',{},form,options);
 };
 window.uploadIds=[];
 const messenger=createMessenger({data:()=>data,esc:value=>String(value??'').replace(/</g,'&lt;'),request,notice(){},uploadMessenger,openTask(){throw Error('Forbidden task opened');}});
 messenger.start();
 window.refresh=()=>callbacks[0]();
 window.addMessage=sequence=>{messages.push({...message(sequence),shared_kind:'task',shared_title:null});refresh();};
 document.querySelector('#erp').showModal();
</script>`;
const server=http.createServer(async(req,res)=>{
 const route=new URL(req.url,'http://localhost').pathname;
 if(route==='/'){res.writeHead(200,{'Content-Type':'text/html'}).end(fixture);return;}
 if(!/^\/(?:staff-[a-z-]+\.(?:mjs|css)|vendor\/supabase-discussion\.mjs)$/.test(route)){res.writeHead(404).end();return;}
 try{res.writeHead(200,{'Content-Type':route.endsWith('.css')?'text/css':'application/javascript'}).end(await readFile(path.join(root,route)));}
 catch{res.writeHead(404).end();}
});

async function main(){
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 let browser;
 try{
  browser=await chromium.launch({headless:true,...(process.env.PCL_BROWSER_EXECUTABLE?{executablePath:process.env.PCL_BROWSER_EXECUTABLE}:{})});
  const page=await browser.newPage({viewport:{width:1280,height:820}});
  let attempts=0;
  await page.route('**/upload',route=>{
   attempts++;
   return attempts===1?route.abort('internetdisconnected'):route.fulfill({json:{attachment_id:'uploaded'}});
  });
  await page.goto('http://127.0.0.1:'+server.address().port);
  await page.locator('#erpInput').fill('Unsaved ERP form');
  await page.locator('#erp').getByRole('button',{name:'Messenger',exact:true}).click();
  await page.getByRole('button',{name:'Return to ERP'}).click();
  assert.equal(await page.locator('#erpInput').inputValue(),'Unsaved ERP form');
  await page.getByRole('button',{name:'Share task',exact:true}).click();
  await page.getByRole('button',{name:/Tax team/}).click();
  assert.equal(await page.locator('.messenger-list').isVisible(),true);
  assert.equal(await page.locator('.messenger-detail').isVisible(),true);
  await page.getByRole('button',{name:'Load earlier messages'}).click();
  await page.waitForFunction(()=>document.querySelectorAll('[data-message-id]').length===100);
  const position=await page.evaluate(()=>{
   const box=document.querySelector('#messengerMessages');
   document.querySelector('[data-message-id="message-50"]').scrollIntoView({block:'start'});
   return box.scrollTop;
  });
  await page.waitForTimeout(120);
  await page.evaluate(()=>addMessage(101));
  await page.getByRole('button',{name:'↓ New messages'}).waitFor();
  assert.ok(Math.abs(await page.locator('#messengerMessages').evaluate(el=>el.scrollTop)-position)<3);
  await page.getByRole('button',{name:'↓ New messages'}).click();
  assert.equal(await page.locator('#messengerNewMessages').isVisible(),false);
  await page.getByRole('textbox',{name:'Message or caption'}).fill('For your review');
  await page.locator('#messengerFiles').setInputFiles({name:'Return.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF- fixture')});
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:'Message or caption'}).inputValue(),'For your review');
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  assert.equal(attempts,2);
  assert.equal(await page.evaluate(()=>uploadIds[0]===uploadIds[1]&&sent.attachment_ids.length===1&&sent.shared_task_id==='task'),true);
  await page.getByRole('button',{name:/Shared task/}).click();
  await page.getByText('403 Forbidden').waitFor();
  await page.getByRole('button',{name:'Return to ERP'}).click();
  assert.equal(await page.locator('#erp').isVisible(),true);
  assert.equal(await page.locator('#erpInput').inputValue(),'Unsaved ERP form');
  await page.setViewportSize({width:390,height:780});
  await page.getByRole('button',{name:'Share task',exact:true}).click();
  assert.equal(await page.locator('.messenger-list').isVisible(),true);
  assert.equal(await page.locator('.messenger-detail').isVisible(),false);
  await page.getByRole('button',{name:/Tax team/}).click();
  assert.equal(await page.locator('.messenger-list').isVisible(),false);
  assert.equal(await page.locator('.messenger-detail').isVisible(),true);
  await page.getByRole('button',{name:'Back to chats'}).click();
  assert.equal(await page.locator('.messenger-list').isVisible(),true);
  console.log('Messenger workspace browser test passed');
 }finally{await browser?.close();server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
