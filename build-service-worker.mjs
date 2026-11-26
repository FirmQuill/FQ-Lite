// Asset integrity is separate from the normalized agreement-content hash.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=path.dirname(fileURLToPath(import.meta.url));
const files=["terms.mjs","terms-ui.mjs","terms-entry.mjs","terms.css","index.html","mark.svg","headquarters.png","app.css","app.mjs","core.mjs","desk-core.mjs","warehouse-desk.mjs","desk-views.mjs","planning-core.mjs","planning-views.mjs","views.mjs","sample.mjs","vault.mjs","interop.mjs","payroll-rules.mjs","manual-payroll.mjs","manual-payroll-ui.mjs","terms.json","privacy.html","privacy.css","consent.mjs","LICENSE","THIRD-PARTY-NOTICES.md"];
const digest=b=>createHash('sha256').update(b).digest('hex');
const hashes=Object.fromEntries(files.map(file=>{let bytes=fs.readFileSync(path.join(root,file));return [file,digest(bytes)];}));
const version=digest(JSON.stringify(hashes)).slice(0,20);
const sw=path.join(root,'sw.js');let text=fs.readFileSync(sw,'utf8');
const cachePattern=/const cacheName=prefix\+'[^']+';/;
if(!cachePattern.test(text))throw Error('Service-worker cache declaration is missing');
text=text.replace(cachePattern,"const cacheName=prefix+'"+version+"';").replace(/const shell=.*;/,'const shell='+JSON.stringify(files)+';');
if(process.argv.includes('--check')){if(text!==fs.readFileSync(sw,'utf8'))throw Error('Service-worker inventory is stale');}else fs.writeFileSync(sw,text);
console.log('FQ-Lite asset inventory '+version);
