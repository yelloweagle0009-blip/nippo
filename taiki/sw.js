// 待機アラーム：ページを端末に保存して、電波が無くても開けるようにする
const C='taiki-v6';
const FILES=['./','manifest.webmanifest','icon-192.png','icon-512.png','../taiki.js?v=7'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('taiki-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const u=e.request.url, mine=u.startsWith(self.location.origin);
  // 先に新しい版を取りに行き、取れなければ保存しておいた版を出す（?from=nippo などが付いていても同じページ）
  e.respondWith(fetch(e.request).then(r=>{ if(r.ok&&mine){ const cp=r.clone(); caches.open(C).then(c=>c.put(e.request,cp)); } return r; })
    .catch(()=>caches.match(e.request,{ignoreSearch:/\/taiki\/(\?|$)/.test(u)}).then(m=>m||(mine?caches.match('./'):Response.error()))));
});
