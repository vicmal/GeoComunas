/* GeoComunas — Service Worker v1. App shell offline. */
const CACHE='geocomunas-v1';
const SHELL=['index.html','categorias.json','manifest.json','icon.svg',
  'lib/leaflet.js','lib/leaflet.css','lib/proj4.js','js/dxf.js',
  'assets/sello_monagas.png','assets/IMFellEnglish-Regular.woff2','assets/IMFellEnglish-Italic.woff2'];
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET') return;
  // Teselas satelitales: van a IndexedDB (paquetes por sector), no al SW.
  if(u.hostname==='server.arcgisonline.com') return;
  e.respondWith(
    caches.match(e.request,{ignoreSearch:false}).then(hit=>{
      if(hit) return hit;
      return fetch(e.request).then(r=>{
        if(u.origin===location.origin&&r.ok){
          const c=r.clone(); caches.open(CACHE).then(cc=>cc.put(e.request,c));
        }
        return r;
      }).catch(()=>caches.match('index.html'));
    })
  );
});
