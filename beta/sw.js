// 運行日報：ページを端末に保存して、電波が無くても開けるようにする
const C='unkou-v14';
const FILES=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','photo.js?v=14','ocr.js?v=14'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())); });
// 古い版のページだけ消す（数字を読む部品 nippo-ocr-* は残す）
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('unkou-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
const keepable=u=>u.startsWith(self.location.origin)||u.includes('fonts.g')||u.startsWith('https://cdn.jsdelivr.net/npm/onnxruntime-web@');
// 先に新しい版を取りに行き、取れなければ保存しておいた版を出す
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const u=e.request.url;
  if(u.startsWith('https://huggingface.co/')) return; // モデルは ocr.js が自分で保存する
  e.respondWith(fetch(e.request).then(r=>{ if(r.ok&&keepable(u)){ const cp=r.clone(); caches.open(C).then(c=>c.put(e.request,cp)); } return r; })
    .catch(()=>caches.match(e.request).then(m=>m||(u.startsWith(self.location.origin)?caches.match('index.html'):Response.error()))));
});
