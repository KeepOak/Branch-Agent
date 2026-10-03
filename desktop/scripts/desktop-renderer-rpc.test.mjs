import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
if (!process.env.BRANCH_DESKTOP_TEST_DIST) throw new Error("Strict compiled desktop source required");
const { DesktopRendererRpc } = await import(pathToFileURL(join(process.env.BRANCH_DESKTOP_TEST_DIST,"desktop-renderer-rpc.js")));
test("canonical authenticated renderer reply binds exact opaque request id",async()=>{
  let request;const rpc=new DesktopRendererRpc({isTrusted:()=>true,send:(_c,payload)=>request=payload},100);
  const pending=rpc.request("prepare",{targetBuild:"a".repeat(64)});rpc.reply({id:request.id,result:"forged"},false);
  rpc.reply({id:"other",result:"forged"},true);rpc.reply({id:request.id,result:{id:"engine-issued"}},true);
  assert.deepEqual(await pending,{id:"engine-issued"});rpc.close();
});
test("foreign renderer cannot invoke gateway lifecycle",async()=>{
  const rpc=new DesktopRendererRpc({isTrusted:()=>false,send:()=>assert.fail("untrusted send")},10);
  await assert.rejects(rpc.request("resume",{}),/unavailable/);rpc.close();
});
test("missing acknowledgment expires without acceptance and window close rejects outstanding RPC",async()=>{
  const rpc=new DesktopRendererRpc({isTrusted:()=>true,send:()=>{}},10);
  await assert.rejects(rpc.request("prepare",{}),/timed out/);
  const request=rpc.request("resume",{});rpc.close();await assert.rejects(request,/closed/);
});
