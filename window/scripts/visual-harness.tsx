// Test fixture only; the shipped entry point imports App.tsx instead.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {WindowShell} from '../src/shell/WindowShell';
import '../src/theme/tokens.css';
import '../src/theme/base.css';
import '../src/shell/shell.css';
import '../src/shell/frame.css';
import '../src/shell/controls.css';
const rows=[['main','Sapling','main'],['scout','Scout','scout'],['ledger','September report','ledger'],['ada','Fix the invoice export','ada']].map(([id,title,agentId],i)=>({key:`agent:${agentId}:${id}`,label:title,agentId,updatedAt:Date.now()-i*60000,createdAt:Date.now()-i*60000,isMain:i===0,pinned:i===1,lastMessagePreview:i===2?'Preparing the September report':'',hasActiveRun:false,kind:'direct'}));
const agents={defaultId:'main',agents:[{id:'main',identity:{name:'Sapling'}},{id:'scout',identity:{name:'Scout',avatar:'ember'}},{id:'ledger',identity:{name:'Ledger',avatar:'tock'}},{id:'ada',identity:{name:'Ada',avatar:'kite'}}]};
let snap={status:{phase:'connected',hello:{server:{version:'0.19.4'}}},sessionKey:rows[0].key,mainKey:rows[0].key,name:'Sapling',history:[],live:[],pendingUser:null,liveRunId:null,doneAt:null,error:null};
const listeners=new Set<()=>void>();
const events=new Set<Function>();
let cachedEngine: any; let cachedKey: string;
const fixture={
  subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>snap,
  onGatewayEvent:(fn:Function)=>{events.add(fn);return()=>events.delete(fn)},
  request:async(method:string,params:any)=>{
    if(method==='sessions.subscribe')return {list:{sessions:rows}};
    if(method==='sessions.list' && params?.spawnedBy)return {sessions:[]};
    if(method==='contacts.list')return {contacts:[
      {id:'trunk:ada',kind:'trunk',name:'Ada',threadKey:'agent:ada:main',isDefault:false,lastActivityAt:Date.now(),preview:{kind:'message',text:'Ready when you are',at:Date.now()},working:false,needsYou:false,threadUnread:false,unreadTopics:0},
      {id:'room:r1',kind:'group',name:'Design group',threadKey:'agent:ada:room:r1',roomId:'r1',isDefault:false,lastActivityAt:Date.now(),face:{members:['ada','scout']},preview:{kind:'message',text:'Scout is on it',at:Date.now()},working:false,needsYou:false,threadUnread:false,unreadTopics:0},
    ]};
    if(method==='rooms.list')return {rooms:[{roomId:'r1',name:'Design group',lead:'ada',rule:'lead',createdAt:Date.now(),members:[{kind:'trunk',id:'ada'},{kind:'trunk',id:'scout'}]}]};
    if(method==='portal.list')return {portals:[{id:'p1',title:'Ledger app',port:3000,url:'http://localhost:3000',createdAtMs:Date.now()}]};
    if(method==='a2a.peers.list')return {peers:[]};
    if(method==='agents.list')return agents;
    if(method==='sessions.list')return {sessions:rows,defaults:{modelProvider:'local',model:'fixture',thinkingLevel:'medium'}};
    if(method==='sessions.describe')return {session:{key:params.key,modelProvider:'local',model:'fixture',permissionMode:'full'}};
    if(method==='models.list')return {models:[{id:'fixture',provider:'local',name:'Local model',contextWindow:32768}]};
    if(method==='system.info')return {machineName:'This computer'};
    if(method==='exec.approval.list')return [];
    if(method==='config.get')return {config:{wizard:{lastRunAt:'2026-10-01T00:00:00Z'}},hash:'fixture'}; // setup already done, so it doesn't open over every shot
    return {};
  },
  open:async(key:string)=>{snap={...snap,sessionKey:key};listeners.forEach(fn=>fn())},
  reload:async()=>{},send:async()=>{},stopRun:async()=>{},answer:async()=>{},
  get engine(){if(cachedKey === snap.sessionKey && cachedEngine) return cachedEngine; cachedKey = snap.sessionKey; return cachedEngine = {sessionKey:snap.sessionKey,agentId:snap.sessionKey.split(':')[1],scopes:['operator.admin'],attachmentPolicy:{maxBytes:10000000},request:fixture.request,onEvent:(fn:Function)=>{events.add(fn);return()=>events.delete(fn)}}}
};
(window as any).fixture=fixture;
createRoot(document.getElementById('root')!).render(<WindowShell session={fixture as any} url="ws://isolated-fixture"/>);
