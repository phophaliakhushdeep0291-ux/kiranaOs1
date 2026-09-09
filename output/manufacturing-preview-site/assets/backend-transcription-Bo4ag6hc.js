import{ak as e,aJ as o}from"./index-Ci-XYli4.js"
import{a as r}from"./ai-client-C242r-8p.js"
const n={correct:"NONE",misunderstood:"MISUNDERSTOOD_REQUEST",unsafe:"UNSAFE_ACTION"}
function i(o,r){return e("/ai/feedback",{method:"POST",body:JSON.stringify({actionLogId:o,outcome:r,reasonCode:n[r]})})}const t=["audio/webm;codecs=opus","audio/webm","audio/mp4"]
function a(e){if(e instanceof o){if("AI_KEY_MISSING"===e.data.code)return"Cloud transcription is not configured on this server. Type the command or ask the owner to configure an AI provider."
if("AI_RATE_LIMITED"===e.data.code)return"Cloud transcription is busy. Wait a moment or type the command."
if("AI_QUOTA_EXCEEDED"===e.data.code)return"Cloud transcription quota is unavailable. Type the command while the owner checks provider billing."
if(401===e.status)return"Your session expired before transcription. Sign in again and retry."}return e instanceof DOMException&&["NotAllowedError","SecurityError"].includes(e.name)?"Microphone is blocked. Allow microphone access from the browser lock icon and retry.":e instanceof DOMException&&"NotFoundError"===e.name?"No microphone is selected in the browser or operating-system input settings.":"undefined"==typeof navigator||navigator.onLine?e instanceof Error&&e.message?e.message:"Voice could not be transcribed. Type the command or retry.":"Cloud transcription needs a connection. Type the command while offline."}async function s(e,o=15e3){(()=>{if("undefined"==typeof window||"undefined"==typeof navigator)throw new Error("Voice recording is available only in the app browser.")
const e=["localhost","127.0.0.1","0.0.0.0"].includes(window.location.hostname)
if(!window.isSecureContext&&!e)throw new Error("Microphone recording requires HTTPS or localhost.")
if(!navigator.mediaDevices?.getUserMedia)throw new Error("This browser cannot request microphone access.")
if("undefined"==typeof MediaRecorder)throw new Error("This browser cannot record audio for cloud transcription.")})()
const n=await navigator.mediaDevices.getUserMedia({audio:!0}),i=((e=e=>MediaRecorder.isTypeSupported(e))=>t.find(e)??"")(),s=i?new MediaRecorder(n,{mimeType:i}):new MediaRecorder(n),c=[]
let d,u=!1,p=!1
const m=()=>n.getTracks().forEach(e=>e.stop()),f=()=>{p||(p=!0,e.onEnd())},l=()=>{"inactive"!==s.state&&s.stop()}
return s.ondataavailable=e=>{e.data.size>0&&c.push(e.data)},s.onerror=()=>{e.onError("The browser audio recorder failed. Check microphone access or type the command.")},s.onstop=async()=>{if(d&&window.clearTimeout(d),m(),u)return void f()
const o=new Blob(c,{type:s.mimeType||i||"audio/webm"})
if(0===o.size)return e.onError("No audio was captured. Speak closer to the microphone or type the command."),void f()
e.onTranscribing()
try{const n=await r(o)
e.onTranscript(n)}catch(n){e.onError(a(n))}finally{f()}},s.start(250),e.onStart(),d=window.setTimeout(l,Math.max(1e3,Math.min(o,15e3))),{stop:l,cancel:()=>{u=!0,d&&window.clearTimeout(d),l(),m(),"inactive"===s.state&&f()}}}export{s as a,a as b,i as s}
