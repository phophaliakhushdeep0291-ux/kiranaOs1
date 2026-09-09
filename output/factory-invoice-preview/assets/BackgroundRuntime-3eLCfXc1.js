import{u as e,a as n,j as t}from"./vendor-data-BaHBZjtO.js"
import{d as a,g as r,e as i,h as o,p as s,L as c,j as u}from"./index-DbQMpL2c.js"
import{h as d,r as l}from"./deferred-runtime-DF2u_c1Y.js"
import"./vendor-react-CdF70ZyV.js"
import"./vendor-ui-CIi-vqR6.js"
import"./vendor-validation-C84QDzN5.js"
function w(){const{accessToken:t,user:s,shop:c,isAuthenticated:u}=a(),w=e(),v=n.useRef(null)
return n.useEffect(()=>{if(!u||!t||!s?.id)return
const e=c?.id??s.shopId??"unknown-shop",n=`${r()}::${e}::${s.id}`
if(v.current===n)return
v.current=n
let a=!1
const p=[],f=`kirana.cloudBootstrap.lastRun::${n}`
return(()=>{const e=window.setTimeout(async()=>{if(!a)try{if(!i(f,12e3))return
const e=await d(),n=o()?await l().catch(e=>({error:e instanceof Error?e.message:String(e)})):{skipped:!0,reason:"not-scheduled-leader"}
if(a)return
const t={snapshot:e,sync:n}
window.dispatchEvent(new CustomEvent("kirana:cloud-bootstrap-complete",{detail:t})),window.dispatchEvent(new CustomEvent("kirana:local-data-changed",{detail:{type:"sync",action:"cloud-bootstrap",result:t}})),await w.invalidateQueries({refetchType:"none"}),await w.refetchQueries({type:"active"})}catch{a||(v.current=null)}},900)
p.push(e)})(),()=>{a=!0
for(const e of p)window.clearTimeout(e)}},[t,u,w,c?.id,s?.id,s?.shopId]),null}const v=6e4
function p(){return"undefined"==typeof document||"visible"===document.visibilityState}function f(){return"undefined"==typeof document||"visible"===document.visibilityState}function m(){return(()=>{const t=e(),a=n.useRef(null),r=n.useRef(null),o=n.useRef("none")
n.useEffect(()=>{const e=e=>{null!==e&&window.clearTimeout(e)},n=(e=120,n="none")=>{f()&&("active"===n&&(o.current="active"),null===a.current&&(a.current=window.setTimeout(()=>{a.current=null
const e=o.current
o.current="none",t.invalidateQueries({refetchType:e})},e)))},s=()=>{f()&&u()&&i("kirana.activeQueryRefresh.lastRun",2500)&&(e(r.current),r.current=window.setTimeout(()=>{r.current=null,t.invalidateQueries({refetchType:"active"})},1200))},d=()=>{n(120,"active")},l=()=>n(),w="undefined"!=typeof BroadcastChannel?new BroadcastChannel(c):null
w&&(w.onmessage=e=>{const n=e.data
n&&"kirana-local-data"===n.source&&window.dispatchEvent(new CustomEvent("kirana:local-data-changed",{detail:{...n.detail??{},source:"broadcast"}}))})
let v=null
const p=e=>{const t=e.detail,a=Boolean(t?.backendReachable)
a&&!1===v?s():n(),v=a},m=()=>s(),h=()=>{f()&&s()}
return window.addEventListener("kirana:local-data-changed",d),window.addEventListener("kirana:sync-queue-updated",l),window.addEventListener("kirana:backend-status-changed",p),window.addEventListener("online",m),document.addEventListener("visibilitychange",h),()=>{e(a.current),e(r.current),w?.close(),window.removeEventListener("kirana:local-data-changed",d),window.removeEventListener("kirana:sync-queue-updated",l),window.removeEventListener("kirana:backend-status-changed",p),window.removeEventListener("online",m),document.removeEventListener("visibilitychange",h)}},[t])})(),(()=>{const{isAuthenticated:t,accessToken:r,user:c,shop:u}=a(),w=e(),f=n.useRef(!1),m=n.useRef(0),h=n.useRef(null),y=n.useRef(null),E=n.useRef(null)
n.useEffect(()=>{if(!t||!r||!c?.id)return
let e=!1
const n=u?.id??c.shopId??"unknown-shop",a=`kirana.multiDeviceSync.lastRun::${n}`,k=`kirana.multiDeviceSync.focusRun::${n}`,b=`kirana.multiDeviceSync.snapshotRun::${n}`,L=(()=>{if("undefined"==typeof BroadcastChannel)return null
try{return new BroadcastChannel("kirana:multi-device-sync")}catch{return null}})()
E.current=L
const g=(e,n)=>{window.dispatchEvent(new CustomEvent("kirana:local-data-changed",{detail:{type:"sync",action:"multi-device-refresh",reason:e,result:n}})),window.dispatchEvent(new CustomEvent("kirana:multi-device-sync-complete",{detail:{reason:e,result:n}})),w.invalidateQueries({refetchType:"none"})},R=e=>{try{L?.postMessage(e)}catch{}},T=async(n,t={})=>{if(!e&&!f.current&&p()&&(t.force||o())&&(t.force||i(a,900))){f.current=!0
try{const e=await s()
if(!e.browserOnline||!e.backendReachable)return
const a=await l()
if(Boolean((a.pushed??0)>0||(a.pulled??0)>0||(a.conflicts??0)>0||(a.failed??0)>0)&&(g(n,a),R({type:"sync-complete",reason:n,timestamp:Date.now(),result:a})),(t.snapshot||Date.now()-m.current>v)&&i(b,v)){m.current=Date.now()
const e=await d()
g(`${n}:snapshot`,e),R({type:"cloud-import-complete",reason:n,timestamp:Date.now(),result:e})}}catch(r){(e=>{"object"==typeof e&&null!==e&&"status"in e&&Number(e.status)})(r)}finally{f.current=!1}}},j=()=>{null!==h.current&&window.clearTimeout(h.current),h.current=window.setTimeout(()=>{h.current=null,T("local-write",{force:!1})},250)},C=e=>{const n=e.detail
"multi-device-refresh"!==n?.action&&"pull"!==n?.action&&"direct-import"!==n?.action&&j()},$=()=>j(),B=()=>{i(k,2e3)&&T("online",{force:!0,snapshot:!0})},D=()=>{p()&&i(k,2e3)&&T("focus",{force:!0})},I=()=>{p()&&D()}
L&&(L.onmessage=e=>{const n=e.data
n&&"object"==typeof n&&("sync-complete"!==n.type&&"cloud-import-complete"!==n.type||g(`broadcast:${n.reason}`,n.result))}),window.addEventListener("kirana:local-data-changed",C),window.addEventListener("kirana:sync-queue-updated",$),window.addEventListener("online",B),window.addEventListener("focus",D),document.addEventListener("visibilitychange",I)
const Q=window.setInterval(()=>{T("snapshot",{snapshot:!0})},v)
return y.current=Q,window.setTimeout(()=>{e||T("initial",{force:!0,snapshot:!0})},450),()=>{e=!0,null!==h.current&&window.clearTimeout(h.current),null!==y.current&&window.clearInterval(y.current),E.current?.close(),E.current=null,window.removeEventListener("kirana:local-data-changed",C),window.removeEventListener("kirana:sync-queue-updated",$),window.removeEventListener("online",B),window.removeEventListener("focus",D),document.removeEventListener("visibilitychange",I)}},[r,t,w,u?.id,c?.id,c?.shopId])})(),t.jsx(w,{})}export{m as default}
