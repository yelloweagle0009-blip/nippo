// 運行日報：日報の写真から「書いてある行」「実車の行」を見つけ、行ごとの切り抜きを作る。
// すべてスマホの中だけで計算する（外へは何も送らない）。
// 数字そのものの自動読み取りは、2枚の試験で精度が足りなかったので入れていない。
(function(){
'use strict';
// 基準にした日報写真（横1477×縦1108）での、表のかたまりの四隅
const REF=[[98,281],[1427,300],[1449,841],[90,1005]];
const RW=1477, RH=1108;
const SP=(1004-306)/32; // 行（着・発の1段）の高さ

function adaptiveInv(g,w,h,block,C){ // OpenCV adaptiveThreshold(MEAN_C, BINARY_INV) 相当
  const I=new Float64Array((w+1)*(h+1));
  for(let y=0;y<h;y++){ let s=0; for(let x=0;x<w;x++){ s+=g[y*w+x]; I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+s; } }
  const r=block>>1, out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){ const y0=Math.max(0,y-r), y1=Math.min(h-1,y+r);
    for(let x=0;x<w;x++){ const x0=Math.max(0,x-r), x1=Math.min(w-1,x+r);
      const s=I[(y1+1)*(w+1)+x1+1]-I[y0*(w+1)+x1+1]-I[(y1+1)*(w+1)+x0]+I[y0*(w+1)+x0];
      const m=s/((y1-y0+1)*(x1-x0+1)); out[y*w+x]=g[y*w+x]<=m-C?255:0; } }
  return out;
}
// 2値画像の横方向・縦方向の収縮／膨張（長さ k の棒）
function erodeH(b,w,h,k){ const o=new Uint8Array(w*h), a=k>>1; for(let y=0;y<h;y++){ const row=y*w; const P=new Int32Array(w+1); for(let x=0;x<w;x++) P[x+1]=P[x]+(b[row+x]?1:0);
  for(let x=0;x<w;x++){ const lo=x-a, hi=lo+k-1; const L=Math.max(0,lo), H=Math.min(w-1,hi); const out=(L-lo)+(hi-H); if(P[H+1]-P[L]+out===k) o[row+x]=255; } } return o; }
function dilateH(b,w,h,k){ const o=new Uint8Array(w*h), a=k>>1; for(let y=0;y<h;y++){ const row=y*w; const P=new Int32Array(w+1); for(let x=0;x<w;x++) P[x+1]=P[x]+(b[row+x]?1:0);
  for(let x=0;x<w;x++){ const lo=x-(k-1-a), hi=x+a; const L=Math.max(0,lo), H=Math.min(w-1,hi); if(P[H+1]-P[L]>0) o[row+x]=255; } } return o; }
function erodeV(b,w,h,k){ const o=new Uint8Array(w*h), a=k>>1, P=new Int32Array(h+1); for(let x=0;x<w;x++){ for(let y=0;y<h;y++) P[y+1]=P[y]+(b[y*w+x]?1:0);
  for(let y=0;y<h;y++){ const lo=y-a, hi=lo+k-1; const L=Math.max(0,lo), H=Math.min(h-1,hi); const out=(L-lo)+(hi-H); if(P[H+1]-P[L]+out===k) o[y*w+x]=255; } } return o; }
function dilateV(b,w,h,k){ const o=new Uint8Array(w*h), a=k>>1, P=new Int32Array(h+1); for(let x=0;x<w;x++){ for(let y=0;y<h;y++) P[y+1]=P[y]+(b[y*w+x]?1:0);
  for(let y=0;y<h;y++){ const lo=y-(k-1-a), hi=y+a; const L=Math.max(0,lo), H=Math.min(h-1,hi); if(P[H+1]-P[L]>0) o[y*w+x]=255; } } return o; }
const openH=(b,w,h,k)=>dilateH(erodeH(b,w,h,k),w,h,k);
const openV=(b,w,h,k)=>dilateV(erodeV(b,w,h,k),w,h,k);
const dilateSq=(b,w,h,k)=>dilateV(dilateH(b,w,h,k),w,h,k);
function or(a,b){ const o=new Uint8Array(a.length); for(let i=0;i<a.length;i++) o[i]=(a[i]|b[i])?255:0; return o; }

// いちばん大きいかたまり（表）の四隅
function tableCorners(m,w,h){
  const lab=new Int32Array(w*h), stack=new Int32Array(w*h); let best=0,bestN=0,cur=0;
  for(let i=0;i<w*h;i++){ if(!m[i]||lab[i]) continue; cur++; let sp=0,n=0; stack[sp++]=i; lab[i]=cur;
    while(sp){ const p=stack[--sp]; n++; const x=p%w, y=(p-x)/w;
      for(let dy=-1;dy<=1;dy++){ const yy=y+dy; if(yy<0||yy>=h) continue; for(let dx=-1;dx<=1;dx++){ const xx=x+dx; if(xx<0||xx>=w) continue; const q=yy*w+xx; if(m[q]&&!lab[q]){ lab[q]=cur; stack[sp++]=q; } } } }
    if(n>bestN){ bestN=n; best=cur; } }
  let c=[null,null,null,null], v=[Infinity,-Infinity,-Infinity,Infinity];
  for(let i=0;i<w*h;i++){ if(lab[i]!==best) continue; const x=i%w, y=(i-x)/w;
    if(x+y<v[0]){v[0]=x+y;c[0]=[x,y];} if(x-y>v[1]){v[1]=x-y;c[1]=[x,y];} if(x+y>v[2]){v[2]=x+y;c[2]=[x,y];} if(x-y<v[3]){v[3]=x-y;c[3]=[x,y];} }
  return {c,area:bestN};
}
// 4点の対応から射影変換（src→dst）を求める
function perspective(src,dst){
  const A=[],B=[]; for(let i=0;i<4;i++){ const [x,y]=src[i],[u,v]=dst[i];
    A.push([x,y,1,0,0,0,-u*x,-u*y]); B.push(u); A.push([0,0,0,x,y,1,-v*x,-v*y]); B.push(v); }
  for(let i=0;i<8;i++){ let p=i; for(let r=i+1;r<8;r++) if(Math.abs(A[r][i])>Math.abs(A[p][i])) p=r; [A[i],A[p]]=[A[p],A[i]]; [B[i],B[p]]=[B[p],B[i]];
    for(let r=0;r<8;r++){ if(r===i) continue; const f=A[r][i]/A[i][i]; for(let k=i;k<8;k++) A[r][k]-=f*A[i][k]; B[r]-=f*B[i]; } }
  const h=B.map((b,i)=>b/A[i][i]); return [h[0],h[1],h[2],h[3],h[4],h[5],h[6],h[7],1];
}
const apply=(H,x,y)=>{ const w=H[6]*x+H[7]*y+H[8]; return [(H[0]*x+H[1]*y+H[2])/w,(H[3]*x+H[4]*y+H[5])/w]; };
function warpGray(g,w,h,Hinv,W,Hh){ // 基準の座標 → 写真の座標を引いて、線形補間で写す
  const o=new Uint8Array(W*Hh);
  for(let y=0;y<Hh;y++) for(let x=0;x<W;x++){ const [u,v]=apply(Hinv,x,y);
    if(u<0||v<0||u>w-1.001||v>h-1.001){ o[y*W+x]=255; continue; }
    const x0=u|0,y0=v|0,fx=u-x0,fy=v-y0,i=y0*w+x0;
    o[y*W+x]=Math.round(g[i]*(1-fx)*(1-fy)+g[i+1]*fx*(1-fy)+g[i+w]*(1-fx)*fy+g[i+w+1]*fx*fy); }
  return o;
}
// 時刻欄の横線を、表の下端（16行目の下）から上へ1本ずつたどる
function trackRows(wh,W,Hh,x0=100,x1=235){
  const prof=new Float64Array(Hh); for(let y=0;y<Hh;y++){ let s=0; for(let x=x0;x<x1;x++) if(wh[y*W+x]) s++; prof[y]=s; }
  const cand=[]; for(let y=2;y<Hh-2;y++){ const m=Math.max(prof[y-2],prof[y-1],prof[y],prof[y+1],prof[y+2]); if(prof[y]>=(x1-x0)*0.35&&prof[y]===m) cand.push(y); }
  const ok=y=>cand.some(c=>Math.abs(c-y)<=4);
  const SC=[0.9,0.95,1,1.05,1.1,1.15]; // 写真のたわみで行の高さが変わる分を許す
  const bots=cand.filter(y=>SC.some(f=>{ const sp=SP*f; let s=0; for(let k=1;k<=6;k++) s+=ok(y-k*sp)?1:0; return s>=5&&!ok(y+sp)&&!ok(y+2*sp); }));
  const found=bots.length>0; const bot=found?Math.max(...bots):1004;
  const ys=[bot]; let scale=1, hits=0;
  for(let i=0;i<32;i++){ const exp=ys[ys.length-1]-SP*scale; const near=cand.filter(y=>Math.abs(y-exp)<=7); let y;
    if(near.length){ y=near.reduce((a,b)=>Math.abs(b-exp)<Math.abs(a-exp)?b:a); scale=0.7*scale+0.3*((ys[ys.length-1]-y)/SP); hits++; } else y=exp;
    ys.push(y); }
  return {ys:ys.reverse(),found,hits};
}

function canvasOf(src,w,h,rot){ // rot: 0/90/180/270（時計回り）
  const c=document.createElement('canvas'); const sw=(rot%180)?h:w, sh=(rot%180)?w:h; c.width=sw; c.height=sh;
  const x=c.getContext('2d'); x.translate(sw/2,sh/2); x.rotate(rot*Math.PI/180); x.drawImage(src,-w/2,-h/2,w,h); return c;
}
function grayOf(c){ const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data, g=new Uint8Array(c.width*c.height);
  for(let i=0,j=0;j<g.length;i+=4,j++) g[j]=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000|0; return g; }

function analyzeOne(hi){ // hi: 向きを決めた写真（キャンバス）
  const w=RW, h=Math.round(hi.height*RW/hi.width);
  const sm=document.createElement('canvas'); sm.width=w; sm.height=h; sm.getContext('2d').drawImage(hi,0,0,w,h);
  const g=grayOf(sm);
  const b=adaptiveInv(g,w,h,31,15);
  const hl=openH(b,w,h,Math.floor(w/25)), vl=openV(b,w,h,Math.floor(h/25));
  const m=dilateSq(or(hl,vl),w,h,5);
  const {c,area}=tableCorners(m,w,h);
  if(!c[0]) return null;
  const Hinv=perspective(REF,c);              // 基準 → 縮小写真
  const wg=warpGray(g,w,h,Hinv,RW,RH);
  const wb=adaptiveInv(wg,RW,RH,31,15);
  const wh=openH(wb,RW,RH,40), wv=openV(wb,RW,RH,30);
  const tr=trackRows(wh,RW,RH);
  const lines=dilateSq(or(wh,wv),RW,RH,3);
  const ink=(x,y)=>wb[y*RW+x]&&!lines[y*RW+x];
  const count=(x0,x1,y0,y1)=>{ let s=0; for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) if(ink(x,y)) s++; return s; };
  const ys=tr.ys;
  const times=[]; for(let j=0;j<32;j++) times.push(count(152,226,Math.trunc(ys[j])+3,Math.trunc(ys[j+1])-3));
  const tsumi=[]; for(let r=0;r<16;r++) tsumi.push(count(482,536,Math.trunc(ys[2*r])+2,Math.trunc(ys[2*r+2])-2));
  const k=hi.width/w; const HinvHi=[Hinv[0]*k,Hinv[1]*k,Hinv[2]*k,Hinv[3]*k,Hinv[4]*k,Hinv[5]*k,Hinv[6],Hinv[7],Hinv[8]];
  return {score:tr.hits+(tr.found?10:0),found:tr.found,hits:tr.hits,ys,times,tsumi,corners:c,area,HinvHi,hi};
}
function crop(hi,H,x0,y0,x1,y1,z){ // 基準座標の範囲を、写真から z 倍で切り抜く
  const W=Math.round((x1-x0)*z), Hh=Math.round((y1-y0)*z);
  const sd=hi.getContext('2d').getImageData(0,0,hi.width,hi.height).data, sw=hi.width, sh=hi.height;
  const c=document.createElement('canvas'); c.width=W; c.height=Hh; const ctx=c.getContext('2d'); const id=ctx.createImageData(W,Hh), o=id.data;
  for(let j=0;j<Hh;j++) for(let i=0;i<W;i++){ const [u,v]=apply(H,x0+i/z,y0+j/z); const p=(j*W+i)*4;
    if(u<0||v<0||u>sw-1.001||v>sh-1.001){ o[p]=o[p+1]=o[p+2]=255; o[p+3]=255; continue; }
    const xa=u|0,ya=v|0,fx=u-xa,fy=v-ya,q=(ya*sw+xa)*4,q2=q+sw*4;
    for(let ch=0;ch<3;ch++) o[p+ch]=sd[q+ch]*(1-fx)*(1-fy)+sd[q+4+ch]*fx*(1-fy)+sd[q2+ch]*(1-fx)*fy+sd[q2+4+ch]*fx*fy;
    o[p+3]=255; }
  ctx.putImageData(id,0,0); return c.toDataURL('image/jpeg',0.82);
}
async function loadImage(file){
  try{ return await createImageBitmap(file,{imageOrientation:'from-image'}); }
  catch(e){ return await new Promise((ok,ng)=>{ const im=new Image(); im.onload=()=>ok(im); im.onerror=ng; im.src=URL.createObjectURL(file); }); }
}
async function analyze(file){
  const img=await loadImage(file);
  const iw=img.width, ih=img.height, s=Math.min(1,2400/Math.max(iw,ih));
  const w=Math.round(iw*s), h=Math.round(ih*s);
  const rots=iw>=ih?[0,180]:[90,270];
  let best=null;
  for(const rot of rots){ const hi=canvasOf(img,w,h,rot); const r=analyzeOne(hi); if(r&&(!best||r.score>best.score)) best=r; }
  if(!best||!best.found||best.hits<20) return {ok:false,debug:best&&{hits:best.hits,found:best.found,corners:best.corners,ys:best.ys.map(v=>Math.round(v))}};
  const {ys,times,tsumi,HinvHi,hi}=best;
  const written=[]; for(let j=0;j<32;j++) if(times[j]>90) written.push(j);
  if(!written.length) return {ok:false,empty:true,debug:{hits:best.hits}};
  const lastRow=Math.floor(written[written.length-1]/2)+1;   // 用紙の行番号（1〜16）
  const rows=[];
  for(let r=2;r<=Math.max(2,lastRow);r++){
    rows.push({paperRow:r, loaded:tsumi[r-1]>100, hasArr:times[2*(r-1)]>90, hasDep:times[2*(r-1)+1]>90,
      img:crop(hi,HinvHi,-100,ys[2*(r-1)]-8,240,ys[2*r]+8,2)});
  }
  const header=crop(hi,HinvHi,525,112,790,238,2);
  return {ok:true,rows,header,debug:{hits:best.hits,written,tsumi:tsumi.map(v=>v>100?1:0),times,ys:ys.map(v=>Math.round(v))}};
}
window.NippoPhoto={analyze};
})();
