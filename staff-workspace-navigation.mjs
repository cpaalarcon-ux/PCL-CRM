const idPattern=/^[A-Za-z0-9_-]{1,64}$/;
const scopedViews=new Set(['documents','finance']);
const relatedArea={clientfile:'clients',task:'projects'};

export function readWorkspaceScope(view,value){
 if(!scopedViews.has(view)||typeof value!=='string')return null;
 const [kind,id,...rest]=value.split('.');
 return !rest.length&&(kind==='client'||kind==='project')&&idPattern.test(id||'')?{kind,id}:null;
}

export function workspaceScopeHash(view,scope){
 return '#'+new URLSearchParams({view,scope:scope.kind+'.'+scope.id});
}

// The active workspace snapshot supplies the relationships between a task, project and client.
export function workspaceContext(route,data){
 const task=route.view==='task'?data.tasks.find(item=>item.task_id===route.id):null;
 const projectId=route.scope?.kind==='project'?route.scope.id:route.view==='projects'?route.id:task?.project_id;
 const project=data.projects.find(item=>item.project_id===projectId);
 const clientId=project?.client_id||(route.scope?.kind==='client'?route.scope.id:route.view==='clientfile'?route.id:null);
 const client=data.clients.find(item=>item.client_id===clientId);
 if((route.scope?.kind==='project'&&!project)||(route.scope?.kind==='client'&&!client))return null;
 return project||client?{project,client}:null;
}

export function needsWorkspaceConfirmation(from,to,data){
 if(from.view==='home'||to.view==='home')return false;
 const previous=workspaceContext(from,data),next=workspaceContext(to,data);
 if(previous?.project&&previous.project.project_id===next?.project?.project_id)return false;
 if(previous?.client&&previous.client.client_id===next?.client?.client_id)return false;
 if(previous&&next)return true;
 if(Boolean(from.scoped)!==Boolean(to.scoped))return true;
 return (relatedArea[from.view]||from.view)!==(relatedArea[to.view]||to.view);
}

export function workspaceRecordMatches(record,scope,data){
 if(!scope)return true;
 if(scope.kind==='client'&&record.client_id)return record.client_id===scope.id;
 const projectId=record.project_id||(record.task_id&&data.tasks.find(item=>item.task_id===record.task_id)?.project_id);
 if(scope.kind==='project')return projectId===scope.id;
 return data.projects.find(item=>item.project_id===projectId)?.client_id===scope.id;
}
