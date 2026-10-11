
const fs=require('fs');
const rs=fs.readFileSync('results.jsonl','utf8').split('\n').filter(Boolean).map(l=>JSON.parse(l));
const last={}; for (const r of rs) last[r.id]=r;
const manual=fs.existsSync('manual.json')?JSON.parse(fs.readFileSync('manual.json','utf8')):{};
const inv=fs.readFileSync('C:/Users/bishi/AppData/Local/Temp/elm-c6/inventory.tsv','utf8').split(/\r?\n/).filter(Boolean).map(l=>l.split('\t')).filter(r=>r[1]==='windows');
const clean=(s)=>String(s||'').replace(/[\t\r\n]+/g,' ').replace(/\s+/g,' ').trim();
function what(r){
  const d=r.diff||[]; const out=[];
  const st=d.find(x=>x.startsWith('state:'));
  if (st && st.length>6) {
    const names=['pressed','checked','expanded','selected','current','value','on'];
    const parts=st.slice(6).split(';').map(e=>{ const i=e.lastIndexOf('='); if(i<0) return ''; const n=e.slice(0,i).trim(); const v=e.slice(i+1).split('/'); const k=v.map((x,j)=>x&&x!=='null'?(x==='true'?names[j]:x==='false'?'not '+names[j]:names[j]+' '+x.slice(0,20)):'').filter(Boolean).join(', '); return n&&k&&!/\d\d:\d\d/.test(n)?n.slice(0,40)+': '+k:''; }).filter(Boolean);
    if (parts.length) out.push('now '+parts.slice(0,3).join('; '));
  }
  const ov=d.find(x=>x.startsWith('overlay:')); if (ov && ov.length>8) out.push('shows '+JSON.stringify(ov.slice(8,90)));
  if ((r.toast||[]).length && !ov) out.push('shows '+JSON.stringify(r.toast[0].slice(0,80)));
  if (d.includes('look')) out.push('window look changes');
  if (d.includes('url')) out.push('route changes');
  if ((r.popups||[]).length) out.push('opens '+r.popups[0]);
  if (r.clip && /Copy/i.test(r.label)) out.push('clipboard gets '+JSON.stringify(r.clip.slice(0,40)));
  if (!out.length && d.includes('text')) out.push('visible text changes');
  return out.join('; ');
}
function persist(r){
  const p=r.persist||{}; const kept=(p.ls||[]).filter(x=>x.endsWith(':kept')).map(x=>x.replace(':kept','')); const lost=(p.ls||[]).filter(x=>x.endsWith(':lost'));
  const parts=[];
  if (kept.length) parts.push('saved ('+kept.join(', ')+') and still set after a fresh load');
  if (lost.length) parts.push('NOT kept after reload: '+lost.join(', '));
  if (!kept.length && p.target && p.before && p.target!==p.before) parts.push('after a fresh load the control reads '+JSON.stringify(p.target.slice(0,70)));
  if (!parts.length) parts.push('nothing to save (opens a view, menu or dialog); fresh load returns to the same page');
  return parts.join('; ');
}
const rows=[]; const counts={};
for (const [id,os,root,place,label] of inv){
  const r=last[id]||{}; const m=manual[id];
  let result, note;
  const strong=(r.diff||[]).some(d=>d!=='text')||(r.popups||[]).length;
  if (m){ result=m.result; note=m.note; }
  else if (r.found && !r.disabled && strong){ result='verified'; note=what(r)+'. Persisted-state check: '+persist(r)+'.'; }
  else { result='UNRESOLVED'; note=JSON.stringify({found:r.found,disabled:r.disabled,diff:r.diff,err:r.error}).slice(0,200); }
  if (r.as && !m) note='Control now reads '+JSON.stringify(r.as)+'. '+note;
  if (r.preselect && !m) note='Was already chosen, so '+JSON.stringify(r.preselect)+' was picked first. '+note;
  counts[result]=(counts[result]||0)+1;
  rows.push([id,result,(m&&m.before)||r.before||'',(m&&m.after)||r.after||'',clean(root+' > '+label+' :: '+note)]);
}
fs.writeFileSync('c6-windows.tsv', ['id\tresult\tbefore\tafter\tnote',...rows.map(x=>x.map(clean).join('\t'))].join('\n')+'\n');
console.log(JSON.stringify(counts));
console.log(rows.filter(x=>x[1]==='UNRESOLVED').map(x=>x[0]+' '+x[4].slice(0,140)).join('\n'));
