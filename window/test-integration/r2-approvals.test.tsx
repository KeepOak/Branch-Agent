import {act} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {ApprovalCard,ApprovalGroup} from '../src/thread/ApprovalCard';
import {VoiceScreen,spokenAnswer} from '../src/composer/VoiceParts';
const fake=vi.hoisted(()=>({calls:[] as any[]}));
vi.mock('../src/composer/voice',()=>({
 Dictation:class{},voiceError:(e:any)=>String(e),
 VoiceCall:class { constructor(_e:any,on:any){fake.calls.push(on);}async start(){}async end(){}mute(){} }
}));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT=true;
let root:Root|undefined;
beforeEach(()=>vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,media:'',addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()}))));
afterEach(async()=>{if(root)await act(async()=>root!.unmount());root=undefined;document.body.innerHTML='';localStorage.clear();fake.calls=[];vi.unstubAllGlobals();});
const approval=(id:string)=>({id,state:'pending' as const,command:'synthetic action'});
const detail=(id:string,patch:any={})=>({id,plugin:true,title:'Send this synthetic note?',description:'To: Synthetic recipient\nSubject: Synthetic subject',sessionKey:'agent:main:main',allowedDecisions:['allow-once','deny'],expiresAtMs:Date.now()+60_000,...patch});
async function mount(element:any){const host=document.body.appendChild(document.createElement('div'));root=createRoot(host);await act(async()=>root!.render(element));return host;}
async function voice(d:any){const request=vi.fn(async(method:string)=>method==='plugin.approval.list'?{items:[{id:d.id,expiresAtMs:d.expiresAtMs,request:{...d}}]}:method==='exec.approval.list'?[]:{});const engine={sessionKey:'agent:main:main',request,onEvent:()=>()=>{},scopes:[]} as any;await mount(<VoiceScreen engine={engine} name="Sapling" onClose={()=>{}}/>);return request;}
const resolutions=(request:any)=>request.mock.calls.filter((c:any)=>c[0].endsWith('.approval.resolve'));
it('single plugin card honors allowed decisions and expiry',async()=>{const onAnswer=vi.fn();const host=await mount(<ApprovalCard approval={approval('p1')} details={detail('p1',{allowedDecisions:['deny']}) as any} name="Sapling" onAnswer={onAnswer}/>);expect(host.querySelector('[data-action=allow]')).toBeNull();await act(async()=>root!.render(<ApprovalCard approval={approval('p1')} details={detail('p1',{expiresAtMs:Date.now()-1000}) as any} name="Sapling" onAnswer={onAnswer}/>));expect(host.querySelector('button')).toBeNull();expect(onAnswer).not.toHaveBeenCalled();});
it('group does not offer Yes for a deny-only plugin request',async()=>{const host=await mount(<ApprovalGroup approvals={[approval('p1'),approval('p2')]} details={new Map([['p1',detail('p1',{allowedDecisions:['deny']})],['p2',detail('p2')]]) as any} name="Sapling" onAnswer={vi.fn()}/>);const yes=host.querySelector<HTMLButtonElement>('[data-approval=p1] .primary');expect(yes===null||yes.disabled).toBe(true);});
it('group batch answer never forwards an expired approval',async()=>{const onAnswer=vi.fn();const host=await mount(<ApprovalGroup approvals={[approval('p1'),approval('p2')]} details={new Map([['p1',detail('p1',{expiresAtMs:Date.now()-1000})],['p2',detail('p2')]]) as any} name="Sapling" onAnswer={onAnswer}/>);await act(async()=>host.querySelector<HTMLButtonElement>('[data-testid=yes-to-all]')?.click());expect(onAnswer.mock.calls.some(c=>c[0]==='p1')).toBe(false);});
it('voice routes a supported current-conversation Yes to the plugin resolver only',async()=>{const request=await voice(detail('p1'));await act(async()=>fake.calls[0].onCaption('user','yes'));expect(resolutions(request)).toEqual([['plugin.approval.resolve',{id:'p1',decision:'allow-once'}]]);});
it('voice ignores another conversation approval',async()=>{const request=await voice(detail('p1',{sessionKey:'agent:main:other'}));expect(document.querySelector('[data-testid=voice-ask]')).toBeNull();await act(async()=>fake.calls[0].onCaption('user','yes'));expect(resolutions(request)).toEqual([]);});
it('voice never offers or submits an expired approval',async()=>{const request=await voice(detail('p1',{expiresAtMs:Date.now()-1000}));expect(document.querySelector('[data-testid=voice-ask]')).toBeNull();await act(async()=>fake.calls[0].onCaption('user','yes'));expect(resolutions(request)).toEqual([]);});
it('voice never submits allow-once for a deny-only plugin request',async()=>{const request=await voice(detail('p1',{allowedDecisions:['deny']}));await act(async()=>fake.calls[0].onCaption('user','yes'));expect(resolutions(request)).toEqual([]);});
it('duplicate voice captions do not submit the same approval twice before its resolved event',async()=>{const request=await voice(detail('p1'));await act(async()=>{fake.calls[0].onCaption('user','yes');fake.calls[0].onCaption('user','yes');});expect(resolutions(request)).toHaveLength(1);});
it('ambiguous affirmative with explicit refusal does not become consent',()=>{expect(spokenAnswer("yes but don't send it")).toBeNull();});
