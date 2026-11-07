// 運行日報：切り抜いた時刻欄・メーター欄の手書き数字を、スマホの中で読む。
// 文字を読む部品：PaddleOCR の認識モデル（PP-OCRv6 small / PP-OCRv5 mobile / PP-OCRv6 tiny）。
// 最初の1回だけモデル等をダウンロードし、スマホに保存する。写真は外へ送らない。
// 読み方：1つの欄を「3つのモデル × 6種類の切り抜き × 2通りの読み方」で読み、重み付きの多数決で決める。
//   重みと「青（自信あり）」の基準は、2026-11-07 の日報3枚で決めた（1枚を外して残り2枚で決め、外した1枚で確かめる方法で、青の間違い0を確認）。
(function(){
'use strict';
const ORT='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
const HF='https://huggingface.co/snowfluke/ppu-paddle-ocr-models/resolve/main/recognition/';
const MODELS=[{k:'v6s',m:'PP-OCRv6_small_rec.onnx',d:'ppocrv6_dict.txt'},{k:'v5',m:'PP-OCRv5_mobile_rec_infer.onnx',d:'ppocrv5_dict.txt'},{k:'v6t',m:'PP-OCRv6_tiny_rec.onnx',d:'ppocrv6_tiny_dict.txt'}];
const STORE='nippo-ocr-v1';
// 読み方ごとの重み（T=時刻、M=メーター。モデル名＋切り抜きの種類＋d=数字だけで読む）
const W={Tv5Ad:2.2,Mv6sAed:1.95,Tv5A:1.88,Tv6sAe:1.61,Mv6sAe:1.61,Mv6sC:1.47,Mv6sCd:1.47,Tv6sAed:1.44,Mv6tC:1.3,Mv6tCd:1.3,Mv6tCed:1.3,Tv6sCe:1.24,Tv6sCed:1.24,Tv6tAed:1.24,Tv5Apd:1.21,Tv6tAe:1.2,Tv5C:1.16,Tv5Ap:1.16,Tv5Ced:1.15,Tv5Cd:1.1,Tv5Ce:1.1,Mv6tCe:1.1,Tv6sC:1.05,Tv6sCd:1.05,Tv6sApd:0.99,Tv6sA:0.99,Tv6sAd:0.89,Mv6sA:0.85,Mv6sAd:0.85,Tv6sAp:0.72,Tv5Aed:0.67,Tv6tCe:0.66,Tv6tCed:0.61,Mv6sCe:0.59,Mv6sCed:0.59,Mv5C:0.59,Mv5Cd:0.59,Mv5Cp:0.51,Mv6tAe:0.51,Mv6tAed:0.51,Tv5Ae:0.44,Tv6tA:0.42,Tv6tAd:0.39,Tv6tCd:0.36,Tv6sCpd:0.34,Mv6sCp:0.34,Mv6sCpd:0.34,Tv6tC:0.07};
const TH={t:{blue:15,gap:3,yel:1},m:{blue:6,gap:3,yel:0.8}};
let ready=null;

async function fetchKeep(url,onBytes){ // スマホに保存してあればそれを使い、無ければ取ってきて保存する
  let c=null; try{ c=await caches.open(STORE); const hit=await c.match(url); if(hit) return hit; }catch(e){}
  const res=await fetch(url); if(!res.ok) throw new Error('download '+res.status);
  let body;
  if(res.body&&onBytes){ const rd=res.body.getReader(), parts=[]; for(;;){ const {done,value}=await rd.read(); if(done) break; parts.push(value); onBytes(value.length); } body=new Blob(parts); }
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
      const allow=[0]; dic.forEach((ch,i)=>{ if(/^[0-9０-９:：]$/.test(ch)) allow.push(i); });
      eng.push({k:M.k,sess,dic,allow});
    }
    return eng;
  })();
  try{ return await ready; }catch(e){ ready=null; throw e; }
}
// 高さ48にそろえ、青・緑・赤の順で −1〜1 にして読む。全文字で読んだ結果と、数字とコロンだけで読んだ結果の2つを返す
async function recBoth(E,cv){
  if(!cv) return null;
  const H=48, Wd=Math.max(16,Math.min(1280,Math.round(H*cv.width/cv.height)));
  const c=document.createElement('canvas'); c.width=Wd; c.height=H; const x=c.getContext('2d'); x.imageSmoothingQuality='high'; x.drawImage(cv,0,0,Wd,H);
  const d=x.getImageData(0,0,Wd,H).data, n=Wd*H, t=new Float32Array(3*n);
  for(let i=0;i<n;i++){ t[i]=(d[i*4+2]/255-0.5)/0.5; t[n+i]=(d[i*4+1]/255-0.5)/0.5; t[2*n+i]=(d[i*4]/255-0.5)/0.5; }
  const feeds={}; feeds[E.sess.inputNames[0]]=new ort.Tensor('float32',t,[1,3,H,Wd]);
  const out=(await E.sess.run(feeds))[E.sess.outputNames[0]];
  const T=out.dims[1], C=out.dims[2], p=out.data;
  const dec=idx=>{ let prev=-1,s='',pr=[]; for(let i=0;i<T;i++){ let bi=0,bv=-Infinity;
      if(idx){ for(const j of idx){ const v=p[i*C+j]; if(v>bv){bv=v;bi=j;} } } else { for(let j=0;j<C;j++){ const v=p[i*C+j]; if(v>bv){bv=v;bi=j;} } }
      if(bi!==0&&bi!==prev){ s+=(E.dic[bi]??''); pr.push(bv); } prev=bi; }
    const m=pr.length?pr.reduce((a,b)=>a+b,0)/pr.length:0; return {t:s,m}; };
  return {free:dec(null),digit:dec(E.allow)};
}
// 切り抜きの種類：A=広め、C=字のまわりだけ、e=背景を白くして濃くしたもの、p=余白を足したもの
function enh(cv){ if(!cv) return null; const w=cv.width,h=cv.height, d=cv.getContext('2d').getImageData(0,0,w,h).data, g=new Float32Array(w*h);
  for(let i=0;i<w*h;i++) g[i]=(d[i*4]*299+d[i*4+1]*587+d[i*4+2]*114)/1000;
  const s=Array.from(g).sort((a,b)=>a-b), lo=s[Math.floor(s.length*0.02)], hi=s[Math.floor(s.length*0.7)];
  const o=document.createElement('canvas'); o.width=w; o.height=h; const od=o.getContext('2d').createImageData(w,h);
  for(let i=0;i<w*h;i++){ let v=(g[i]-lo)/Math.max(1,hi-lo); v=Math.max(0,Math.min(1,v)); v=Math.pow(v,1.6)*255; od.data[i*4]=od.data[i*4+1]=od.data[i*4+2]=v; od.data[i*4+3]=255; }
  o.getContext('2d').putImageData(od,0,0); return o; }
