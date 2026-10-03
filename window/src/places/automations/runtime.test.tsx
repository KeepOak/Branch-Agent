// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { ActionGate, approvals, paged, refreshesPlaces, resolveApproval, usePlaceData } from "./runtime";
import { scheduleFromDraft } from "./index";
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const deferred = <T,>() => { let resolve!: (value:T)=>void, reject!: (reason:unknown)=>void; const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; };
const engine = (request: WindowEngine["request"]): WindowEngine => ({ request, onEvent: () => () => {}, sessionKey:null,scopes:["operator.admin"] });
let root: Root | undefined;
afterEach(async () => { if(root) await act(async()=>root?.unmount()); root=undefined; document.body.innerHTML=""; });
describe("activity contracts", () => {
  it("refreshes on Canopy's plugin.canopy.* events, not the retired workboard name", () => {
    expect(refreshesPlaces("plugin.canopy.changed")).toBe(true);
    expect(refreshesPlaces("plugin.workboard.changed")).toBe(false);
    expect(refreshesPlaces("sessions.changed")).toBe(true);
  });
  it("reads all pages rather than silently dropping schedules beyond 200", async()=>{
    const request=vi.fn().mockResolvedValueOnce({jobs:Array.from({length:200},(_,id)=>({id})),hasMore:true}).mockResolvedValueOnce({jobs:[{id:200}],hasMore:false});
    expect(await paged(engine(request),"cron.list","jobs",{includeDisabled:true})).toHaveLength(201);
    expect(request.mock.calls[1]).toEqual(["cron.list",{includeDisabled:true,limit:200,offset:200}]);
  });
  it("keeps available approvals and exposes failed queues, including Branch proposals",async()=>{
    const request=vi.fn(async(method:string)=>{if(method==="plugin.approval.list")throw new Error("not connected"); return [{id:method,request:{}}];});
    const value=await approvals(engine(request as WindowEngine["request"]));
    expect(value.items.map(r=>r.kind)).toEqual(["exec","branch"]); expect(value.errors).toEqual(["Add-on approvals: not connected"]);
    expect(request).toHaveBeenCalledWith("branch.approval.list",{});
  });
  it("suppresses double-click mutations and unlocks after rejection",async()=>{
    const gate=new ActionGate(), pending=deferred<void>(), action=vi.fn(()=>pending.promise);
    const first=gate.run(action); expect(await gate.run(action)).toEqual({accepted:false}); expect(action).toHaveBeenCalledTimes(1);
    pending.reject(new Error("interrupted")); await expect(first).rejects.toThrow("interrupted");
    expect(await gate.run(async()=>"retry")).toEqual({accepted:true,value:"retry"});
  });
  it("uses canonical Branch-change approval kinds and does not claim a competing answer was applied",async()=>{
    const request=vi.fn().mockResolvedValueOnce({applied:true}).mockResolvedValueOnce({applied:false});
    const item={id:"change",kind:"branch",request:{allowedDecisions:["allow-once","deny"]}};
    await resolveApproval(engine(request),item,"allow-once");expect(request).toHaveBeenCalledWith("approval.resolve",{id:"change",kind:"system-agent",decision:"allow-once"});
    await expect(resolveApproval(engine(request),item,"deny")).rejects.toThrow("already answered elsewhere");
  });
  it("validates explicit interval and time zone without pretending to parse prose",()=>{
    const draft={name:"Inbox",message:"Check invoices",kind:"every",every:"5",expression:"",timezone:"UTC",at:"",agentId:"",payloadKind:"agentTurn"};
    expect(scheduleFromDraft(draft)).toEqual({kind:"every",everyMs:300000});
    expect(()=>scheduleFromDraft({...draft,every:"0"})).toThrow("positive interval");
    expect(()=>scheduleFromDraft({...draft,kind:"cron",expression:"0 8 * * *",timezone:"invalid-zone"})).toThrow("valid time zone");
  });
});
describe("activity request lifecycle",()=>{
  it("ignores an interrupted older read and displays the latest retry",async()=>{
    const old=deferred<string>(), latest=deferred<string>(); let calls=0;
    const load=()=> (++calls===1?old.promise:latest.promise); let state!:ReturnType<typeof usePlaceData<string>>;
    function Harness(){state=usePlaceData(engineObject,load);return <span>{state.data ?? state.error}</span>;}
    const engineObject=engine(vi.fn()); const host=document.createElement("div");document.body.append(host);root=createRoot(host);
    await act(async()=>root!.render(<Harness/>));
    await act(async()=>{void state.refresh();});
    await act(async()=>latest.resolve("new")); await act(async()=>old.resolve("stale")); expect(host.textContent).toBe("new");
  });
  it("keeps busy through duplicate clicks and reports failure before allowing retry",async()=>{
    const pending=deferred<unknown>(), operation=vi.fn(()=>pending.promise); const engineObject=engine(vi.fn()); const load=async()=>"loaded";
    let state!:ReturnType<typeof usePlaceData<string>>;function Harness(){state=usePlaceData(engineObject,load);return <span>{state.notice}</span>;}
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<Harness/>));
    let first!:Promise<boolean>;await act(async()=>{first=state.act(operation,"success");});
    await act(async()=>{expect(await state.act(operation,"duplicate")).toBe(false);});expect(state.busy).toBe(true);
    await act(async()=>{pending.reject(new Error("connection lost"));await first;});expect(host.textContent).toBe("connection lost");expect(state.busy).toBe(false);
    await act(async()=>{expect(await state.act(async()=>({ok:true}),"retried")).toBe(true);});expect(host.textContent).toBe("retried");expect(operation).toHaveBeenCalledTimes(1);
  });
  it("does not carry a late old-engine read across reconnect",async()=>{
    const old=deferred<string>();const firstEngine=engine(vi.fn()),secondEngine=engine(vi.fn());const load=(e:WindowEngine)=>e===firstEngine?old.promise:Promise.resolve("reconnected");
    function Harness({connection}:{connection:WindowEngine}){const state=usePlaceData(connection,load);return <span>{state.data}</span>;}
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<Harness connection={firstEngine}/>));
    await act(async()=>root!.render(<Harness connection={secondEngine}/>));await act(async()=>old.resolve("old"));expect(host.textContent).toBe("reconnected");
  });
  it("does not announce success after the screen has been closed",async()=>{
    const pending=deferred<unknown>();const engineObject=engine(vi.fn()), load=async()=>"ready";let state!:ReturnType<typeof usePlaceData<string>>;
    function Harness(){state=usePlaceData(engineObject,load);return <span>{state.notice}</span>;}
    const host=document.createElement("div");document.body.append(host);root=createRoot(host);await act(async()=>root!.render(<Harness/>));
    let request!:Promise<boolean>;await act(async()=>{request=state.act(()=>pending.promise,"saved");});await act(async()=>root!.unmount());root=undefined;
    pending.resolve({ok:true});expect(await request).toBe(false);expect(host.textContent).toBe("");
  });
});
