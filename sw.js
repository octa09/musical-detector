const CACHE='notas-v12',SHARE='notas-share';
const ASSETS=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./ai-worker.js','./asr-worker.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting()});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k!==SHARE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  const req=e.request,u=new URL(req.url);
  // Audio compartido desde otra app (Android): se guarda y se abre la app
  if(req.method==='POST'&&u.pathname.endsWith('/share')){
    e.respondWith((async()=>{
      try{const fd=await req.formData();const f=fd.get('audio');
        const c=await caches.open(SHARE);
        if(f&&typeof f!=='string'&&f.size){await c.put('./shared-audio',new Response(f,{headers:{'x-name':encodeURIComponent(f.name||'audio compartido')}}))}
        else{const link={title:fd.get('title')||'',text:fd.get('text')||'',url:fd.get('url')||''};await c.put('./shared-link',new Response(JSON.stringify(link),{headers:{'content-type':'application/json'}}))}}catch(err){}
      return Response.redirect(new URL('./?shared=1',self.registration.scope).href,303);
    })());
    return;
  }
  if(req.method!=='GET')return;
  // Red primero (para recibir actualizaciones), caché si no hay conexión
  e.respondWith(fetch(req).then(r=>{
    if(r.ok&&(u.origin===location.origin||/fonts\.(googleapis|gstatic)\.com$/.test(u.hostname))){const cp=r.clone();caches.open(CACHE).then(c=>c.put(req,cp))}
    return r;
  }).catch(()=>caches.match(req,{ignoreSearch:true}).then(r=>r||caches.match('./index.html'))));
});
