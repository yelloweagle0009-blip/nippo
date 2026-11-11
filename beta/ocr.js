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
// メモリを節約：3つのモデルを同時に開かず、1つずつ開いて使い、次を開く前に閉じる
let opened=null, dics={}, got=0;
async function ensureOrt(){
  if(!ready) ready=(async()=>{ if(!window.ort) await addScript(ORT+'ort.min.js'); ort.env.wasm.wasmPaths=ORT; ort.env.wasm.numThreads=1; })();
  try{ await ready; }catch(e){ ready=null; throw e; }
}
async function openModel(i,onProg){
  if(opened&&opened.i===i) return opened.E;
  if(opened){ const o=opened; opened=null; try{ await o.E.sess.release(); }catch(e){} }
  await ensureOrt();
  const M=MODELS[i];
  if(!dics[M.k]) dics[M.k]=(await (await fetchKeep(HF+M.d)).text()).split(/\r\n|\r|\n/);
  const dic=dics[M.k];
  let buf=await (await fetchKeep(HF+M.m,n=>{ got+=n; onProg&&onProg({phase:'download',bytes:got}); })).arrayBuffer();
  const sess=await ort.InferenceSession.create(buf,{executionProviders:['wasm']}); buf=null;
  const allow=[0]; dic.forEach((ch,j)=>{ if(/^[0-9０-９:：]$/.test(ch)) allow.push(j); });
  const E={k:M.k,sess,dic,allow}; opened={i,E}; return E;
}
// 3つのモデルで順に fn(E, モデルの番号) を呼ぶ。いま開いているモデルから始めて開き直しを減らす。
// 結果はモデルの番号の順（v6s→v5→v6t）に並べ直して使うので、どの順で読んでも答えは同じ
async function eachModel(onProg,fn){
  const order=MODELS.map((_,i)=>i); if(opened){ const c=opened.i; order.sort((a,b)=>(b===c)-(a===c)||a-b); }
  for(const i of order){ const E=await openModel(i,onProg); await fn(E,i); }
}
async function load(onProg){ await eachModel(onProg,async()=>{}); return MODELS.length; }
async function closeModels(){ if(opened){ const o=opened; opened=null; try{ await o.E.sess.release(); }catch(e){} } }
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
  const jobs=[]; rows.forEach((r,i)=>{ if(r.hasArr) jobs.push([i,'arr']); if(r.hasDep) jobs.push([i,'dep']); jobs.push([i,'meter']); });
  const total=jobs.length*MODELS.length*6; let done=0;
  const Vs=jobs.map(([i,f])=>{ const cr=f==='meter'?rows[i].ocr.meter:rows[i].ocr[f];
    return {A:cr.A,C:cr.C,Ae:enh(cr.A),Ce:enh(cr.C),Ap:pad(cr.A,0.3),Cp:pad(cr.C,0.4)}; });
  const slot=jobs.map(()=>MODELS.map(()=>[]));   // slot[欄][モデル] = 読んだ結果
  await eachModel(onProg,async(E,m)=>{
    for(let j=0;j<jobs.length;j++) for(const [vn,cv] of Object.entries(Vs[j])){
      let r=null; try{ r=await recBoth(E,cv); }catch(e){}
      if(r){ slot[j][m].push({s:E.k+vn,t:r.free.t,m:r.free.m}); slot[j][m].push({s:E.k+vn+'d',t:r.digit.t,m:r.digit.m}); }
      done++; onProg&&onProg({phase:'read',done,total}); } });
  const reads={}; jobs.forEach(([i,f],j)=>{ reads[i+'_'+f]=[].concat(...slot[j]); });
  return {res:decide(rows.length,reads,opt,W,TH),reads};
}
const lower3=v=>{ const d=String(v||'').replace(/\D/g,''); return d?Number(d.slice(-3)):null; };
// 1つの欄の候補（値→重みの合計）。時刻は先頭の「1」の読み落としを補った候補も少し軽く足す。メーターは4桁以上なら下3桁も候補にする
function candidates(list,isM,Wt){
  const sc={};
  for(const c of list){ const w=Wt[(isM?'M':'T')+c.s]||0; if(!w||c.m<0.5) continue; const d=half(c.t).replace(/\D/g,'');
    if(isM){ if(d.length===3) sc[d]=(sc[d]||0)+w; else if(d.length>3){ const v=d.slice(-3); sc[v]=(sc[v]||0)+w*0.8; } }
    else { const v=asTime(c.t,c.m); if(!v) continue; sc[v]=(sc[v]||0)+w;
      if(v.length===3){ const v2='1'+v; if(asTime(v2,1)) sc[v2]=(sc[v2]||0)+w*0.9; } } }
  return Object.entries(sc).sort((a,b)=>b[1]-a[1]);
}
function tierOf(v,cand,th){ const e=cand.find(c=>c[0]===v); if(!e) return '';
  const rel=x=>x===v||x==='1'+v||v==='1'+x;   // 「1」を補った候補とその元は、張り合う相手として数えない
  const s=e[1], others=cand.filter(c=>!rel(c[0])), s2=Math.max(0,...others.map(c=>c[1]));
  const top=cand.filter(c=>!others.includes(c)||c[0]===v).length&&(others.length===0||s>=others[0][1]);
  if(top&&s>=th.blue&&s-s2>=th.gap) return 'blue'; return s>=th.yel?'yellow':''; }
