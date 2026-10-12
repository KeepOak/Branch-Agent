import { describe,expect,it,vi } from "vitest";
import type { WindowEngine } from "../../connect/engine";
import { loadCheckins,saveCheckins } from "./Checkins";
const engine=(request:WindowEngine["request"]):WindowEngine=>({request,onEvent:()=>()=>{},sessionKey:null,scopes:["operator.admin"]});
describe("check-in configuration",()=>{
  it("projects heartbeat fields without exposing unrelated model or credential configuration",async()=>{
    const request=vi.fn().mockResolvedValue({hash:"revision",valid:true,config:{secret:"do not project",agents:{defaults:{heartbeat:{every:"1h"},model:{primary:"private"}},entries:{scout:{name:"Scout",heartbeat:{prompt:"Look for news"}},other:{name:"Other"}}}}});
    expect(await loadCheckins(engine(request))).toEqual({hash:"revision",valid:true,defaults:{every:"1h"},entries:[{id:"scout",name:"Scout",heartbeat:{prompt:"Look for news"}}]});
  });
  it("patches only selected check-in fields with the read revision and preserves other config",async()=>{
    const request=vi.fn().mockResolvedValue({ok:true});
    await saveCheckins(engine(request),{hash:"revision",valid:true,defaults:{},entries:[{id:"scout",name:"Scout",heartbeat:{}}]},"scout",{every:"45m",prompt:"Check news"});
    expect(request).toHaveBeenCalledWith("config.patch",{baseHash:"revision",raw:JSON.stringify({agents:{entries:{scout:{heartbeat:{every:"45m",prompt:"Check news"}}}}})});
  });
  it("resets explicit values to inherited defaults without inventing a shipped interval",async()=>{
    const request=vi.fn().mockResolvedValue({ok:true});await saveCheckins(engine(request),{hash:"r",valid:true,defaults:{},entries:[]},"",{every:"",prompt:""});
    expect(JSON.parse(request.mock.calls[0][1].raw)).toEqual({agents:{defaults:{heartbeat:{every:null,prompt:null}}}});
  });
  it("refuses stale/missing revisions and does not report rejected saves as success",async()=>{
    const request=vi.fn().mockResolvedValue({ok:false,error:"revision changed"});const snapshot={hash:"",valid:true,defaults:{},entries:[]};
    await expect(saveCheckins(engine(request),snapshot,"",{every:"1h",prompt:""})).rejects.toThrow("revision");expect(request).not.toHaveBeenCalled();
    await expect(saveCheckins(engine(request),{...snapshot,hash:"r"},"",{every:"1h",prompt:""})).rejects.toThrow("revision changed");
  });
  it("preserves destination, active hours, model and approval settings outside the edited fields",async()=>{
    const config={agents:{defaults:{heartbeat:{every:"30m",target:"last",to:"private-chat",activeHours:{start:"09:00",end:"18:00"},model:"configured/model",directPolicy:"block"}},entries:{scout:{heartbeat:{every:"1h",target:"none"}}}},tools:{exec:{security:"allowlist",ask:"always"}}};
    const request=vi.fn().mockResolvedValueOnce({hash:"r",valid:true,config}).mockResolvedValueOnce({ok:true});
    const snapshot=await loadCheckins(engine(request));await saveCheckins(engine(request),snapshot,"",{every:"45m",prompt:"Check calendar"});
    const patch=JSON.parse(request.mock.calls[1][1].raw);
    expect(patch).toEqual({agents:{defaults:{heartbeat:{every:"45m",prompt:"Check calendar"}}}});
    expect(config.agents.defaults.heartbeat).toEqual({every:"30m",target:"last",to:"private-chat",activeHours:{start:"09:00",end:"18:00"},model:"configured/model",directPolicy:"block"});
    expect(patch.tools).toBeUndefined();expect(patch.agents.entries).toBeUndefined();
  });
  it("surfaces revision conflicts without silently reloading and replaying stale intent",async()=>{
    const request=vi.fn().mockRejectedValue(new Error("configuration revision conflict"));
    await expect(saveCheckins(engine(request),{hash:"old",valid:true,defaults:{},entries:[]},"",{every:"1h",prompt:""})).rejects.toThrow("revision conflict");
    expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][0]).toBe("config.patch");
  });
});
