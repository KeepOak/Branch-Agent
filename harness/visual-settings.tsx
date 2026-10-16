// Test fixture only: R1 Settings at a page and a level, for proof screenshots (#1093). ?page=<id>&level=<regular|advanced|technical>&mode=<tools.exec.mode>
import React from 'react';
import {createRoot} from 'react-dom/client';
import {R1Window} from '../src/screens/frame/R1Window';
import '../src/theme/tokens.css';
import '../src/theme/base.css';
import '../src/shell/shell.css';
import '../src/shell/frame.css';
import '../src/shell/controls.css';
const q=new URLSearchParams(window.location.search);
localStorage.clear();
localStorage.setItem('branch.route',JSON.stringify({kind:'settings',page:q.get('page')??'general'}));
localStorage.setItem('branch.level',q.get('level')??'regular');
const rows=[['main','Sapling','main'],['scout','Scout','scout']].map(([id,title,agentId],i)=>({key:`agent:${agentId}:${id}`,label:title,agentId,updatedAt:Date.now()-i*60000,createdAt:Date.now()-i*60000,isMain:i===0,pinned:false,lastMessagePreview:'',hasActiveRun:false,kind:'direct'}));
const agents={defaultId:'main',agents:[{id:'main',identity:{name:'Sapling'}},{id:'scout',identity:{name:'Scout',avatar:'ember'}}]};
let snap:any={status:{phase:'connected',hello:{server:{version:'0.19.4'}}},sessionKey:rows[0].key,mainKey:rows[0].key,name:'Sapling',history:[],live:[],pendingUser:null,liveRunId:null,doneAt:null,error:null};
const listeners=new Set<()=>void>();
const events=new Set<Function>();
const config:any={wizard:{lastRunAt:'2026-10-01T00:00:00Z'},tools:{exec:{mode:q.get('mode')??'ask'}}};
const approvals={path:'.branch/exec-approvals.json',exists:true,hash:'fixture',file:{version:1,defaults:{security:'full',ask:'off'}},resolvedDefaults:{security:'full',ask:'off',askFallback:'deny',autoAllowSkills:false}};
let cachedEngine:any; let cachedKey:string;
const fixture:any={
  subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>snap,
  onGatewayEvent:(fn:Function)=>{events.add(fn);return()=>events.delete(fn)},
  request:async(method:string,params:any)=>{
    if(method==='sessions.subscribe')return {list:{sessions:rows}};
    if(method==='sessions.list' && params?.spawnedBy)return {sessions:[]};
    if(method==='contacts.list')return {contacts:[]};
    if(method==='rooms.list')return {rooms:[]};
    if(method==='agents.list')return agents;
    if(method==='sessions.list')return {sessions:rows,defaults:{modelProvider:'local',model:'fixture',thinkingLevel:'medium'}};
    if(method==='sessions.describe')return {session:{key:params.key,modelProvider:'local',model:'fixture',permissionMode:'full'}};
    if(method==='models.list')return {models:[{id:'fixture',provider:'local',name:'Local model',contextWindow:32768}]};
    if(method==='system.info')return {machineName:'This computer'};
    if(method==='exec.approval.list')return [];
    if(method==='exec.approvals.get')return approvals;
    if(method==='config.get')return {config,hash:'fixture'};
    if(method==='config.patch'){await new Promise(r=>setTimeout(r,150));return {ok:true,config,hash:'fixture'};}
    if(method==='push.web.test')return {results:[{ok:true}]};
    if(method==='users.prefs.get')return {status:'ok',entries:{}};
    return {};
  },
  open:async(key:string)=>{snap={...snap,sessionKey:key};listeners.forEach(fn=>fn())},
  reload:async()=>{},send:async()=>{},stopRun:async()=>{},answer:async()=>{},
  get engine(){if(cachedKey===snap.sessionKey&&cachedEngine)return cachedEngine;cachedKey=snap.sessionKey;return cachedEngine={sessionKey:snap.sessionKey,agentId:snap.sessionKey.split(':')[1],scopes:['operator.admin'],features:{methods:[],events:[]},attachmentPolicy:{maxBytes:10000000},request:fixture.request,onEvent:(fn:Function)=>{events.add(fn);return()=>events.delete(fn)}}}
};
(window as any).fixture=fixture;
createRoot(document.getElementById('root')!).render(<R1Window session={fixture}/>);
