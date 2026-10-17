// Synthetic audio only; a disposable profile; no shop writes. Run with Electron.
const { app, dialog, systemPreferences, net } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const http = require('node:http');
const proof = fs.mkdtempSync(path.join(os.tmpdir(), 'kirana-desktop-proof-'));
app.setPath('userData', path.join(proof, 'profile'));
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
let allow = false, requests = 0;
let fixture = false, uploads = 0, agentRequests = 0;
let uploadedAudio = null;
let proposalFixture = false, rejectFails = true, rejectRequests = 0;
// Receive the actual Electron HTTP upload, then use the production parser.
// Only the speech provider's answer is a fixture; capture, transport and parsing
// must work together. This service has no shop database or production writes.
const uploadServer = http.createServer(async (incoming, response) => {
  try {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const bytes = Buffer.concat(chunks);
    const { uploadAiAudio, removeUploadedAudioFile, __uploadTestUtils } = await import('../../backend/src/modules/ai/ai.upload.js');
    const part = __uploadTestUtils.parseMultipartAudio(bytes, __uploadTestUtils.getMultipartBoundary(incoming.headers['content-type']));
    if (part?.mimetype !== 'audio/webm') throw new Error('Upload must also work with the deployed server media-type allowlist');
    const request = Readable.from([bytes]);
    request.headers = incoming.headers;
    await uploadAiAudio(request, {}, error => { if (error) throw error; });
    try {
      const audio = fs.readFileSync(request.aiAudioFile.path);
      if (audio.length < 100 || audio.subarray(0, 4).toString('hex') !== '1a45dfa3') throw new Error('Uploaded recording is not valid WebM');
      uploadedAudio = { bytes: audio.length, mimeType: request.aiAudioFile.mimetype, webmHeaderValid: true, uploadMiddlewareAccepted: true };
    } finally { await removeUploadedAudioFile(request.aiAudioFile); }
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ success: true, data: { transcript: 'open products', provider: 'fixture', model: 'fixture' } }));
  } catch (error) {
    console.error('Upload failed:', error.message);
    response.writeHead(400, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ success: false, error: error.message }));
  }
});
const uploadReady = new Promise((resolve, reject) => {
  uploadServer.once('error', reject);
  uploadServer.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${uploadServer.address().port}/api/ai/transcribe`));
});
const fetchNetwork = net.fetch.bind(net);
net.fetch = async (input, options) => {
  if (fixture && String(input).startsWith('https:')) {
    if (String(input).includes('/ai/transcribe')) {
      uploads++;
      const headers = new Headers(options.headers);
      if (!headers.get('content-type')?.includes('multipart/form-data; boundary=')) throw new Error('Audio upload lost its boundary');
      return fetchNetwork(await uploadReady, options);
    }
    if (String(input).includes('/ai/agent/chat')) {
      agentRequests++;
      if (proposalFixture) return Response.json({ success:true, data: {
        turnId:'fixture-turn',planId:'fixture-plan',reply:'Review the test product.',
        plan:[{ref:'1',tool:'create_product',risk:'confirm',summary:'Create fixture product'}],
        requiresConfirmation:true,requiresOwnerPin:false,trace:[],stoppedBecause:'completed',
        provider:{name:'fixture',model:'fixture',toolsOffered:1}
      } });
    }
    if (String(input).includes('/ai/agent/reject')) {
      rejectRequests++;
      if (!rejectFails) return Response.json({ success:true, data:{status:'rejected'} });
    }
    return Response.json({message:'Isolated fixture'}, {status:503});
  }
  return fetchNetwork(input, options);
};
let stage = "boot";
const timeout = setTimeout(() => {console.error("Timeout at",stage,"permission requests",requests); app.exit(1)}, 60000);
dialog.showMessageBox = async () => { requests++; console.log("permission decision",allow); return { response: allow ? 0 : 1 }; };
systemPreferences.askForMediaAccess = async () => true;
const { ready } = require('../desktop/main.cjs');
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
 const window = await ready;
 window.webContents.setBackgroundThrottling(false);
 const paint = () => window.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
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
   throw new Error('UI timed out: '+expression+'\n'+await window.webContents.executeJavaScript('JSON.stringify({url:location.href,dialogs:[...document.querySelectorAll(\'[role="dialog"][aria-label="Assistant"]\')].map(e=>e.outerHTML.slice(0,350)),text:document.body.innerText})'));
 };
 const click = async expression => {
   const point = await window.webContents.executeJavaScript(`(()=>{const element=${expression};const rect=element.getBoundingClientRect();const point={x:Math.round(rect.x+rect.width/2),y:Math.round(rect.y+rect.height/2)};const hit=document.elementFromPoint(point.x,point.y);if(!element.contains(hit)) throw new Error('Button is covered by '+hit?.closest('button')?.outerHTML);return point})()`);
   window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
   window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
 };
 await window.webContents.executeJavaScript(`localStorage.setItem('kirana-os:ui-language:v1','en');localStorage.setItem('kiranaos.auth.session.v1',JSON.stringify({accessToken:'native-proof-fixture',user:{id:'native-proof-user',shopId:'native-proof-shop',role:'owner',name:'Native proof'},shop:{id:'native-proof-shop',name:'Native proof shop',ownerName:'Proof',city:'Test',address:'Test',settingsJson:'{}'}}));const identity=JSON.stringify(['native-proof-user','native-proof-shop']);localStorage.setItem('kiranaos.security.lastActivity.v1:'+identity,String(Date.now()));sessionStorage.setItem('kiranaos.security.sessionStarted.v1:'+identity,String(Date.now()));`);
 await window.loadURL('kirana://app/dashboard');
 await until(`Boolean(document.querySelector('[data-voice-mic="true"]'))`);
 await click(`document.querySelector('[data-voice-mic="true"]')`);
 await until(`document.body.innerText.includes('Recording securely')`);
 await until(`Boolean(document.querySelector('[data-microphone-feedback="true"] meter')?.value > 0)`);
 const microphoneFeedback = await window.webContents.executeJavaScript(`({level:document.querySelector('[data-microphone-feedback="true"] meter').value, text:document.querySelector('[data-microphone-feedback="true"]').innerText})`);
 await paint();
 fs.writeFileSync(path.join(proof,'voice-recording.png'),(await window.webContents.capturePage()).toPNG());
 await click(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Stop')`);
 await until(`Boolean([...document.querySelectorAll('textarea')].find(e=>e.value==='open products'))`);
 if (uploads !== 1) throw new Error('Expected exactly one audio upload');
 await paint();
 fs.writeFileSync(path.join(proof,'voice-transcript.png'),(await window.webContents.capturePage()).toPNG());
 await click(`document.querySelector('[data-voice-assistant="true"] button[aria-label="Close"]')`);
 await paint();
 fs.writeFileSync(path.join(proof,'voice-controls.png'),(await window.webContents.capturePage()).toPNG());
 // The separate chat launcher and its microphone must also be reachable on a
 // narrow installed-app screen. Cancel instead of submitting a shop command.
 window.setContentSize(430, 850);
 await paint();
 await click(`document.querySelector('[data-assistant-launcher="true"]')`);
 await until(`Boolean(document.querySelector('[role="dialog"][aria-label="Assistant"] button[aria-label="Speak"]'))`);
 await paint();
 await click(`document.querySelector('[role="dialog"][aria-label="Assistant"] button[aria-label="Speak"]')`);
 await until(`Boolean(document.querySelector('[role="dialog"][aria-label="Assistant"] button[aria-label="Listening… tap to stop"]'))`);
 await paint();
 fs.writeFileSync(path.join(proof,'mobile-layout-recording.png'),(await window.webContents.capturePage()).toPNG());
 await click(`document.querySelector('[role="dialog"][aria-label="Assistant"] button[aria-label="Close"]')`);
 await until(`!document.querySelector('[role="dialog"][aria-label="Assistant"]')`);
 if (uploads !== 1) throw new Error('Closing the chat microphone must cancel its upload');
 // Complete the chat microphone path too. The provider is deliberately down:
 // a clear page command must navigate after transcription without a model call.
 stage='chat voice navigation';
 await click(`document.querySelector('[data-assistant-launcher="true"]')`);
 await until(`Boolean(document.querySelector('[role="dialog"][aria-label="Assistant"] button[aria-label="Speak"]'))`);
 await click(`document.querySelector('[role="dialog"][aria-label="Assistant"] button[aria-label="Speak"]')`);
 await until(`Boolean(document.querySelector('[role="dialog"][aria-label="Assistant"] [data-microphone-feedback="true"] meter')?.value > 0)`);
 await click(`document.querySelector('[role="dialog"][aria-label="Assistant"] button[aria-label="Listening… tap to stop"]')`);
 await until(`location.pathname === '/products' && !document.querySelector('[role="dialog"][aria-label="Assistant"]')`);
 if (uploads !== 2 || agentRequests !== 0) throw new Error('Chat navigation incorrectly depended on the AI provider');
 await paint();
 fs.writeFileSync(path.join(proof,'chat-voice-products.png'),(await window.webContents.capturePage()).toPNG());
 // A page command must not abandon a still-confirmable proposal. Exercise
 // failed cancellation and successful cancellation through the actual panel.
 stage='proposal navigation guard';
 proposalFixture = true;
 await click(`document.querySelector('[data-assistant-launcher="true"]')`);
 await until(`Boolean(document.querySelector('[role="dialog"][aria-label="Assistant"] form input'))`);
 const sendText = async text => {
   await window.webContents.executeJavaScript(`(()=>{const input=document.querySelector('[role="dialog"][aria-label="Assistant"] form input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,${JSON.stringify(text)});input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
   await until(`!document.querySelector('[role="dialog"][aria-label="Assistant"] button[type="submit"]').disabled`);
   await click(`document.querySelector('[role="dialog"][aria-label="Assistant"] button[type="submit"]')`);
 };
 await sendText('prepare a test product');
 await until(`document.body.innerText.includes('Waiting for your confirmation')`);
 await sendText('open billing');
 await until(`document.body.innerText.includes('Cancellation could not be confirmed')`);
 if (await window.webContents.executeJavaScript(`location.pathname !== '/products' || !document.body.innerText.includes('Waiting for your confirmation')`)) throw new Error('Navigation abandoned a pending proposal');
 rejectFails = false;
 await sendText('open billing');
 await until(`location.pathname === '/billing' && !document.querySelector('[role="dialog"][aria-label="Assistant"]')`);
 if (agentRequests !== 1 || rejectRequests !== 2) throw new Error('Navigation must cancel the old plan, not submit another AI request');
 fs.writeFileSync(path.join(proof, 'result.json'), JSON.stringify({boot,denied,recorded,requests,health,storage,offline,microphoneFeedback,firstTapRecords:true,transcriptVisible:true,chatMicReachableInMobileLayout:true,chatVoiceNavigated:true,pendingPlanNavigationGuard:true,agentRequests,rejectRequests,uploads,uploadedAudio,errors},null,2));
 console.log(JSON.stringify({passed:true,denied,recorded,requests,health,offlineShell:true,firstTapRecords:true,transcriptVisible:true,chatMicReachableInMobileLayout:true,chatVoiceNavigated:true,pendingPlanNavigationGuard:true,agentRequests,rejectRequests,uploads,uploadedAudio,errors}));
 console.log('Evidence:', proof);
 clearTimeout(timeout);
 window.destroy();
 uploadServer.close();
 app.exit(0);
})().catch(error=>{clearTimeout(timeout);console.error(error);uploadServer.close();app.exit(1)});
