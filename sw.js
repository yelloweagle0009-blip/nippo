// 運行日報：ページを端末に保存して、電波が無くても開けるようにする
const C='unkou-v2';
const FILES=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','photo.js'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
// 先に新しい版を取りに行き、取れなければ保存しておいた版を出す
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  e.respondWith(fetch(e.request).then(r=>{ if(r.ok&&(e.request.url.startsWith(self.location.origin)||e.request.url.includes('fonts.g'))){ const cp=r.clone(); caches.open(C).then(c=>c.put(e.request,cp)); } return r; })
    .catch(()=>caches.match(e.request).then(m=>m||caches.match('index.html'))));
});
