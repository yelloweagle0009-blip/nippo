// 運行日報：日報の写真から「書いてある行」「実車の行」を見つけ、行ごとの切り抜きと、数字読み取り用の切り抜きを作る。
// すべてスマホの中だけで計算する（写真は外へ送らない）。
// 位置合わせの手がかり：時刻欄の「着」と「発」を区切る短い横線（16行すべてに印刷されている）。
(function(){
'use strict';
const RATIO=105/43.6;      // 時刻欄（行番号の右〜時間欄の右）の幅 ÷ 1行の高さ
const WORK=1477;           // 処理に使う長い辺の長さ

function grayOf(c){ const d=c.getContext('2d').getImageData(0,0,c.width,c.height).data, g=new Uint8Array(c.width*c.height);
  for(let i=0,j=0;j<g.length;i+=4,j++) g[j]=(d[i]*299+d[i+1]*587+d[i+2]*114)/1000|0; return g; }
function adaptiveInv(g,w,h,block,C){
  const I=new Float64Array((w+1)*(h+1));
  for(let y=0;y<h;y++){ let s=0; for(let x=0;x<w;x++){ s+=g[y*w+x]; I[(y+1)*(w+1)+x+1]=I[y*(w+1)+x+1]+s; } }
  const r=block>>1, out=new Uint8Array(w*h);
  for(let y=0;y<h;y++){ const y0=Math.max(0,y-r), y1=Math.min(h-1,y+r);
    for(let x=0;x<w;x++){ const x0=Math.max(0,x-r), x1=Math.min(w-1,x+r);
      const s=I[(y1+1)*(w+1)+x1+1]-I[y0*(w+1)+x1+1]-I[(y1+1)*(w+1)+x0]+I[y0*(w+1)+x0];
      out[y*w+x]=g[y*w+x]<=s/((y1-y0+1)*(x1-x0+1))-C?255:0; } }
  return out;
}
function erodeH(b,w,h,k){ const o=new Uint8Array(w*h), a=k>>1, P=new Int32Array(w+1); for(let y=0;y<h;y++){ const row=y*w; for(let x=0;x<w;x++) P[x+1]=P[x]+(b[row+x]?1:0);
  for(let x=0;x<w;x++){ const lo=x-a, hi=lo+k-1, L=Math.max(0,lo), H=Math.min(w-1,hi); if(P[H+1]-P[L]+(L-lo)+(hi-H)===k) o[row+x]=255; } } return o; }
function dilateH(b,w,h,k){ const o=new Uint8Array(w*h), a=k>>1, P=new Int32Array(w+1); for(let y=0;y<h;y++){ const row=y*w; for(let x=0;x<w;x++) P[x+1]=P[x]+(b[row+x]?1:0);
  for(let x=0;x<w;x++){ const L=Math.max(0,x-(k-1-a)), H=Math.min(w-1,x+a); if(P[H+1]-P[L]>0) o[row+x]=255; } } return o; }
function erodeV(b,w,h,k){ const o=new Uint8Array(w*h), a=k>>1, P=new Int32Array(h+1); for(let x=0;x<w;x++){ for(let y=0;y<h;y++) P[y+1]=P[y]+(b[y*w+x]?1:0);
  for(let y=0;y<h;y++){ const lo=y-a, hi=lo+k-1, L=Math.max(0,lo), H=Math.min(h-1,hi); if(P[H+1]-P[L]+(L-lo)+(hi-H)===k) o[y*w+x]=255; } } return o; }
function dilateV(b,w,h,k){ const o=new Uint8Array(w*h), a=k>>1, P=new Int32Array(h+1); for(let x=0;x<w;x++){ for(let y=0;y<h;y++) P[y+1]=P[y]+(b[y*w+x]?1:0);
  for(let y=0;y<h;y++){ const L=Math.max(0,y-(k-1-a)), H=Math.min(h-1,y+a); if(P[H+1]-P[L]>0) o[y*w+x]=255; } } return o; }
const openH=(b,w,h,k)=>dilateH(erodeH(b,w,h,k),w,h,k);
const openV=(b,w,h,k)=>dilateV(erodeV(b,w,h,k),w,h,k);
// 8近傍のつながりで番号を振る
function label(m,w,h){
  const lab=new Int32Array(w*h), st=new Int32Array(w*h), comps=[]; let cur=0;
  for(let i=0;i<w*h;i++){ if(!m[i]||lab[i]) continue; cur++; let sp=0,n=0,x0=w,x1=-1,y0=h,y1=-1,sx=0,sy=0; st[sp++]=i; lab[i]=cur;
    while(sp){ const p=st[--sp]; const x=p%w, y=(p-x)/w; n++; sx+=x; sy+=y; if(x<x0)x0=x; if(x>x1)x1=x; if(y<y0)y0=y; if(y>y1)y1=y;
      for(let dy=-1;dy<=1;dy++){ const yy=y+dy; if(yy<0||yy>=h) continue; for(let dx=-1;dx<=1;dx++){ const xx=x+dx; if(xx<0||xx>=w) continue; const q=yy*w+xx; if(m[q]&&!lab[q]){ lab[q]=cur; st[sp++]=q; } } } }
    comps.push({id:cur,n,x0,x1,y0,y1,cx:sx/n,cy:sy/n}); }
  return {lab,comps};
}
function median(a){ if(!a.length) return 0; const s=a.slice().sort((x,y)=>x-y); return s[s.length>>1]; }
// 長い横線から写真の傾き（度）を出す
function skewAngle(hl,w,h){
  const {lab,comps}=label(hl,w,h); const angs=[];
  for(const c of comps){ if(c.x1-c.x0+1<w/6) continue;
    let n=0,sx=0,sy=0,sxx=0,sxy=0;
    for(let y=c.y0;y<=c.y1;y++) for(let x=c.x0;x<=c.x1;x+=2){ if(lab[y*w+x]!==c.id) continue; n++; sx+=x; sy+=y; sxx+=x*x; sxy+=x*y; }
    const den=n*sxx-sx*sx; if(n>10&&den) angs.push(Math.atan((n*sxy-sx*sy)/den)*180/Math.PI); }
  return angs.length?median(angs):0;
}
// 横線のかたまりごとに、横一列に最も多く並んだ部分を線として取り出す
function segments(hl,w,h){
  const {lab,comps}=label(hl,w,h); const S=[];
  for(const c of comps){ const cw=c.x1-c.x0+1; if(cw<w/40) continue;
    let best=-1,br=0; for(let y=c.y0;y<=c.y1;y++){ let s=0; for(let x=c.x0;x<=c.x1;x++) if(lab[y*w+x]===c.id) s++; if(s>best){best=s;br=y;} }
    if(best<0.6*cw) continue;
    let xa=Infinity,xb=-1; for(let y=Math.max(c.y0,br-2);y<=Math.min(c.y1,br+2);y++) for(let x=c.x0;x<=c.x1;x++) if(lab[y*w+x]===c.id){ if(x<xa)xa=x; if(x>xb)xb=x; }
    S.push([xa,xb+1,br]); }
  return S;
}
function pickSeps(S,w,h){
  let best=null;
  for(const [a0,a1] of S){ const L=a1-a0; if(L<w/40||L>w/2.2) continue;
    const grp=S.filter(s=>Math.abs(s[1]-a1)<=Math.max(8,L*0.14)&&Math.abs((s[1]-s[0])-L)<=Math.max(8,L*0.2)); if(grp.length<8) continue;
    const ys=grp.map(s=>s[2]).sort((x,y)=>x-y); const d=median(ys.slice(1).map((v,i)=>v-ys[i]));
    if(!(L/d>=1.9&&L/d<=2.9)||d<h*0.4/16) continue;
    if(!best||grp.length>best.grp.length||(grp.length===best.grp.length&&a1<best.a1)) best={grp,d,a1}; }
  return best;
}
function rotCanvas(src,deg){ // 回転（時計回り、度）。外は白
  const r=deg*Math.PI/180, w=src.width, h=src.height;
  const quarter=Math.abs(deg)%180===90; const W=quarter?h:w, H=quarter?w:h;
  const c=document.createElement('canvas'); c.width=W; c.height=H; const x=c.getContext('2d');
  x.fillStyle='#fff'; x.fillRect(0,0,W,H); x.translate(W/2,H/2); x.rotate(r); x.drawImage(src,-w/2,-h/2); return c;
}
function scaled(src,long){ const k=Math.min(1,long/Math.max(src.width,src.height)); const c=document.createElement('canvas');
  c.width=Math.round(src.width*k); c.height=Math.round(src.height*k); c.getContext('2d').drawImage(src,0,0,c.width,c.height); return c; }

// 1つの向きで、時刻欄の区切り線16本を探す
function locate(work){
  const w=work.width,h=work.height,k=Math.max(15,Math.floor(w/40));
  let g=grayOf(work), b=adaptiveInv(g,w,h,31,15), hl=openH(b,w,h,k);
  const ang=skewAngle(hl,w,h);
  let cv=work;
  if(Math.abs(ang)>0.05){ cv=rotCanvas(work,-ang); g=grayOf(cv); b=adaptiveInv(g,w,h,31,15); hl=openH(b,w,h,k); }
  const S=segments(hl,w,h), p=pickSeps(S,w,h); if(!p) return null;
  const grp=p.grp.slice().sort((a,b)=>a[2]-b[2]), d=p.d;
  const seps=[grp[0]];
  for(const s of grp.slice(1)){ const q0=seps[seps.length-1], gap=s[2]-q0[2], kk=Math.max(1,Math.round(gap/d));
    for(let t=1;t<kk;t++){ const q=seps[seps.length-1]; seps.push([q[0]+(s[0]-q[0])*t/kk,q[1]+(s[1]-q[1])*t/kk,q[2]+gap*t/kk]); }
    seps.push(s); }
  const isSep=(y,x0,x1)=>{ const ww=x1-x0, yi=Math.round(y); if(yi<4||yi>=h-4) return false;
    const colAny=(xa,xb)=>{ xa=Math.max(0,Math.floor(xa)); xb=Math.min(w,Math.floor(xb)); if(xb<=xa) return 0; let n=0; for(let x=xa;x<xb;x++){ for(let yy=yi-4;yy<=yi+4;yy++) if(hl[yy*w+x]){ n++; break; } } return n/(xb-xa); };
    const inside=colAny(x0+0.15*ww,x1-0.1*ww), out=(x1+0.2*ww<w)?colAny(x1+0.15*ww,Math.min(w,x1+0.6*ww)):0;
    return inside>=0.5&&out<0.3; };
  while(seps.length<16){
    const f0=seps[0],f1=seps[1],l0=seps[seps.length-1],l1=seps[seps.length-2];
    const q=[2*l0[0]-l1[0],2*l0[1]-l1[1],l0[2]+(l0[2]-l1[2])], p2=[2*f0[0]-f1[0],2*f0[1]-f1[1],f0[2]-(f1[2]-f0[2])];
    if(isSep(q[2],q[0],q[1])) seps.push(q); else if(isSep(p2[2],p2[0],p2[1])) seps.unshift(p2); else break; }
  if(seps.length!==16) return {fail:true,found:seps.length};
  const vl=openV(b,w,h,Math.max(15,Math.floor(h/40)));
  const lines=dilateV(dilateH(Uint8Array.from(hl,(v,i)=>v|vl[i]),w,h,3),w,h,3);
  return {cv,g,b,hl,lines,seps,d,ang,w,h};
}
function rowsOf(L){
  return L.seps.map(([x0,x1,y],i)=>{ const nb=[i-1,i+1].filter(j=>j>=0&&j<16).map(j=>Math.abs(L.seps[j][2]-y)); const d=nb.reduce((a,b)=>a+b,0)/nb.length; const w=RATIO*d; return {y,d,x1,X0:x1-w,w}; });
}
const X=(r,ref)=>r.X0+(ref-125)/105*r.w;
function frac(L,x0,x1,y0,y1){ const {w,h,b,lines}=L; x0=Math.max(0,Math.floor(x0)); x1=Math.min(w,Math.floor(x1)); y0=Math.max(0,Math.floor(y0)); y1=Math.min(h,Math.floor(y1));
  if(x1<=x0||y1<=y0) return -1; let n=0; for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) if(b[y*w+x]&&!lines[y*w+x]) n++; return n/((x1-x0)*(y1-y0)); }
// 線の画素を白くした灰色の画像から、範囲の中の字のまわりだけを切り抜く（数字読み取り用）
function tightCrop(L,x0,x1,y0,y1,yc,yr,mode){
  const {w,h,b,lines,g}=L; x0=Math.max(0,Math.floor(x0)); x1=Math.min(w,Math.ceil(x1)); y0=Math.max(0,Math.floor(y0)); y1=Math.min(h,Math.ceil(y1));
  const W=x1-x0,H=y1-y0; if(W<4||H<4) return null;
  const m=new Uint8Array(W*H); for(let y=0;y<H;y++) for(let x=0;x<W;x++){ const i=(y+y0)*w+x+x0; m[y*W+x]=(b[i]&&!lines[i])?255:0; }
  const {comps}=label(m,W,H); const minA=Math.max(8,(yr*yr)*0.02);
  let keep=comps.filter(c=>c.n>=minA);
  const inBand=c=>{ const a=Math.max(c.y0+y0,yc-yr/2), b2=Math.min(c.y1+y0,yc+yr/2); return Math.max(0,b2-a+1)/(c.y1-c.y0+1); };
  if(mode==='time'){ keep=keep.filter(c=>inBand(c)>=0.5&&!(c.x1-c.x0<yr*0.18&&c.y1-c.y0>yr*2.4)); }
  else { if(!keep.length) return null; const best=keep.reduce((a,c)=>Math.abs(c.cy+y0-yc)<Math.abs(a.cy+y0-yc)?c:a); keep=keep.filter(c=>Math.abs(c.cy-best.cy)<yr*0.6); }
  if(!keep.length) return null;
  const bx0=Math.max(0,Math.min(...keep.map(c=>c.x0))-4)+x0, bx1=Math.min(W-1,Math.max(...keep.map(c=>c.x1))+4)+x0;
  const by0=Math.max(0,Math.min(...keep.map(c=>c.y0))-4)+y0, by1=Math.min(H-1,Math.max(...keep.map(c=>c.y1))+4)+y0;
  const cw=bx1-bx0+1+12, ch=by1-by0+1+12, c=document.createElement('canvas'); c.width=cw*2; c.height=ch*2;
  const ctx=c.getContext('2d'); const id=ctx.createImageData(cw,ch); const o=id.data;
  for(let y=0;y<ch;y++) for(let x=0;x<cw;x++){ const sx=bx0+x-6, sy=by0+y-6, p=(y*cw+x)*4; let v=255;
    if(sx>=0&&sy>=0&&sx<w&&sy<h){ const i=sy*w+sx; v=lines[i]?255:g[i]; } o[p]=o[p+1]=o[p+2]=v; o[p+3]=255; }
  const t=document.createElement('canvas'); t.width=cw; t.height=ch; t.getContext('2d').putImageData(id,0,0);
  ctx.imageSmoothingQuality='high'; ctx.drawImage(t,0,0,cw*2,ch*2); return c;
}
function rectCrop(src,k,x0,y0,x1,y1){ // 高解像度の回転済み写真から、作業座標の長方形を切り抜く
  const c=document.createElement('canvas'); const W=Math.max(1,Math.round((x1-x0)*k)), H=Math.max(1,Math.round((y1-y0)*k)); c.width=W; c.height=H;
  const x=c.getContext('2d'); x.fillStyle='#fff'; x.fillRect(0,0,W,H); x.drawImage(src,x0*k,y0*k,W,H,0,0,W,H); return c;
}
async function loadImage(file){
  try{ return await createImageBitmap(file,{imageOrientation:'from-image'}); }
  catch(e){ return await new Promise((ok,ng)=>{ const im=new Image(); im.onload=()=>ok(im); im.onerror=ng; im.src=URL.createObjectURL(file); }); }
}
async function analyze(file){
  const img=await loadImage(file);
  const base=document.createElement('canvas'); base.width=img.width; base.height=img.height; base.getContext('2d').drawImage(img,0,0);
  const hiBase=scaled(base,2400);
  let L=null, rot=0;
  for(const r of [0,90,270,180]){ const hi=r?rotCanvas(hiBase,r):hiBase; const work=scaled(hi,WORK); const t=locate(work); if(t&&!t.fail){ L=t; L.hi=hi; rot=r; break; } }
  if(!L) return {ok:false};
  const hiR=Math.abs(L.ang)>0.05?rotCanvas(L.hi,-L.ang):L.hi; const k=hiR.width/L.w;
  const rows=rowsOf(L);
  const times=[], tsumi=[];
  rows.forEach(r=>{ const hb=r.d/2;
    [[r.y-hb,r.y],[r.y,r.y+hb]].forEach(([a,b])=>times.push(frac(L,X(r,152),X(r,226),a+hb*0.14,b-hb*0.14)));
    tsumi.push(frac(L,X(r,482),X(r,536),r.y-hb*0.9,r.y+hb*0.9)); });
  const written=[]; times.forEach((v,j)=>{ if(v>0.06) written.push(j); });
  if(!written.length) return {ok:false,empty:true};
  const lastRow=Math.floor(written[written.length-1]/2)+1;
  const out=[];
  for(let pr=2;pr<=Math.max(2,lastRow);pr++){
    const r=rows[pr-1], hb=r.d/2;
    const view=rectCrop(hiR,k,X(r,-100),r.y-r.d*0.62,X(r,240),r.y+r.d*0.62);
    const cell=(a,b)=>({A:rectCrop(hiR,k,X(r,146),a-hb*0.25,X(r,234),b+hb*0.25), C:tightCrop(L,X(r,146),X(r,234),a-hb*0.6,b+hb*0.6,(a+b)/2,hb,'time')});
    const meterA=rectCrop(hiR,k,X(r,-60),r.y-r.d*0.75,X(r,72),r.y+r.d*0.75);
    const meterC=tightCrop(L,X(r,-60),X(r,64),r.y-r.d*0.75,r.y+r.d*0.75,r.y,hb,'meter');
    out.push({paperRow:pr, loaded:tsumi[pr-1]>0.035, hasArr:times[2*(pr-1)]>0.06, hasDep:times[2*(pr-1)+1]>0.06,
      img:view.toDataURL('image/jpeg',0.82), ocr:{arr:cell(r.y-hb,r.y), dep:cell(r.y,r.y+hb), meter:{A:meterA,C:meterC}}});
  }
  // 始業・終業メーター欄（1行目の位置から見た決まった場所。写っていなければ出さない）
  const r1=rows[0]; let header=null;
  const hx0=X(r1,525), hx1=X(r1,790), hy0=r1.y-4.9*r1.d, hy1=r1.y-2.0*r1.d;
  if(hx0>=0&&hy0>=0&&hx1<=L.w&&hy1<=L.h) header=rectCrop(hiR,k,hx0,hy0,hx1,hy1).toDataURL('image/jpeg',0.82);
  return {ok:true,rows:out,header,debug:{rot,angle:+L.ang.toFixed(2),written,tsumi:tsumi.map(v=>+v.toFixed(3)),times:times.map(v=>+v.toFixed(3))}};
}
window.NippoPhoto={analyze};
})();
