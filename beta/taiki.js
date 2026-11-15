// 待機アラーム：前のトラックが動き出したら知らせる（見張りの計算だけ。画面は taiki.html）
// 乗用車の「先行車発進お知らせ（告知）機能」と同じ考え方で動かす（ホンダ・トヨタの取扱説明書で確かめた仕組み）：
// ・自分の車が止まっているあいだだけ見張る。自分が動き出したら見張りを休み、止まって3秒たったら自動でまた見張る
//   （止まっているかは、枠の中の前の車が3秒間ほとんど変わらないことで判断する。隣を車や人が動いていても見張れるように）
// ・前の車が「離れていく」ことを見つけたら知らせる（車はレーダーやカメラで距離を測るが、スマホにはないので、
//   枠の中の前の車の後ろ姿が「小さくなっていく」ことで、離れていくと判断する）
// ・知らせているあいだに自分の車が動き出したら、自動で音を止める
// 人が前を横切る・ライトが当たる・明るさが変わる：形は変わっても「小さくなる」動きではないので鳴らさない
// 自分の車が前に詰める：前の車の後ろ姿が「大きくなる」ので、前が離れたのとは区別できる
(function(){
  const W=128, H=72;
  function stats(g,box){ let s=0,s2=0,n=0; for(let y=box[1];y<box[3];y++) for(let x=box[0];x<box[2];x++){ const v=g[y*W+x]; s+=v; s2+=v*v; n++; } const m=s/n; return {m,sd:Math.sqrt(Math.max(4,s2/n-m*m))}; }
  function sample(g,x,y){ const xi=Math.max(0,Math.min(W-2,Math.floor(x))), yi=Math.max(0,Math.min(H-2,Math.floor(y))), fx=Math.min(1,Math.max(0,x-xi)), fy=Math.min(1,Math.max(0,y-yi)); const i=yi*W+xi; return (g[i]*(1-fx)+g[i+1]*fx)*(1-fy)+(g[i+W]*(1-fx)+g[i+W+1]*fx)*fy; }
  // 基準 R を倍率 s で縮めた（s<1）／広げた（s>1）ものと、今の F の「形の違い」（枠の中、明るさは差し引く）
  function diffS(R,F,box,s){ const a=stats(R,box), b=stats(F,box), cx=(box[0]+box[2])/2, cy=(box[1]+box[3])/2; let t=0,n=0;
    for(let y=box[1];y<box[3];y++) for(let x=box[0];x<box[2];x++){ const r=s===1?R[y*W+x]:sample(R,cx+(x-cx)/s,cy+(y-cy)/s); t+=Math.abs((r-a.m)/a.sd-(F[y*W+x]-b.m)/b.sd); n++; } return t/n; }
  function diff(R,F,box){ return diffS(R,F,box,1); }
  // 前の車の後ろ姿が、基準からどれだけ縮んだ／広がったか。一番よく重なる倍率を探す（はっきりしなければ1）
  // 1秒前の映像と比べるので、倍率は細かく探す（離れていく車は1秒で数％ずつ小さくなる）
  const SC=[0.86,0.9,0.93,0.95,0.97,0.98,0.99,1,1.01,1.02,1.03,1.05,1.07,1.1,1.15];
  function scale(R,F,box){ const d1=diffS(R,F,box,1); let best=1,bd=d1; for(const s of SC){ if(s===1) continue; const d=diffS(R,F,box,s); if(d<bd){ bd=d; best=s; } } return {s:bd<d1*0.9?best:1,d1,gain:d1-bd}; }
  // 枠の外の下の方（道路やまわり）が、ひとつ前の映像からどれだけ変わったか。自分の車が動くと大きくなる
  function around(P,F,box){ let t=0,n=0; for(let y=Math.floor(H*0.4);y<H;y++) for(let x=0;x<W;x++){ if(x>=box[0]&&x<box[2]&&y>=box[1]&&y<box[3]) continue; t+=Math.abs(P[y*W+x]-F[y*W+x]); n++; } return n?t/n:0; }
  function toGray(ctx){ const d=ctx.getImageData(0,0,W,H).data, g=new Uint8Array(W*H); for(let i=0;i<W*H;i++) g[i]=(d[i*4]*77+d[i*4+1]*150+d[i*4+2]*29)>>8; return g; }
  // 見張り役。step() を0.5秒ごとに呼ぶ。
  // state：'wait'＝自分の車が動いている／止まったばかり（見張りを休む）、'watch'＝見張り中、'alarm'＝知らせている
  // th＝形の違いの目安、hold＝「離れていく」が何回続いたら鳴らすか、lag＝何秒前の映像と比べるか
  // hold2＝縮み方がはっきりしなくても大きな変化がこの回数続いたら鳴らす、approach＝これより広がったら「自分が詰めている」
  // settle＝止まってから見張りを始めるまでの秒数（ego＝まわりの変化は、画面に出すだけで判断には使わない）
  function Watcher(opt){ this.o=Object.assign({th:0.25,hold:3,hold2:8,lag:8,approach:1.02,egoTh:7,settle:3},opt||{}); this.reset(); }
  Watcher.prototype.reset=function(){ this.state='wait'; this.buf=[]; this.ref=null; this.cnt=0; this.cnt2=0; this.sh=[]; this.why=''; this.selfCnt=0; this.egoCnt=0; this.last=0; this.lastS=1; this.ego=0; this.prev=null; this.still=null; this.event=''; this.hist=[]; };
  Watcher.prototype.step=function(g,t,rel){ const box=[Math.floor(rel[0]*W),Math.floor(rel[1]*H),Math.ceil(rel[2]*W),Math.ceil(rel[3]*H)];
    this.event='';
    const ego=this.prev?around(this.prev,g,box):0; this.prev=g; this.ego=ego;
    this.hist.push({t,g}); while(this.hist.length&&this.hist[0].t<t-1.2) this.hist.shift();
    const p=this.hist[0];
    if(this.state==='alarm'){
      // 1秒前と比べて枠の中が広がっている（自分が前に進んでいる）ことが2回続いたら、発進したとみなして音を止める
      const sc=p&&p.g!==g?scale(p.g,g,box).s:1;
      this.egoCnt=sc>=this.o.approach?this.egoCnt+1:0;
      if(this.egoCnt>=2){ this.state='wait'; this.still=null; this.egoCnt=0; this.event='drove'; }
      return this.out(); }
    if(this.state==='wait'){
      // 枠の中（前の車）が1秒前とほとんど変わらない状態が続いたら、自分も前も止まっている → 見張りを始める
      // （まわりの景色は見ない：隣を車や人が動いていても見張りを始められるように）
      const calm=p&&p.g!==g&&diff(p.g,g,box)<this.o.th*0.5;
      if(!calm){ this.still=null; return this.out(); }
      if(this.still==null) this.still=t;
      if(t-this.still>=this.o.settle){ this.state='watch'; this.buf=[]; this.cnt=0; this.cnt2=0; this.sh=[]; this.selfCnt=0; this.last=0; this.lastS=1; this.event='armed'; }
      return this.out(); }
    this.buf.push({t,g}); while(this.buf.length&&this.buf[0].t<t-this.o.lag-4) this.buf.shift();
    if(this.cnt===0&&this.cnt2===0&&this.selfCnt===0){ const c=this.buf.filter(x=>x.t<=t-this.o.lag); this.ref=c.length?c[c.length-1].g:this.buf[0].g; }
    if(this.ref===g){ this.last=0; return this.out(); }
    const d=diff(this.ref,g,box); this.last=d;
    // 1秒前と比べて、枠の中が縮んでいる（前が離れていく）か、広がっている（自分が詰めている）か
    let s=1; if(d>this.o.th&&p&&p.g!==g) s=scale(p.g,g,box).s;
    this.lastS=s; this.sh.push(s); if(this.sh.length>4) this.sh.shift();
    const dn=this.sh.filter(x=>x<0.995).length, up=this.sh.filter(x=>x>1.005).length;
    const receding=dn>=2&&up===0, approaching=up>=2&&dn===0;
    if(d>this.o.th&&receding) this.cnt++; else if(d<=this.o.th) this.cnt=0;
    if(d>this.o.th*2) this.cnt2++; else this.cnt2=0;   // 縮み方がはっきりしなくても、大きく変わった状態が長く続いたら知らせる（見落とさないため）
    if(d>this.o.th&&approaching) this.selfCnt++; else this.selfCnt=0;
    if(this.selfCnt>=2){ this.state='wait'; this.still=null; this.selfCnt=0; this.cnt=0; this.cnt2=0; this.event='self'; return this.out(); }   // 自分が前に詰めた：鳴らさずに休む
    if(this.cnt>=this.o.hold||this.cnt2>=this.o.hold2){ this.state='alarm'; this.event='alarm'; this.why=this.cnt>=this.o.hold?'離れていく':'大きな変化'; }
    return this.out(); };
  Watcher.prototype.out=function(){ return {state:this.state,why:this.why,d:this.last,s:this.lastS,ego:this.ego,alarm:this.state==='alarm',event:this.event,ready:this.state==='watch'}; };
  // 手で音を止めたとき：止まったまま次の見張りに戻す（止まって3秒で自動的にまた見張る）
  Watcher.prototype.silence=function(){ this.state='wait'; this.still=null; this.cnt=0; this.cnt2=0; this.sh=[]; this.selfCnt=0; };
  window.NippoTaiki={W,H,diff,diffS,scale,around,toGray,Watcher};
})();
