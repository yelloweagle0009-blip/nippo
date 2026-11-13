// 運行日報：ページを端末に保存して、電波が無くても開けるようにする
const C='unkou-v29';
const PARTS='nippo-parts-v1';   // 文字を読む部品（/nippo/m/）。アプリを更新しても消さない
const FILES=['./','index.html','manifest.webmanifest','icon-192.png','icon-512.png','photo.js?v=29','ocr.js?v=29','taiki.html','taiki.js?v=1'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(C).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())); });
// 古い版のページだけ消す（部品の nippo-parts-* は残す）
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k.startsWith('unkou-')&&k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const u=e.request.url;
  if(u.startsWith(self.location.origin+'/nippo/m-app/')) return;   // Android版のアプリ：部品はアプリの中から出す（ここでは保存しない）
  // 部品は中身が変わらないので、保存してあればそれを使い、無ければ取ってきて保存する
  if(u.startsWith(self.location.origin+'/nippo/m/')){
    e.respondWith(caches.open(PARTS).then(c=>c.match(u,{ignoreSearch:true}).then(m=>m||fetch(e.request).then(r=>{ if(r.ok) c.put(u.split('?')[0],r.clone()); return r; }))));
    return; }
  const keepable=u.startsWith(self.location.origin)||u.includes('fonts.g');
  // ページは先に新しい版を取りに行き、取れなければ保存しておいた版を出す
  e.respondWith(fetch(e.request).then(r=>{ if(r.ok&&keepable){ const cp=r.clone(); caches.open(C).then(c=>c.put(e.request,cp)); } return r; })
    .catch(()=>caches.match(e.request).then(m=>m||(u.startsWith(self.location.origin)?caches.match('index.html'):Response.error()))));
});
