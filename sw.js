/* BBS Cafe – service worker mínimo: guarda só a "casca" da app; nunca mexe em vídeo/áudio nem noutros sites */
const V="bbs-v1",SHELL=["./","index.html"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL)).catch(()=>{}));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(x=>x!==V).map(x=>caches.delete(x)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
 const r=e.request,u=new URL(r.url);
 if(r.method!=="GET"||u.origin!==location.origin||/\.(m3u8|ts|m4s|mp4|mp3|aac)$/i.test(u.pathname))return;   // streams e outros sites: direto da rede
 e.respondWith(fetch(r).then(res=>{if(res.ok&&(r.mode==="navigate"||/\.(html|png|ico|json|webmanifest)$/i.test(u.pathname))){const c=res.clone();caches.open(V).then(x=>x.put(r,c))}return res}).catch(()=>caches.match(r).then(m=>m||(r.mode==="navigate"?caches.match("index.html"):Response.error()))))});