function pad(cv,fr){ if(!cv) return null; const p=Math.round(cv.height*fr), o=document.createElement('canvas'); o.width=cv.width+2*p; o.height=cv.height+2*p;
  const x=o.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,o.width,o.height); x.drawImage(cv,p,p); return o; }
const half=s=>String(s||'').replace(/[０-９]/g,c=>String.fromCharCode(c.charCodeAt(0)-65248));
const asTime=(s,m)=>{ if(m<0.5) return null; const d=half(s).replace(/\D/g,''); if(d.length<3||d.length>4) return null; const h=+d.slice(0,-2), mi=+d.slice(-2); return (h<=23&&mi<=59)?d:null; };
const asMeter=(s,m)=>{ if(m<0.5) return null; const d=half(s).replace(/\D/g,''); return d.length===3?d:null; };
const mins=v=>+v.slice(0,-2)*60+ +v.slice(-2);
// rows: NippoPhoto.analyze の rows。opt={start,end}（始業・終業メーターの数字。無ければ空）
async function readRows(rows,opt,onProg){
  opt=opt||{};
  const eng=await load(b=>onProg&&onProg({phase:'download',bytes:b}));
  const jobs=[]; rows.forEach((r,i)=>{ if(r.hasArr) jobs.push([i,'arr']); if(r.hasDep) jobs.push([i,'dep']); jobs.push([i,'meter']); });
  const total=jobs.length*eng.length*6; let done=0;
  const reads={};
  for(const [i,f] of jobs){
    const cr=f==='meter'?rows[i].ocr.meter:rows[i].ocr[f];
    const V={A:cr.A,C:cr.C,Ae:enh(cr.A),Ce:enh(cr.C),Ap:pad(cr.A,0.3),Cp:pad(cr.C,0.4)};
    const list=[];
    for(const E of eng) for(const [vn,cv] of Object.entries(V)){
      let r=null; try{ r=await recBoth(E,cv); }catch(e){}
      if(r){ list.push({s:E.k+vn,t:r.free.t,m:r.free.m}); list.push({s:E.k+vn+'d',t:r.digit.t,m:r.digit.m}); }
      done++; onProg&&onProg({phase:'read',done,total}); }
    reads[i+'_'+f]=list; }
  // 決める：時刻は前の欄より後、メーターは前の値から戻らず300km以上飛ばず、終業メーターを越えない
  const lower3=v=>{ const d=String(v||'').replace(/\D/g,''); return d?Number(d.slice(-3)):null; };
  let prevT=-1, prevM=lower3(opt.start); const endM=lower3(opt.end);
  const res=rows.map(()=>({}));
  rows.forEach((r,i)=>{ ['arr','dep','meter'].forEach(f=>{ const list=reads[i+'_'+f]; if(!list) return; const isM=f==='meter';
      const sc={};
      for(const c of list){ let v=isM?asMeter(c.t,c.m):asTime(c.t,c.m); if(!v) continue; const w=W[(isM?'M':'T')+c.s]||0; if(!w) continue;
        if(!isM&&v.length===3&&prevT>=0&&mins(v)<prevT){ const v2='1'+v; if(asTime(v2,1)&&mins(v2)>=prevT) v=v2; } // 先頭の「1」の読み落としを補う
        sc[v]=(sc[v]||0)+w; }
      let cand=Object.entries(sc).sort((a,b)=>b[1]-a[1]);
      if(!isM) cand=cand.filter(([v])=>mins(v)>=prevT);
      else { if(prevM!=null) cand=cand.filter(([v])=>((+v-prevM+1000)%1000)<=300); if(prevM!=null&&endM!=null) cand=cand.filter(([v])=>((+v-prevM+1000)%1000)<=((endM-prevM+1000)%1000)); }
      if(!cand.length) return;
      const [v,s]=cand[0], s2=cand[1]?cand[1][1]:0, th=isM?TH.m:TH.t;
      let tier=''; if(s>=th.blue&&s-s2>=th.gap) tier='blue'; else if(s>=th.yel) tier='yellow'; if(!tier) return;
      res[i][f]={v:isM?v:v.slice(0,-2)+':'+v.slice(-2),tier,score:+s.toFixed(1)};
      if(tier==='blue'){ if(isM) prevM=+v; else prevT=mins(v); } }); });
  return {res,reads};
}
window.NippoOCR={load,readRows};
})();
