function n(n){return"hi"===n?"hi-IN":"en-IN"}function e(){if("undefined"==typeof window)return
const n=window
return n.SpeechRecognition??n.webkitSpeechRecognition}function t(n){return n.replace(/\s+/g," ").trim()}function o(n){return t(n).toLocaleLowerCase("en-IN")}function r(n,e){const t=o(n),r=o(e)
return Boolean(t&&t===r)}function c(n,e,t=Date.now(),r=1500){const c=o(n)
return!(!c||e&&e.key===c&&t-e.at<r)}function i(n,e,i="en-IN"){const s=new n
let a=null
return s.lang=i,s.continuous=!1,s.interimResults=!0,s.maxAlternatives=1,s.onstart=e.onStart,s.onresult=n=>{const i=(n=>{const e=[],c=new Set
for(let i=n.resultIndex??0;i<n.results.length;i+=1){const s=n.results[i]
if(!s||!1===s.isFinal)continue
const a=t(s[0]?.transcript??"")
if(!a)continue
const u=o(a)
if(c.has(u))continue
const l=e[e.length-1]
l&&r(a,l)||(c.add(u),e.push(a))}return t(e.join(" "))})(n)
if(!i)return
const s=Date.now()
c(i,a,s)&&(a={key:o(i),at:s},e.onTranscript(i))},s.onerror=n=>{const t=n.error??"unknown"
e.onError((n=>"not-allowed"===n||"service-not-allowed"===n?"Mic is blocked. Click the site controls icon near localhost, allow Microphone, refresh, then try again.":"network"===n?"Chrome speech service is unavailable. Type the command manually.":"no-speech"===n?"No voice heard. Speak closer to the mic or type the command.":`Mic error: ${n}`)(t),"no-speech"===t?"default":"destructive",t)},s.onend=e.onEnd,s}export{n as a,i as c,e as g,c as s,o as v}
