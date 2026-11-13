// 待機アラーム：前のトラックが動き出したら知らせる（見張りの計算だけ。画面は taiki.html）
// 考え方：見張りを始めたときの「前のトラックの後ろ姿」（枠の中）を覚えておき、
// いまの映像と比べて、明るさの違いを差し引いた「形の違い」が大きい状態が続いたら鳴らす。
// ・人が前を横切る・ライトが一瞬当たる → 短い時間で元に戻るので鳴らない（続いた時間で判断）
// ・日が陰る・夕方になる → 明るさは差し引く。ゆっくりした変化は、8秒前の映像と比べることで拾わない
(function(){
  const W=128, H=72;
  // 枠の中の明るさの平均とばらつき（明るさの違いを差し引くため）
  function stats(g,box){ let s=0,s2=0,n=0; for(let y=box[1];y<box[3];y++) for(let x=box[0];x<box[2];x++){ const v=g[y*W+x]; s+=v; s2+=v*v; n++; } const m=s/n; return {m,sd:Math.sqrt(Math.max(4,s2/n-m*m))}; }
  // 基準と今の「形の違い」：0 ならまったく同じ。前の車が離れていくと大きくなる
  function diff(R,F,box){ const a=stats(R,box), b=stats(F,box); let t=0,n=0;
    for(let y=box[1];y<box[3];y++) for(let x=box[0];x<box[2];x++){ const i=y*W+x; t+=Math.abs((R[i]-a.m)/a.sd-(F[i]-b.m)/b.sd); n++; } return t/n; }
  function toGray(ctx){ const d=ctx.getImageData(0,0,W,H).data, g=new Uint8Array(W*H); for(let i=0;i<W*H;i++) g[i]=(d[i*4]*77+d[i*4+1]*150+d[i*4+2]*29)>>8; return g; }
  // 見張り役。step() を0.5秒ごとに呼ぶ。
  // 前が止まっているあいだは「lag秒前の映像」と比べ続ける（日が陰る・夕方になるなどのゆっくりした変化を拾わないため）。
  // 違いが th を越えたら、その時点の基準を止めたまま比べ続け、hold回続いたら鳴らす。
  function Watcher(opt){ this.o=Object.assign({th:0.25,hold:4,lag:8},opt||{}); this.reset(); }
  Watcher.prototype.reset=function(){ this.buf=[]; this.ref=null; this.cnt=0; this.alarm=false; this.last=0; };
  // rel：枠（0〜1の割合で [左,上,右,下]）
  Watcher.prototype.step=function(g,t,rel){ const box=[Math.floor(rel[0]*W),Math.floor(rel[1]*H),Math.ceil(rel[2]*W),Math.ceil(rel[3]*H)];
    this.buf.push({t,g}); while(this.buf.length&&this.buf[0].t<t-this.o.lag-4) this.buf.shift();
    if(this.cnt===0){ const c=this.buf.filter(x=>x.t<=t-this.o.lag); this.ref=c.length?c[c.length-1].g:this.buf[0].g; }
    if(this.ref===g){ this.last=0; return {d:0,alarm:false,ready:false}; }
    const d=diff(this.ref,g,box); this.last=d;
    if(d>this.o.th) this.cnt++; else this.cnt=0;
    if(this.cnt>=this.o.hold) this.alarm=true;
    return {d,alarm:this.alarm,ready:true}; };
  window.NippoTaiki={W,H,diff,toGray,Watcher};
})();
