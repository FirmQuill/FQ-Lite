const scope=self.registration.scope;
const prefix='fieldledger-lite:'+encodeURIComponent(new URL(scope).pathname)+':';
const cacheName=prefix+'df388a31957b3a3bae3e';
const shell=["terms.mjs","terms-ui.mjs","terms-entry.mjs","terms.css","index.html","mark.svg","headquarters.png","app.css","app.mjs","core.mjs","desk-core.mjs","desk-views.mjs","views.mjs","sample.mjs","vault.mjs","interop.mjs","payroll-rules.mjs","terms.json","privacy.html","privacy.css","consent.mjs","LICENSE","THIRD-PARTY-NOTICES.md"];
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
  // Check the published agreement even while an older app shell controls this tab.
  if (event.request.url === new URL('terms.json?current', self.registration.scope).href) return;

  const req=event.request;if(req.method!=='GET')return;
  const url=new URL(req.url); url.hash='';
  const key=url.href===scope?new URL('index.html',scope).href:url.href;
  if(!urls.includes(key))return;
  event.respondWith((async()=>{const cache=await caches.open(cacheName);return await cache.match(key)||fetch(req);})());
});



