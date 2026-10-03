import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Strict compiled desktop source required");
const { DesktopUpdateLifecycle } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST, "desktop-update-lifecycle.js")));
const build = "a".repeat(64);
async function fixture(run, override = {}) {
  const root = await mkdtemp(join(tmpdir(), "branch-desktop-lifecycle-")); const file = join(root, "journal.json");
  const calls = []; const phases = [];
  const hooks = { prepare: async input => { calls.push(["prepare", input]); return { id:"receipt-1",sessionKey:"agent:trunk:main",expectedSessionId:"session-1",targetBuild:input.targetBuild,lifecycleGeneration:input.operationId, secret:"excluded" }; },
    resume: async receipt => { calls.push(["resume", receipt]); return "accepted"; }, cancel: async receipt => { calls.push(["cancel",receipt]); return "cancelled"; },
    phase: (phase,id) => phases.push([phase,id]), ...override };
  try { await run({ file,calls,phases,hooks,owner:new DesktopUpdateLifecycle(file,hooks), read:async()=>JSON.parse(await readFile(file,"utf8")) }); }
  finally { await rm(root,{recursive:true,force:true}); }
}
test("whole lifecycle mutex excludes publication and second restart until resume settles", async () => fixture(async ({owner}) => {
  let release; const gate = new Promise(resolve=>release=resolve); let runs=0;
  const first=owner.exclusive(async()=>{runs++;await gate;});
  assert.equal(await owner.exclusive(async()=>{runs++;}),undefined); assert.equal(runs,1); assert.equal(owner.active,true);
  release();await first;assert.equal(owner.active,false);
}));
test("durable authenticated checkpoint completes before stop and journals only receipt binding", async()=>fixture(async({owner,read,calls})=>{
  await owner.exclusive(async()=>{await owner.prepare(build);const journal=await read();assert.equal(journal.phase,"prepared");assert.equal("secret" in journal.receipt,false);calls.push(["stop"]);await owner.recover(build);});
  assert.deepEqual(calls.map(c=>c[0]),["prepare","stop","resume"]);assert.equal((await read()).phase,"completed");
}));
test("lost prepare acknowledgment retries persistent lifecycle generation without stopping engine",async()=>fixture(async({owner,hooks,read})=>{
  const ids=[]; const original=hooks.prepare; let lost=true;
  hooks.prepare=async input=>{ids.push(input.operationId);if(lost){lost=false;throw new Error("lost prepare ACK");}return original(input);};
  await assert.rejects(owner.prepare(build),/lost prepare/);assert.equal((await read()).phase,"intent");
  await owner.prepare(build);assert.equal(ids[0],ids[1]);assert.equal((await read()).phase,"prepared");
}));
test("lost accepted acknowledgment retries same receipt after launcher recovery",async()=>fixture(async({owner,hooks,file,read})=>{
  const ids=[];let first=true;
  hooks.resume=async value=>{ids.push(value.id);if(first){first=false;throw new Error("lost resume ACK");}return "accepted";};
  await owner.prepare(build);await assert.rejects(owner.recover(build),/lost resume/);assert.equal((await read()).phase,"ready");
  await new DesktopUpdateLifecycle(file,hooks).recover(build);assert.deepEqual(ids,["receipt-1","receipt-1"]);assert.equal((await read()).phase,"completed");
}));
test("candidate is durably cancelled before rollback and retained engine cannot replay",async()=>fixture(async({owner,read,calls})=>{
  await owner.prepare(build);owner.cancelBeforeRollback();assert.equal((await read()).phase,"cancelled");calls.push(["rollback"]);await owner.recover("b".repeat(64));
  assert.deepEqual(calls.map(c=>c[0]),["prepare","rollback","cancel"]);
}));
test("fresh requester authorization failure retains receipt and barrier without replay completion",async()=>fixture(async({owner,read})=>{
  await owner.prepare(build);await assert.rejects(owner.recover(build),/fresh authorization/);assert.equal((await read()).phase,"ready");
},{resume:async()=>{throw new Error("fresh authorization denied");}}));
test("immutable candidate mismatch never invokes resume",async()=>fixture(async({owner,calls,read})=>{
  await owner.prepare(build);await assert.rejects(owner.recover("b".repeat(64)),/does not match/);assert.equal((await read()).phase,"prepared");assert.equal(calls.filter(c=>c[0]==="resume").length,0);
}));
test("uncertain dispatch remains durable and blocked; session replacement cancels terminal",async()=>fixture(async({owner,hooks,read,phases})=>{
  await owner.prepare(build);hooks.resume=async()=>"uncertain";await assert.rejects(owner.recover(build),/acknowledgement/);assert.equal((await read()).phase,"ready");assert.equal(phases.at(-1)[0],"reconnecting");
  hooks.resume=async()=>"session-changed";await owner.recover(build);assert.equal((await read()).phase,"cancelled");assert.equal(phases.at(-1)[0],"failed");
}));
test("invalid or mismatched prepare receipt leaves engine running and durable intent recoverable",async()=>fixture(async({owner,read})=>{
  await assert.rejects(owner.prepare(build),/binding mismatch/);assert.equal((await read()).phase,"intent");
},{prepare:async input=>({id:"x",sessionKey:"key",expectedSessionId:"session",targetBuild:"b".repeat(64),lifecycleGeneration:input.operationId})}));

