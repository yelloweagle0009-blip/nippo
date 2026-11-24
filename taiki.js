// 待機アラーム：前のトラックが動き出したら知らせる（見張りの計算だけ。画面は taiki.html）
// 乗用車の「先行車発進お知らせ（告知）機能」と同じ考え方で動かす（ホンダ・トヨタの取扱説明書で確かめた仕組み）：
// ・自分の車が止まっているあいだだけ見張る。自分が動き出したら見張りを休み、止まって3秒たったら自動でまた見張る
//   （止まっているかは、枠の中の前の車が3秒間ほとんど変わらないことで判断する。隣を車や人が動いていても見張れるように）
// ・前の車が動き出したら知らせる（枠の中の形の変化が続いたとき）。車はレーダーで距離を測るが、スマホにはないので、
//   後ろ姿が「大きくなる」とき（自分が前に詰めている）だけは鳴らさない
// ・知らせているあいだに自分の車が動き出したら、自動で音を止める
// 人が前を横切る・ライトが当たる・明るさが変わる：形は変わっても「小さくなる」動きではないので鳴らさない
// 自分の車が前に詰める：前の車の後ろ姿が「大きくなる」ので、前が離れたのとは区別できる
// v5（2026-11-24）：雨の日、ワイパーが通ったあとに鳴る不具合を直した（大きく変わってすぐ落ち着いたら、比べる相手を今の映像に取り替える）
// v4（2026-11-19）：止まっているのに鳴る不具合を直した
// ・比べる相手（8秒前の映像）に、通り過ぎた人やフォークが写っていると、8秒後に何も動いていないのに鳴った → 落ち着いていた映像だけを比べる相手にする
// ・枠を9つに分け、広い範囲が変わったときだけ数える（人・フォーク・影は一部だけ）。一度変わった区画が元に戻ったら「通り過ぎ」とみなす
(function(){
  const W=128, H=72;
  function stats(g,box){ let s=0,s2=0,n=0; for(let y=box[1];y<box[3];y++) for(let x=box[0];x<box[2];x++){ const v=g[y*W+x]; s+=v; s2+=v*v; n++; } const m=s/n; return {m,sd:Math.sqrt(Math.max(4,s2/n-m*m))}; }
  function sample(g,x,y){ const xi=Math.max(0,Math.min(W-2,Math.floor(x))), yi=Math.max(0,Math.min(H-2,Math.floor(y))), fx=Math.min(1,Math.max(0,x-xi)), fy=Math.min(1,Math.max(0,y-yi)); const i=yi*W+xi; return (g[i]*(1-fx)+g[i+1]*fx)*(1-fy)+(g[i+W]*(1-fx)+g[i+W+1]*fx)*fy; }
  // 基準 R を倍率 s で縮めた（s<1）／広げた（s>1）ものと、今の F の「形の違い」（枠の中、明るさは差し引く）
  function diffS(R,F,box,s){ const a=stats(R,box), b=stats(F,box), cx=(box[0]+box[2])/2, cy=(box[1]+box[3])/2; let t=0,n=0;
    for(let y=box[1];y<box[3];y++) for(let x=box[0];x<box[2];x++){ const r=s===1?R[y*W+x]:sample(R,cx+(x-cx)/s,cy+(y-cy)/s); t+=Math.abs((r-a.m)/a.sd-(F[y*W+x]-b.m)/b.sd); n++; } return t/n; }
  function diff(R,F,box){ return diffS(R,F,box,1); }
  // 枠を縦横3つずつ（9つ）に分けて、それぞれの中だけで明るさを差し引いた「形の違い」を出す。
  // 前の車が離れると、後ろ姿の縁や模様が枠のほぼ全体で動くので、多くの区画が変わる。
  // 人やフォークリフトが横切る・立ち止まる、影がかかるときは、一部の区画しか変わらない（影は区画の中で一様に暗くなるだけなので、区画ごとに差し引くと消える）。
  // 模様がほとんど無い区画（のっぺりした荷台の真ん中など）は、ざらつきを拾うだけなので数えない
  const N3=3, FLAT=6;
  function cells(R,F,box){ const out=[]; const bw=(box[2]-box[0])/N3, bh=(box[3]-box[1])/N3;
    for(let j=0;j<N3;j++) for(let i=0;i<N3;i++){ const c=[Math.floor(box[0]+i*bw),Math.floor(box[1]+j*bh),Math.floor(box[0]+(i+1)*bw),Math.floor(box[1]+(j+1)*bh)];
      if(c[2]-c[0]<2||c[3]-c[1]<2){ out.push(null); continue; }
      const a=stats(R,c), b=stats(F,c); if(a.sd<FLAT&&b.sd<FLAT){ out.push(null); continue; }
      const sa=Math.max(a.sd,FLAT), sb=Math.max(b.sd,FLAT); let t=0,n=0;
      for(let y=c[1];y<c[3];y++) for(let x=c[0];x<c[2];x++){ t+=Math.abs((R[y*W+x]-a.m)/sa-(F[y*W+x]-b.m)/sb); n++; }
      out.push(t/n); }
    return out; }
  // 変わった区画の割合（模様のある区画のうち）。模様のある区画が3つ未満なら判断できないので1（これまでどおり枠全体で判断）
  function spread(R,F,box,th){ const c=cells(R,F,box).filter(v=>v!=null); if(c.length<3) return 1; return c.filter(v=>v>th).length/c.length; }
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
  // approach＝これより広がったら「自分が詰めている」（鳴らさない）
  // settle＝止まってから見張りを始めるまでの秒数（ego＝まわりの変化は、画面に出すだけで判断には使わない）
  function Watcher(opt){ this.o=Object.assign({th:0.25,hold:4,lag:8,approach:1.02,egoTh:7,settle:3,spread:0.6,cellK:0.6},opt||{}); this.reset(); }
  Watcher.prototype.reset=function(){ this.state='wait'; this.buf=[]; this.ref=null; this.cnt=0; this.cnt2=0; this.sh=[]; this.why=''; this.selfCnt=0; this.egoCnt=0; this.last=0; this.lastS=1; this.ego=0; this.prev=null; this.still=null; this.event=''; this.hist=[]; this.lastSp=0; this.peak=0; this.seen=[]; this.passCnt=0; this.jumpT=null; this.calmN=0; };
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
      if(t-this.still>=this.o.settle){ this.state='watch'; this.buf=[]; this.ref=null; this.seen=[]; this.cnt=0; this.cnt2=0; this.sh=[]; this.selfCnt=0; this.last=0; this.lastS=1; this.jumpT=null; this.calmN=0; this.event='armed'; }
      return this.out(); }
    // 比べる相手（基準）は「8秒前の映像」だが、そのとき前を人やフォークが通っていた映像を基準にすると、
    // 通り過ぎて8秒たったときに「人がいない今の映像」が基準と違って見え、何も動いていないのに鳴ってしまう（2026-11-19に見つけた不具合）。
    // そこで、各映像に「1秒前とほとんど同じだった（落ち着いていた）か」の印を付け、落ち着いていた映像だけを基準に選ぶ
    const step1=p&&p.g!==g?diff(p.g,g,box):0, quiet=step1<this.o.th*0.5;
    // v5（2026-11-24）：雨の日にワイパーで鳴る不具合を直した
    // ワイパーが通ると、ガラスの雨粒がまとめて消えるので、8秒前の映像と「枠いっぱいに違う」状態が8秒続き、前が動いたと勘違いした。
    // ワイパー（人・フォークが前を通るのも同じ）は「1秒のあいだに大きく変わり、すぐまた落ち着く」。
    // 前の車が走り出したときは、動いているあいだずっと変わり続ける。
    // そこで、大きく変わったあと2回続けて落ち着いたら（4秒以内）、そのときの映像を新しい比べる相手にする
    if(step1>=this.o.th*0.6){ if(this.jumpT==null) this.jumpT=t; this.calmN=0; }
    else if(this.jumpT!=null){ this.calmN=step1<this.o.th*0.4?(this.calmN||0)+1:0;
      if(this.calmN>=2){ const ok=t-this.jumpT<=4; this.jumpT=null; this.calmN=0;
        if(ok){ this.buf=[{t,g,quiet:true}]; this.ref=g; this.cnt=0; this.cnt2=0; this.seen=[]; this.sh=[]; this.last=0; this.event='rebase'; return this.out(); } } }
    this.buf.push({t,g,quiet}); while(this.buf.length&&this.buf[0].t<t-this.o.lag-4) this.buf.shift();
    if(this.cnt===0&&this.cnt2===0&&this.selfCnt===0){ const c=this.buf.filter(x=>x.t<=t-this.o.lag&&x.quiet);
      const nr=c.length?c[c.length-1].g:(this.ref||this.buf[0].g);   // 落ち着いた映像が無ければ、前の基準をそのまま使う
      if(nr!==this.ref) this.seen=[]; this.ref=nr; }
    if(this.ref===g){ this.last=0; return this.out(); }
    const d=diff(this.ref,g,box); this.last=d; if(d>this.peak) this.peak=d;
    // 1秒前と比べて、枠の中が縮んでいる（前が離れていく）か、広がっている（自分が詰めている）か
    let s=1; if(d>this.o.th&&p&&p.g!==g) s=scale(p.g,g,box).s;
    this.lastS=s; this.sh.push(s); if(this.sh.length>4) this.sh.shift();
    const dn=this.sh.filter(x=>x<0.995).length, up=this.sh.filter(x=>x>1.005).length;
    const receding=dn>=2&&up===0, approaching=up>=2&&dn===0;
    // 枠のどれだけ広い範囲が変わったか（前の車が離れる：広い／人・フォーク・影：一部だけ）
    // さらに、一度変わった区画が元に戻ったら、何かが前を通り過ぎた（人・フォーク・車）ので、前の車が離れたのではない
    // （離れていく車は、変わった区画が元に戻らない）
    let sp=0, passing=false;
    if(d>this.o.th){ const cv=cells(this.ref,g,box); const inf=cv.filter(v=>v!=null);
      // 区画が「変わった」とみなす目安は枠全体の目安の6割（ゆっくり動き出した車は、枠全体がちょうど目安を越えたころ、各区画はまだ目安の少し下のことが多い）
      const ct=this.o.th*this.o.cellK;
      sp=inf.length<3?1:inf.filter(v=>v>ct).length/inf.length;
      cv.forEach((v,i)=>{ if(v==null) return; if(v>ct) this.seen[i]=1; else if(this.seen[i]&&v<ct*0.5) passing=true; }); }
    else this.seen=[];
    this.lastSp=sp; if(passing){ this.seen=[]; this.passCnt++; }
    const wide=sp>=this.o.spread&&!passing;
    // 形の変化が続いたら知らせる。ただし前の車が「大きくなっている」（自分が前に詰めている）ときは知らせない
    // （本物のドライブレコーダー映像で、ゆっくり動き出す車は「縮み方」がはっきり出にくく、縮んだときだけ鳴らすと遅れたため）
    if(d>this.o.th&&!approaching&&(wide||receding&&!passing)) this.cnt++; else this.cnt=0;   // 一部だけの変化（人・フォーク・影）は数えない（縮んでいく動きがはっきりしていれば数える）
    if(d>this.o.th&&receding) this.cnt2++;
    if(d>this.o.th&&approaching) this.selfCnt++; else this.selfCnt=0;
    if(this.selfCnt>=2){ this.state='wait'; this.still=null; this.selfCnt=0; this.cnt=0; this.cnt2=0; this.event='self'; return this.out(); }   // 自分が前に詰めた：鳴らさずに休む
    if(this.cnt>=this.o.hold){ this.state='alarm'; this.event='alarm'; this.why=this.cnt2>0?'離れていく':'前が動いた'; }
    return this.out(); };
  Watcher.prototype.out=function(){ return {state:this.state,why:this.why,d:this.last,s:this.lastS,sp:this.lastSp,peak:this.peak,ego:this.ego,alarm:this.state==='alarm',event:this.event,ready:this.state==='watch'}; };
  // 手で音を止めたとき：止まったまま次の見張りに戻す（止まって3秒で自動的にまた見張る）
  Watcher.prototype.silence=function(){ this.state='wait'; this.still=null; this.cnt=0; this.cnt2=0; this.sh=[]; this.selfCnt=0; };
  window.NippoTaiki={W,H,diff,diffS,scale,around,toGray,cells,spread,Watcher};
})();
