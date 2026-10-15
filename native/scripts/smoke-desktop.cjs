// Synthetic audio only; a disposable profile; no shop writes. Run with Electron.
const { app, dialog, systemPreferences, net } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const proof = fs.mkdtempSync(path.join(os.tmpdir(), 'kirana-desktop-proof-'));
app.setPath('userData', path.join(proof, 'profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
let allow = false, requests = 0;
let fixture = false, uploads = 0;
const fetchNetwork = net.fetch.bind(net);
net.fetch = async (input, options) => {
  if (fixture && String(input).startsWith('https:')) {
    if (String(input).includes('/ai/transcribe')) {
      uploads++;
      if (!new Headers(options.headers).get('content-type')?.includes('multipart/form-data; boundary=')) throw new Error('Audio upload lost its boundary');
      return Response.json({transcript:'open products',provider:'fixture',model:'fixture'});
    }
    return Response.json({message:'Isolated fixture'}, {status:503});
  }
  return fetchNetwork(input, options);
};
let stage = "boot";
setTimeout(() => {console.error("Timeout at",stage,"permission requests",requests); app.exit(1)}, 60000);
dialog.showMessageBox = async () => { requests++; console.log("permission decision",allow); return { response: allow ? 0 : 1 }; };
systemPreferences.askForMediaAccess = async () => true;
const { ready } = require('../desktop/main.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
 const window = await ready;
 const errors = [];
 window.webContents.on('console-message', (...args) => { if (args[1] === 3) errors.push(args[2]); });
 await sleep(4500);
 const boot = await window.webContents.executeJavaScript(`({ url:location.href, secure:isSecureContext, text:document.body.innerText, node:typeof window.require })`);
 if (!boot.text.includes('Artha') || boot.node !== 'undefined' || !boot.secure) throw new Error('App boot/security failed: ' + JSON.stringify(boot));
 fs.writeFileSync(path.join(proof, 'desktop-login.png'), (await window.webContents.capturePage()).toPNG());
 stage = 'denied mic';
 const denied = await window.webContents.executeJavaScript(`navigator.mediaDevices.getUserMedia({ audio:true }).then(s=>{s.getTracks().forEach(t=>t.stop());return 'unexpected-grant'},e=>e.name)`);
 if (denied !== 'NotAllowedError') throw new Error('Expected microphone denial: '+denied);
 console.log('denied',denied);
 stage='allowed mic';
 allow = true;
 const recorded = await window.webContents.executeJavaScript(`(async()=>{const stream=await navigator.mediaDevices.getUserMedia({audio:true});const recorder=new MediaRecorder(stream);const chunks=[];return new Promise((resolve,reject)=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onerror=reject;recorder.onstop=()=>{stream.getTracks().forEach(t=>t.stop());resolve({bytes:new Blob(chunks).size,tracksStopped:stream.getTracks().every(t=>t.readyState==='ended')})};recorder.start();setTimeout(()=>recorder.stop(),600)})})()`);
 if (!recorded.bytes || !recorded.tracksStopped || requests !== 2) throw new Error('Recording lifecycle failed: '+JSON.stringify({recorded,requests}));
 console.log('recorded',recorded);
 stage='API';
 const health = await window.webContents.executeJavaScript(`fetch('/api/health').then(async r=>({status:r.status,body:(await r.text()).slice(0,250)}))`);
 stage='storage';
 const storage = await window.webContents.executeJavaScript(`(async()=>{localStorage.setItem('native-proof','kept');return new Promise((resolve,reject)=>{const r=indexedDB.open('native-proof',1);r.onupgradeneeded=()=>r.result.createObjectStore('rows');r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction('rows','readwrite');tx.objectStore('rows').put({amount:12.34},'sale');tx.oncomplete=()=>{db.close();resolve(true)}}})})()`);
 stage='offline';
 await window.webContents.session.enableNetworkEmulation({offline:true});
 await window.reload(); await sleep(2500);
 const offline = await window.webContents.executeJavaScript(`({text:document.body.innerText,stored:localStorage.getItem('native-proof')})`);
 if (offline.stored !== 'kept' || !offline.text.includes('Artha')) throw new Error('Offline reload failed');
 stage='voice UI';
 fixture = true;
 window.webContents.session.disableNetworkEmulation();
 const until = async expression => {
   for (let n=0;n<100;n++) { if(await window.webContents.executeJavaScript(expression)) return; await sleep(100); }
   throw new Error('UI timed out: '+expression+'\n'+await window.webContents.executeJavaScript('document.body.innerText'));
 };
 await window.webContents.executeJavaScript(`localStorage.setItem('kirana-os:ui-language:v1','en');localStorage.setItem('kiranaos.auth.session.v1',JSON.stringify({accessToken:'native-proof-fixture',user:{id:'native-proof-user',shopId:'native-proof-shop',role:'owner',name:'Native proof'},shop:{id:'native-proof-shop',name:'Native proof shop',ownerName:'Proof',city:'Test',address:'Test',settingsJson:'{}'}}));const identity=JSON.stringify(['native-proof-user','native-proof-shop']);localStorage.setItem('kiranaos.security.lastActivity.v1:'+identity,String(Date.now()));sessionStorage.setItem('kiranaos.security.sessionStarted.v1:'+identity,String(Date.now()));`);
 await window.loadURL('kirana://app/dashboard');
 await until(`Boolean(document.querySelector('[data-voice-mic="true"]'))`);
 await window.webContents.executeJavaScript(`document.querySelector('[data-voice-mic="true"]').click()`);
 await until(`document.body.innerText.includes('Recording securely')`);
 fs.writeFileSync(path.join(proof,'voice-recording.png'),(await window.webContents.capturePage()).toPNG());
 await window.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Stop').click()`);
 await until(`Boolean([...document.querySelectorAll('textarea')].find(e=>e.value==='open products'))`);
 if (uploads !== 1) throw new Error('Expected exactly one audio upload');
 fs.writeFileSync(path.join(proof,'voice-transcript.png'),(await window.webContents.capturePage()).toPNG());
 fs.writeFileSync(path.join(proof, 'result.json'), JSON.stringify({boot,denied,recorded,requests,health,storage,offline,firstTapRecords:true,transcriptVisible:true,uploads,errors},null,2));
 console.log(JSON.stringify({passed:true,denied,recorded,requests,health,offlineShell:true,firstTapRecords:true,transcriptVisible:true,uploads,errors}));
 console.log('Evidence:', proof);
 app.exit(0);
})().catch(error=>{console.error(error);app.exit(1)});
