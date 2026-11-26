// 待機アラーム：ページを端末に保存して、電波が無くても開けるようにする
const C='taiki-v9';
const FILES=['./','manifest.webmanifest','icon-192.png','icon-512.png','../taiki.js?v=9'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('taiki-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
// 先に新しい版を取りに行き、取れなければ保存しておいた版を出す（?from=nippo などが付いていても同じページ）
// 電波が弱くて返事が4秒来ないときは、保存しておいた版をすぐ出す（新しい版はうしろで取りに行き、次に開いたときに使う）
// （2026-11-26 点検で直した：前は電波が弱いと、取りに行くのを待ち続けて40秒たっても画面が出なかった）
const WAIT=4000;
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const u=e.request.url, mine=u.startsWith(self.location.origin);
  const net=fetch(e.request).then(r=>{ if(r.ok&&mine){ const cp=r.clone(); return caches.open(C).then(c=>c.put(e.request,cp)).then(()=>r,()=>r); } return r; });
  if(!mine){ e.respondWith(net.catch(()=>Response.error())); return; }
  const saved=()=>caches.match(e.request,{ignoreSearch:/\/taiki\/(\?|$)/.test(u)}).then(m=>m||(e.request.mode==='navigate'?caches.match('./'):undefined));
  e.respondWith((async()=>{
    const timeout=new Promise(r=>setTimeout(()=>r(null),WAIT));
    try{ const r=await Promise.race([net,timeout]); if(r) return r; }
    catch(err){ const m=await saved(); return m||Response.error(); }
    // 4秒たっても返事が無い：保存しておいた版があればそれを出す（無ければ返事を待つ）
    const m=await saved(); if(m){ e.waitUntil(net.catch(()=>{})); return m; }
    try{ return await net; }catch(err){ return Response.error(); } })());
});
