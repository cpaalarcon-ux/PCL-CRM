// Use the same authenticated Edge Function as the ERP, with upload progress.
export function postMessengerFile(url,headers,form,{onProgress,signal,xhr=new XMLHttpRequest()}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted){reject(new DOMException('Upload cancelled.','AbortError'));return;}
  const abort=()=>xhr.abort();
  const fail=message=>reject(Error(message));
  xhr.open('POST',url);
  xhr.responseType='json';
  xhr.timeout=120000;
  for(const [name,value] of Object.entries(headers))xhr.setRequestHeader(name,value);
  xhr.upload.onprogress=e=>{if(e.lengthComputable)onProgress?.(Math.min(99,Math.round(e.loaded/e.total*100)));};
  xhr.onload=()=>{
   if(xhr.status>=200&&xhr.status<300&&xhr.response?.attachment_id)resolve(xhr.response);
   else reject(Object.assign(Error(xhr.response?.error||'The upload failed. Try again.'),{status:xhr.status}));
  };
  xhr.onerror=()=>fail('Connection lost. Retry when you are back online.');
  xhr.ontimeout=()=>fail('The upload timed out. Try again.');
  xhr.onabort=()=>reject(new DOMException('Upload cancelled.','AbortError'));
  xhr.onloadend=()=>signal?.removeEventListener('abort',abort);
  signal?.addEventListener('abort',abort,{once:true});
  xhr.send(form);
 });
}
