const scope=self.registration.scope;
const prefix='fieldledger-lite:'+encodeURIComponent(new URL(scope).pathname)+':';
const cacheName=prefix+'0.1.0-preview.2';
const shell=['index.html','mark.svg','headquarters.png','app.css','app.mjs','core.mjs','views.mjs','sample.mjs','vault.mjs','interop.mjs','payroll-rules.mjs'];
const urls=shell.map(name=>new URL(name,scope).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(cacheName);
  await cache.addAll(urls.map(url=>new Request(url,{cache:'reload'})));
  await self.skipWaiting();
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  for(const name of await caches.keys())if(name.startsWith(prefix)&&name!==cacheName)await caches.delete(name);
  await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
  const req=event.request;if(req.method!=='GET')return;
  const key=req.url===scope?urls[0]:req.url;
  if(!urls.includes(key))return;
  event.respondWith((async()=>{const cache=await caches.open(cacheName);return await cache.match(key)||fetch(req);})());
});