test("authorized idle update records identity but never invents a continuation turn",async()=>fixture(async({owner,read,calls})=>{
  await owner.prepare(build);assert.equal((await read()).phase,"idle");await owner.recover(build);assert.equal((await read()).phase,"completed");assert.equal(calls.length,0);
},{prepare:async input=>({status:"idle",lifecycleGeneration:input.operationId,targetBuild:input.targetBuild})}));
test("failed idle candidate is tombstoned before rollback with no agent replay",async()=>fixture(async({owner,read,calls})=>{
  await owner.prepare(build);owner.cancelBeforeRollback();assert.equal((await read()).phase,"idle-cancelled");await owner.recover("b".repeat(64));assert.equal(owner.pending,undefined);assert.equal(calls.length,0);
},{prepare:async input=>({status:"idle",lifecycleGeneration:input.operationId,targetBuild:input.targetBuild})}));

test("launcher recovery restores input barrier before the early renderer reconnects",async()=>fixture(async({owner,file,hooks})=>{
  await owner.prepare(build);const restored=new DesktopUpdateLifecycle(file,hooks);assert.equal(restored.initialState.phase,"reconnecting");
  await restored.recover(build);assert.equal(restored.initialState,undefined);
}));

test("unrelated active work defers update and releases renderer barrier without stopping",async()=>fixture(async({owner,read,phases})=>{
  assert.equal(await owner.prepare(build),false);assert.equal((await read()).phase,"completed");assert.equal(phases.at(-1)[0],"failed");assert.equal(owner.pending,undefined);
},{prepare:async input=>({status:"deferred",lifecycleGeneration:input.operationId,targetBuild:input.targetBuild})}));
test("aborted idle stop cancels exact admitted generation through real caller hook",async()=>fixture(async({owner,calls,read})=>{
  await owner.prepare(build);const journal=await read();await owner.abortBeforeStop();assert.deepEqual(calls,[['cancel',{lifecycleGeneration:journal.operationId,targetBuild:build}]]);assert.equal(owner.pending,undefined);
},{prepare:async input=>({status:"idle",lifecycleGeneration:input.operationId,targetBuild:input.targetBuild})}));
test("lost generation cancellation ACK retains idle lease journal and input barrier",async()=>fixture(async({owner,hooks,read})=>{
  await owner.prepare(build);hooks.cancel=async()=>{throw new Error("lost cancel ACK")};await assert.rejects(owner.abortBeforeStop(),/lost cancel/);assert.equal((await read()).phase,"idle");assert.equal(owner.pending.phase,"idle");
},{prepare:async input=>({status:"idle",lifecycleGeneration:input.operationId,targetBuild:input.targetBuild})}));
