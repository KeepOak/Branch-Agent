// Test fixture only; the shipped entry point imports App.tsx instead.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {WindowShell} from '../src/shell/WindowShell';
import '../src/theme/tokens.css';
import '../src/theme/base.css';
import '../src/shell/shell.css';
import '../src/shell/frame.css';
import '../src/shell/controls.css';
const rows=[['main','Sapling','main'],['scout','Scout','scout'],['ledger','September report','ledger'],['ada','Fix the invoice export','ada']].map(([id,title,agentId],i)=>({key:`agent:${agentId}:${id}`,label:title,agentId,updatedAt:Date.now()-i*60000,createdAt:Date.now()-i*60000,isMain:i===0,totalTokens:i===0?36000:0,contextTokens:i===0?256000:0,hasActiveRun:i===2,pinned:i===1,lastMessagePreview:i===2?'Preparing the September report':'',kind:'direct'}));
const agents={defaultId:'main',agents:[{id:'main',identity:{name:'Sapling'}},{id:'scout',identity:{name:'Scout',avatar:'ember'}},{id:'ledger',identity:{name:'Ledger',avatar:'tock'}},{id:'ada',identity:{name:'Ada',avatar:'kite'}}]};
let snap={status:{phase:'connected',hello:{server:{version:'0.19.4'},snapshot:{uptimeMs:3*86400000}}},sessionKey:rows[0].key,mainKey:rows[0].key,name:'Sapling',history:[],live:[],pendingUser:null,liveRunId:null,doneAt:null,error:null};
const listeners=new Set<()=>void>();
const events=new Set<Function>();
let cachedEngine: any; let cachedKey: string;
const fixture={
  subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn)},getSnapshot:()=>snap,
  onGatewayEvent:(fn:Function)=>{events.add(fn);return()=>events.delete(fn)},
  request:async(method:string,params:any)=>{
    if(method==='sessions.subscribe')return {list:{sessions:rows}};
    if(method==='sessions.list' && params?.spawnedBy)return {sessions:[]};
    if(method==='agents.list')return agents;
    if(method==='sessions.list')return {sessions:rows,defaults:{modelProvider:'local',model:'fixture',thinkingLevel:'medium'}};
    if(method==='sessions.describe')return {session:{key:params.key,modelProvider:'local',model:'fixture',permissionMode:'full'}};
    if(method==='models.list')return {models:[{id:'fixture',provider:'local',name:'Local model',contextWindow:32768}]};
    if(method==='exec.approval.list')return [];
    if(method==='config.get')return {config:new URLSearchParams(location.search).has('setup')?{}:{wizard:{lastRunAt:'2026-10-01T00:00:00Z'}},hash:'fixture'};
    if(method==='branch.setup.detect')return {candidates:[{kind:'codex-cli',label:'Your ChatGPT account',detail:'Signed in in your browser · Plus',modelRef:'openai/gpt',recommended:true},{kind:'existing-model',label:'Qwen3.6 35B, on this computer',detail:'Ollama',modelRef:'ollama/qwen',recommended:false}],authOptions:[{id:'anthropic-oauth',label:'Claude account',kind:'oauth',featured:true}],manualProviders:[],workspace:'/w',setupComplete:false};
    if(method==='branch.setup.verify')return {ok:true,modelRef:'ollama/qwen',latencyMs:1200};
    if(method==='channels.status')return {channelOrder:['telegram','discord','slack'],channelLabels:{telegram:'Telegram',discord:'Discord',slack:'Slack'},channelAccounts:{telegram:[{connected:true}]},channels:{},channelDefaultAccountId:{},ts:1};
    if(method==='system.info')return {machineName:'This computer',diskAvailableBytes:212*1024**3};
    if(method==='projects.list')return {projects:[{id:'p1',displayName:'Home',source:'registered'}]};
    if(method==='health')return {ok:true,ts:Date.now(),durationMs:4};
    if(method==='usage.status')return {updatedAt:Date.now()-240000,providers:[{provider:'openai-codex',displayName:'ChatGPT plan',plan:'Plus',windows:[{label:'5h',usedPercent:88,resetAt:Date.now()+5*3600000},{label:'Week',usedPercent:36,resetAt:Date.now()+3*86400000}]},{provider:'google',displayName:'Google Gemini',windows:[]}]};
    if(method==='usage.cost')return {totals:{totalCost:14.2}};
    if(method==='sessions.usage')return {sessions:[{contextWeight:{systemPrompt:{chars:40000},skills:{promptChars:8000,entries:[]},tools:{listChars:4000,schemaChars:16000,entries:[]},injectedWorkspaceFiles:[{name:'AGENTS.md',injectedChars:8000}]}}]};
    if(method==='sessions.usage.timeseries')return {points:[{totalTokens:19000,input:7000,cacheRead:12000},{totalTokens:21000,input:5000,cacheRead:15000},{totalTokens:9000,input:9000,cacheRead:0}]};
    if(method==='cron.list')return {jobs:[{name:'Nightly check',enabled:true,state:{nextRunAtMs:Date.now()+3600000}}]};
    if(method==='update.status')return {updateAvailable:{currentVersion:'0.19.4',latestVersion:'0.20.0',channel:'stable',commits:[{sha:'a',subject:'Faster first answer'}]}};
    return {};
  },
  open:async(key:string)=>{snap={...snap,sessionKey:key};listeners.forEach(fn=>fn())},
  reload:async()=>{},send:async()=>{},stopRun:async()=>{},answer:async()=>{},
  get engine(){if(cachedKey === snap.sessionKey && cachedEngine) return cachedEngine; cachedKey = snap.sessionKey; return cachedEngine = {sessionKey:snap.sessionKey,agentId:snap.sessionKey.split(':')[1],scopes:['operator.admin'],attachmentPolicy:{maxBytes:10000000},request:fixture.request,onEvent:(fn:Function)=>{events.add(fn);return()=>events.delete(fn)}}}
};
(window as any).fixture=fixture;
import {PreConnect} from '../src/setup/PreConnect';
import '../src/shell/controls.css';
const q=new URLSearchParams(location.search);
const pre=q.get('pre');
if(q.has('fresh')){try{sessionStorage.clear()}catch{}}
createRoot(document.getElementById('root')!).render(pre?<PreConnect local="ws://127.0.0.1:18789" address={pre==='address'?null:'ws://127.0.0.1:18789'} state={pre==='failed'?{kind:'failed',code:'AUTH_TOKEN_MISMATCH',message:'unauthorized: gateway token mismatch'}:pre==='pairing'?{kind:'pairing',requestId:'r1'}:pre==='key'?{kind:'key'}:{kind:'address'}} busy={false} startAtWhere={q.has('where')} onConnect={()=>{}} onRetry={()=>{}}/>:<WindowShell session={fixture as any} url="ws://isolated-fixture"/>);
