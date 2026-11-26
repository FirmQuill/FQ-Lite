import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve,extname} from 'node:path';
const root=fileURLToPath(new URL('.',import.meta.url));
const allowed=new Set(['index.html','terms.mjs','terms-ui.mjs','terms-entry.mjs','terms.css','mark.svg','headquarters.png','app.css','app.mjs','core.mjs','desk-core.mjs','desk-views.mjs','warehouse-desk.mjs','planning-core.mjs','planning-views.mjs','views.mjs','sample.mjs','vault.mjs','interop.mjs','payroll-rules.mjs','manual-payroll.mjs','manual-payroll-ui.mjs','terms.json','privacy.html','privacy.css','consent.mjs','LICENSE','THIRD-PARTY-NOTICES.md','sw.js']);
export function createLiteServer(){return createServer(async(req,res)=>{
 try{if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname),name=pathname==='/'?'index.html':pathname.slice(1);if(!allowed.has(name)){res.writeHead(404);res.end('Not found');return;}
  const bytes=await readFile(resolve(root,name)),mime=({'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'})[extname(name)]||'text/plain; charset=utf-8';
  res.writeHead(200,{'Content-Type':mime,'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:bytes);
 }catch{res.writeHead(400);res.end('Unable to open this application file.');}
});}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const port=Number(process.env.FIRMQUILL_LITE_PORT||4178);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Choose FIRMQUILL_LITE_PORT from 1 to 65535.');const server=createLiteServer();server.listen(port,'127.0.0.1',()=>console.log('FirmQuill Lite: http://127.0.0.1:'+port+'/ — keep this terminal open.'));}
