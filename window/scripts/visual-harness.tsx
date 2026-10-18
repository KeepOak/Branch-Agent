// Test fixture only; the shipped entry point imports App.tsx instead.
import React from 'react';
import {createRoot} from 'react-dom/client';
import {WindowShell} from '../src/shell/WindowShell';
import {TeamApprovalCard} from '../src/places/trunk/TeamApprovalCard';
import {ComputerStage} from '../src/stage/ComputerStage';
import {SettingsFrame} from '../src/screens/settings/SettingsFrame';
import {R1_PAGES} from '../src/screens/settings/pages/plugged';
import {OverflowPreview} from './overflow-fixture';
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
const TEAM_MEMBERS=[{name:'Builder Scout',role:'Scout',job:'Find the sources and facts the goal needs.',machine:'This computer',model:'anthropic/claude-sonnet'},{name:'Builder Writer',role:'Writer',job:"Draft the work from the Scout's findings.",machine:'This computer',model:'anthropic/claude-sonnet'},{name:'Builder Checker',role:'Checker',job:'Review each draft before it is final.',machine:'Mac mini',model:'anthropic/claude-sonnet'}];
const TEAM_STATES=['asking','applied','declined','unavailable'] as const;
function TeamPreview({state}:{state:string}){const shown=(TEAM_STATES as readonly string[]).includes(state)?state as typeof TEAM_STATES[number]:'asking';return <div style={{padding:24,background:'var(--bg,#f6f6f4)'}}><TeamApprovalCard goal="Ship the Q3 newsletter" members={TEAM_MEMBERS} state={shown}/></div>;}
// The computer pane on this Mac (Private #1103 item 5). ?computer=snapshot-error: the capture fails the way main's desktop
// pipe did; ?computer=blank: the capture comes back all black, as the driver's MCP proxy returns while Screen Recording is off.
const SNAPSHOT_ERROR='UNAVAILABLE: COMPUTER_DRIVER_ERROR: CUA MCP proxy returned an invalid JSON-RPC version';
function blackFrame(){const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;const context=canvas.getContext('2d')!;context.fillStyle='#000';context.fillRect(0,0,160,90);return canvas.toDataURL('image/png').split(',')[1];}
function computerEngine(state:string){
  let enabled=false;
  const request=async(method:string,params:any)=>{
    if(method==='sessions.describe')return {session:{key:'agent:scout:one'}};
    if(method==='environments.list')return {environments:[{id:'gateway',type:'local',status:'available'}]};
    if(method==='config.get')return {hash:enabled?'on':'off',valid:true,config:{plugins:{entries:{'cua-computer':{enabled}}}}};
    if(method==='config.patch'){enabled=true;return {ok:true};}
    if(method==='computer.status')return {available:enabled,computerUse:{provider:{generation:'driver-one'}}};
    if(method==='computer.invoke'){
      if(params?.command!=='screen.snapshot')return {payload:{ok:true}};
      if(state==='blank')return {payload:{format:'png',base64:blackFrame(),width:160,height:90}};
      throw new Error(SNAPSHOT_ERROR);
    }
    return {};
  };
  return {request,sessionKey:'agent:scout:one',scopes:['operator.admin'],onEvent:()=>()=>{}} as any;
}
function ComputerPreview({state}:{state:string}){const [engine]=React.useState(()=>computerEngine(state));return <div data-testid="computer-preview" style={{position:'fixed',inset:0,display:'flex',background:'var(--bg,#f6f6f4)'}}><ComputerStage engine={engine} gatewayUrl="ws://gateway.invalid" name="Scout" mode="Computer" onMode={()=>{}} onClose={()=>{}} onChooseComputer={()=>{}}/></div>;}
// ?settings=<level>: R1 Settings at that level in a frame like the window's: a 48px bar above a frame that fills the
// rest and clips what runs past it (height: 100%, overflow: hidden), so a nav taller than the frame shows.
function SettingsInFrame({level}:{level:string}){localStorage.setItem('branch.level',level);return <div style={{height:'100vh',display:'flex',flexDirection:'column',background:'var(--bg,#f6f6f4)'}}><div style={{height:48,flex:'none',background:'rgba(0,0,0,.08)'}}/><div data-testid="settings-frame" style={{flex:1,minHeight:0,overflow:'hidden'}}><SettingsFrame engine={fixture.engine as any} page="general" pages={R1_PAGES}/></div></div>;}
const query=new URLSearchParams(window.location.search);
const computerState=query.get('computer');
const teamState=query.get('team');
const settingsLevel=query.get('settings');
const overflow=query.get('overflow');
createRoot(document.getElementById('root')!).render(overflow!==null ? <OverflowPreview kind={overflow}/> : computerState!==null ? <ComputerPreview state={computerState}/> : teamState!==null ? <TeamPreview state={teamState}/> : settingsLevel!==null ? <SettingsInFrame level={settingsLevel}/> : <WindowShell session={fixture as any} url="ws://isolated-fixture"/>);