// 全部の行をまとめて決める：メーターは前から戻らず・300km以上飛ばず・終業メーターを越えない組み合わせ、
// 時刻は順に進み、メーターの差に対して速すぎない（時速90km以下）組み合わせのうち、重みの合計が一番大きいものを選ぶ
function decide(n,reads,opt,Wt,T){
  Wt=Wt||W; T=T||TH; opt=opt||{};
  const res=Array.from({length:n},()=>({}));
  const sM=lower3(opt.start), eM=lower3(opt.end);
  // メーター
  const mc=[]; for(let i=0;i<n;i++){ if(i===0&&sM!=null) continue; if(i===n-1&&eM!=null&&i>0) continue; const l=reads[i+'_meter']; if(l) mc.push({i,cand:candidates(l,true,Wt).slice(0,5)}); }
  const okM=(last,v)=>{ if(last==null) return true; const d=(v-last+1000)%1000; if(d>300) return false; if(eM!=null&&d>((eM-last+1000)%1000)) return false; return true; };
  let st=new Map([[String(sM),{sc:0,last:sM,path:[]}]]);
  for(const c of mc){ const nx=new Map(); const put=(k,o)=>{ const p=nx.get(k); if(!p||o.sc>p.sc) nx.set(k,o); };
    for(const o of st.values()){ put(String(o.last),{sc:o.sc,last:o.last,path:o.path.concat([null])});
      for(const [v,s] of c.cand){ const x=+v; if(okM(o.last,x)) put(String(x),{sc:o.sc+s,last:x,path:o.path.concat([v])}); } }
    st=nx; }
  const bestM=[...st.values()].sort((a,b)=>b.sc-a.sc)[0];
  const meterAt={}; if(sM!=null) meterAt[0]=sM; if(eM!=null&&n>1) meterAt[n-1]=eM;
  mc.forEach((c,j)=>{ const v=bestM.path[j]; if(v==null) return; meterAt[c.i]=+v; const t=tierOf(v,c.cand,T.m); if(t) res[c.i].meter={v,tier:t,score:+(c.cand.find(e=>e[0]===v)[1]).toFixed(1)}; });
  // 時刻
  const tc=[]; for(let i=0;i<n;i++) for(const f of ['arr','dep']){ const l=reads[i+'_'+f]; if(l) tc.push({i,f,cand:candidates(l,false,Wt).slice(0,5)}); }
  const okT=(o,c,m)=>{ if(o.last==null) return true; if(m<o.last) return false;
    if(c.f==='arr'&&o.cell&&o.cell.f==='dep'&&o.cell.i===c.i-1&&meterAt[c.i-1]!=null&&meterAt[c.i]!=null){ const km=(meterAt[c.i]-meterAt[c.i-1]+1000)%1000; if((m-o.last)*1.5<km) return false; }
    return true; };
  st=new Map([['s',{sc:0,last:null,cell:null,path:[]}]]);
  for(const c of tc){ const nx=new Map(); const put=(k,o)=>{ const p=nx.get(k); if(!p||o.sc>p.sc) nx.set(k,o); };
    for(const o of st.values()){ put(o.last+'|'+(o.cell?o.cell.i+o.cell.f:''),{sc:o.sc,last:o.last,cell:o.cell,path:o.path.concat([null])});
      for(const [v,s] of c.cand){ const m=mins(v); if(okT(o,c,m)) put(m+'|'+c.i+c.f,{sc:o.sc+s,last:m,cell:c,path:o.path.concat([v])}); } }
    st=nx; }
  const bestT=[...st.values()].sort((a,b)=>b.sc-a.sc)[0];
  tc.forEach((c,j)=>{ const v=bestT.path[j]; if(v==null) return; const t=tierOf(v,c.cand,T.t); if(t) res[c.i][c.f]={v:v.slice(0,-2)+':'+v.slice(-2),tier:t,score:+(c.cand.find(e=>e[0]===v)[1]).toFixed(1)}; });
  return res;
}
// 前の版の決め方（比べるために残す）：前から順に1欄ずつ、青で決めた値だけを次の点検に使う
function decideOld(n,reads,opt,Wt,T){
  Wt=Wt||W; T=T||TH; opt=opt||{};
  let prevT=-1, prevM=lower3(opt.start); const endM=lower3(opt.end);
  const res=Array.from({length:n},()=>({}));
  for(let i=0;i<n;i++){ ['arr','dep','meter'].forEach(f=>{ const list=reads[i+'_'+f]; if(!list) return; const isM=f==='meter';
      const sc={};
      for(const c of list){ let v=isM?asMeter(c.t,c.m):asTime(c.t,c.m); if(!v) continue; const w=Wt[(isM?'M':'T')+c.s]||0; if(!w) continue;
        if(!isM&&v.length===3&&prevT>=0&&mins(v)<prevT){ const v2='1'+v; if(asTime(v2,1)&&mins(v2)>=prevT) v=v2; }
        sc[v]=(sc[v]||0)+w; }
      let cand=Object.entries(sc).sort((a,b)=>b[1]-a[1]);
      if(!isM) cand=cand.filter(([v])=>mins(v)>=prevT);
      else { if(prevM!=null) cand=cand.filter(([v])=>((+v-prevM+1000)%1000)<=300); if(prevM!=null&&endM!=null) cand=cand.filter(([v])=>((+v-prevM+1000)%1000)<=((endM-prevM+1000)%1000)); }
      if(!cand.length) return;
      const [v,s]=cand[0], s2=cand[1]?cand[1][1]:0, th=isM?T.m:T.t;
      let tier=''; if(s>=th.blue&&s-s2>=th.gap) tier='blue'; else if(s>=th.yel) tier='yellow'; if(!tier) return;
      res[i][f]={v:isM?v:v.slice(0,-2)+':'+v.slice(-2),tier,score:+s.toFixed(1)};
      if(tier==='blue'){ if(isM) prevM=+v; else prevT=mins(v); } }); }
  return res;
}
// 始業・終業メーターと走行粁を読む。終業−始業＝走行粁 になる組み合わせが見つかれば両方を青、
// 見つからなくても終業＞始業で差が1000km未満なら黄、それ以外は入れない
async function readHead(head,onProg){
  if(!head) return null;
  const cells=[[head.start,[6,7]],[head.end,[6,7]],[head.total,[1,2,3,4]]].map(([cv,lens])=>({lens,V:cv?[cv,enh(cv),pad(cv,0.3)]:[],got:MODELS.map(()=>[])}));
  await eachModel(onProg,async(E,m)=>{
    for(const c of cells) for(const v of c.V){ let r=null; try{ r=await recBoth(E,v); }catch(e){}
      if(!r) continue; for(const x of [r.free,r.digit]){ if(x.m<0.5) continue; const d=half(x.t).replace(/\D/g,''); if(c.lens.includes(d.length)) c.got[m].push(d); } } });
  const vote=c=>{ const sc={}; for(const d of [].concat(...c.got)) sc[d]=(sc[d]||0)+1; return Object.entries(sc).sort((a,b)=>b[1]-a[1]).slice(0,4); };
  const S=vote(cells[0]), En=vote(cells[1]), T=vote(cells[2]);
  let best=null;
  for(const [sv,ss] of S) for(const [ev,es] of En){ const diff=+ev-+sv; if(!(diff>0&&diff<1000)) continue;
    const tm=T.find(([tv])=>+tv===diff); const sc=ss+es+(tm?tm[1]+20:0);
    if(!best||sc>best.sc) best={sc,start:sv,end:ev,checked:!!tm}; }
  if(!best) return {S,En,T};
  const tier=best.checked?'blue':'yellow';
  return {start:{v:best.start,tier},end:{v:best.end,tier},total:best.end-best.start,checked:best.checked,S,En,T};
}
// 店名を読む：3つのモデル × 2種類の切り抜きで、全文字のまま読んだ結果を集める
async function readPlaceRaw(rows,onProg){
  let done=0; const total=rows.length*MODELS.length*2;
  const Vs=rows.map(r=>{ const cv=r.ocr.place&&r.ocr.place.A; return [['A',cv],['Ae',enh(cv)]]; });
  const slot=rows.map(()=>MODELS.map(()=>[]));
  await eachModel(onProg,async(E,m)=>{
    for(let j=0;j<rows.length;j++) for(const [vn,v] of Vs[j]){ let x=null; try{ x=await recBoth(E,v); }catch(e){} if(x) slot[j][m].push({s:E.k+vn,t:x.free.t,m:x.free.m}); done++; onProg&&onProg({phase:'place',done,total}); } });
  return slot.map(l=>[].concat(...l));
}
// 店名を決める：前に入れた場所の中から、読んだ文字に一番似ているものを選ぶ（似ている度合い＝共通する文字の並びの長さ）。
// 2つ以上の読みが同じで、前の場所より長い（例：「KFK甲府南」に対して「KFK甲府南工場」）ときは、読んだ文字をそのまま黄色で出す。
// 前に入れた場所が1つも無いときは、2つ以上の読みが一致した文字を黄色で出す。
const SIMP={'车':'車','库':'庫','场':'場','图':'図','认':'認','从':'従','师':'師','饮':'飲','腾':'騰','韩':'韓','门':'門','国':'国'};
const normP=s=>String(s||'').normalize('NFKC').toUpperCase().replace(/./g,c=>SIMP[c]||c).replace(/[\s・.,，、。:;~？?!！\-‐ー－+＋()（）'"`/|]/g,'');
const lcsLen=(a,b)=>{ let p=new Array(b.length+1).fill(0); for(let i=1;i<=a.length;i++){ const c=[0]; for(let j=1;j<=b.length;j++) c[j]=a[i-1]===b[j-1]?p[j-1]+1:Math.max(p[j],c[j-1]); p=c; } return p[b.length]; };
const simL=(a,b)=>{ a=normP(a); b=normP(b); if(!a||!b) return 0; return 2*lcsLen(a,b)/(a.length+b.length); };
const TP={blue:0.45,gap:0.1,yel:0.2};
function pickPlace(reads,known){
  const R=reads.filter(x=>x.m>=0.5&&normP(x.t)); if(!R.length) return null;
  const raw={}; R.forEach(x=>{ const k=normP(x.t); raw[k]=(raw[k]||0)+1; });
  const cons=Object.entries(raw).filter(([k,c])=>c>=2).sort((a,b)=>b[1]-a[1]).map(([k])=>k);
  if(!known.length) return cons.length?{name:cons[0],tier:'yellow',raw:true}:null;
  const sc=known.map(k=>({name:k,s:R.reduce((a,x)=>a+simL(x.t,k),0)/R.length})).sort((a,b)=>b.s-a.s);
  const b=sc[0], s2=sc[1]?sc[1].s:0;
  for(const c of cons){ if(known.some(k=>normP(k)===c)) continue; const sRaw=R.reduce((a,x)=>a+simL(x.t,c),0)/R.length;
    if(c.length>normP(b.name).length&&simL(c,b.name)>=0.6&&sRaw>b.s+0.05) return {name:c,tier:'yellow',raw:true}; }
  const tier=(b.s>=TP.blue&&b.s-s2>=TP.gap)?'blue':(b.s>=TP.yel?'yellow':''); return tier?{name:b.name,tier,raw:false}:null;
}
async function readPlaces(rows,known,onProg){ const raw=await readPlaceRaw(rows,onProg); return raw.map(list=>pickPlace(list,known||[])); }
window.NippoOCR={load,closeModels,readRows,readHead,readPlaceRaw,readPlaces,pickPlace,decide,decideOld,W,TH};
})();
