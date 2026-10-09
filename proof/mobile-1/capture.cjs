const {spawn}=require('child_process');const fs=require('fs');const path=require('path');
const exe=process.argv[2], url=process.argv[3], outDir=process.argv[4];
const port=47329;
const chrome=spawn(exe,['--headless=new','--disable-gpu','--hide-scrollbars','--remote-debugging-port='+port,'--user-data-dir='+path.join(require('os').tmpdir(),'bmc-cdp'),'about:blank'],{windowsHide:true,stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{try{
 let ws;for(let i=0;i<50;i++){try{const t=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();const p=t.find(x=>x.type==='page');if(p){ws=p.webSocketDebuggerUrl;break;}}catch{}await sleep(200);}
 const sock=new WebSocket(ws);await new Promise(r=>sock.onopen=r);let id=0;const pend=new Map();
 sock.onmessage=e=>{const m=JSON.parse(e.data);if(m.id&&pend.has(m.id)){pend.get(m.id)(m);pend.delete(m.id);}};
 const send=(method,params={})=>new Promise(r=>{const i=++id;pend.set(i,r);sock.send(JSON.stringify({id:i,method,params}));});
 await send('Emulation.setDeviceMetricsOverride',{width:393,height:852,deviceScaleFactor:3,mobile:true});
 for(const scheme of ['light','dark']){
  await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
  await send('Page.navigate',{url});await sleep(2500);
  const r=await send('Page.captureScreenshot',{format:'png'});
  fs.writeFileSync(path.join(outDir,'mobile-1-welcome-'+scheme+'.png'),Buffer.from(r.result.data,'base64'));
 }
 sock.close();
}finally{chrome.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});