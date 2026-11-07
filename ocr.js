// 運行日報：切り抜いた時刻欄・メーター欄の手書き数字を、スマホの中で読む。
// 文字を読む部品：PaddleOCR の認識モデル（PP-OCRv6 small / PP-OCRv5 mobile / PP-OCRv6 tiny）。
// 最初の1回だけモデル等をダウンロードし、スマホに保存する。写真は外へ送らない。
(function(){
'use strict';
const ORT='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
const HF='https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main/recognition/';
const MODELS=[{k:'v6s',m:'PP-OCRv6_small_rec.onnx',d:'ppocrv6_dict.txt'},{k:'v5',m:'PP-OCRv5_mobile_rec_infer.onnx',d:'ppocrv5_dict.txt'},{k:'v6t',m:'PP-OCRv6_tiny_rec.onnx',d:'ppocrv6_tiny_dict.txt'}];
const STORE='nippo-ocr-v1';
let ready=null;

async function fetchKeep(url,onBytes){ // スマホに保存してあればそれを使い、無ければ取ってきて保存する
  let c=null; try{ c=await caches.open(STORE); const hit=await c.match(url); if(hit) return hit; }catch(e){}
  const res=await fetch(url); if(!res.ok) throw new Error('download '+res.status);
  let body;
  if(res.body&&onBytes){ const rd=res.body.getReader(), parts=[]; let n=0; for(;;){ const {done,value}=await rd.read(); if(done) break; parts.push(value); n+=value.length; onBytes(value.length); } body=new Blob(parts); }
  else body=await res.blob();
  const keep=new Response(body); try{ if(c) await c.put(url,keep.clone()); }catch(e){}
  return keep;
}
function addScript(src){ return new Promise((ok,ng)=>{ const s=document.createElement('script'); s.src=src; s.onload=ok; s.onerror=()=>ng(new Error('script '+src)); document.head.appendChild(s); }); }
async function load(onProg){
  if(ready) return ready;
  ready=(async()=>{
    let got=0; const tick=n=>{ got+=n; onProg&&onProg(got); };
    if(!window.ort) await addScript(ORT+'ort.min.js');
    ort.env.wasm.wasmPaths=ORT; ort.env.wasm.numThreads=1;
    const eng=[];
    for(const M of MODELS){
      const dic=(await (await fetchKeep(HF+M.d)).text()).split(/\r\n|\r|\n/);
      const buf=await (await fetchKeep(HF+M.m,tick)).arrayBuffer();
      const sess=await ort.InferenceSession.create(buf,{executionProviders:['wasm']});
      eng.push({k:M.k,sess,dic});
    }
    return eng;
  })();
  try{ return await ready; }catch(e){ ready=null; throw e; }
}
async function recOne(E,cv){ // 高さ48にそろえ、青・緑・赤の順で −1〜1 にして読む
  if(!cv) return '';
  const H=48, W=Math.max(16,Math.min(1280,Math.round(H*cv.width/cv.height)));
  const c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d'); x.imageSmoothingQuality='high'; x.drawImage(cv,0,0,W,H);
  const d=x.getImageData(0,0,W,H).data, n=W*H, t=new Float32Array(3*n);
  for(let i=0;i<n;i++){ t[i]=(d[i*4+2]/255-0.5)/0.5; t[n+i]=(d[i*4+1]/255-0.5)/0.5; t[2*n+i]=(d[i*4]/255-0.5)/0.5; }
  const feeds={}; feeds[E.sess.inputNames[0]]=new ort.Tensor('float32',t,[1,3,H,W]);
  const out=(await E.sess.run(feeds))[E.sess.outputNames[0]];
  const T=out.dims[1], C=out.dims[2], p=out.data; let prev=-1, s='', probs=[];
  for(let i=0;i<T;i++){ let bi=0,bv=-Infinity; for(let j=0;j<C;j++){ const v=p[i*C+j]; if(v>bv){bv=v;bi=j;} }
    if(bi!==0&&bi!==prev){ s+=(E.dic[bi]??''); probs.push(bv); } prev=bi; }
  const mean=probs.length?probs.reduce((a,b)=>a+b,0)/probs.length:0;
  return mean>0.5?s:'';
}
const half=s=>String(s||'').replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248));
const asTime=s=>{ const d=half(s).replace(/\D/g,''); if(d.length<3||d.length>4) return null; const h=+d.slice(0,-2), m=+d.slice(-2); return (h<=23&&m<=59)?d:null; };
const asMeter=s=>{ const d=half(s).replace(/\D/g,''); return d.length===3?d:null; };
// rows: NippoPhoto.analyze の rows。2つ以上の読みが一致した欄だけ「確か」とする。
async function readRows(rows,onProg){
  const eng=await load(b=>onProg&&onProg({phase:'download',bytes:b}));
  const jobs=[]; rows.forEach((r,i)=>{ if(r.hasArr) jobs.push([i,'arr']); if(r.hasDep) jobs.push([i,'dep']); jobs.push([i,'meter']); });
  const total=jobs.length*eng.length*2; let done=0;
  const reads={};
  for(const [i,f] of jobs){ const crops=r=>f==='meter'?rows[i].ocr.meter:rows[i].ocr[f]; const cr=crops();
    const list=[]; for(const E of eng){ for(const v of ['A','C']){ let t=''; try{ t=await recOne(E,cr[v]); }catch(e){} list.push({src:E.k+v,t}); done++; onProg&&onProg({phase:'read',done,total}); } }
    reads[i+'_'+f]=list; }
  const res=rows.map(()=>({}));
  let prev=-1;
  rows.forEach((r,i)=>{ ['arr','dep'].forEach(f=>{ const list=reads[i+'_'+f]; if(!list) return;
      const votes={}; list.forEach(c=>{ const v=asTime(c.t); if(v){ (votes[v]=votes[v]||[]).push(c.src); } });
      let best=null; for(const [v,s] of Object.entries(votes)){ const mins=+v.slice(0,-2)*60+ +v.slice(-2); if(mins<prev) continue;
        const sc=s.length+(s.includes('v6sA')?0.5:0)+(s.includes('v6sC')?0.3:0); if(!best||sc>best.sc) best={v,sc,n:s.length,mins}; }
      if(best){ res[i][f]={v:best.v.slice(0,-2)+':'+best.v.slice(-2),n:best.n,sure:best.n>=2}; if(best.n>=2) prev=best.mins; } });
    const list=reads[i+'_meter']; const votes={}; list.forEach(c=>{ const v=asMeter(c.t); if(v){ (votes[v]=votes[v]||[]).push(c.src); } });
    let best=null; for(const [v,s] of Object.entries(votes)){ if(!best||s.length>best.n) best={v,n:s.length}; }
    if(best) res[i].meter={v:best.v,n:best.n,sure:best.n>=2}; });
  return {res,reads};
}
window.NippoOCR={load,readRows};
})();
