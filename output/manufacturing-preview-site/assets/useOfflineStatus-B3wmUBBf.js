import{a as n}from"./vendor-data-BaHBZjtO.js"
import{a as e,r as t}from"./deferred-runtime-DSBH9E_S.js"
import{r as a,c as i}from"./sync-status-repair-D20_rW1P.js"
import{b1 as o,h as u,p as c,e as l}from"./index-Ci-XYli4.js"
const r=[2500,8e3,2e4,45e3],s=r.length-1
let d={backendStatus:o(),pendingCount:0,failedCount:0,conflictCount:0,isSyncing:!1,queueStatus:"checking"}
const w=new Set
function f(n){d=n
for(const e of[...w])e()}function b(n){d.isSyncing!==n&&f({...d,isSyncing:n})}function v(n){(n=>{const e=d.backendStatus.browserOnline&&d.backendStatus.backendReachable,t=n.browserOnline&&n.backendReachable
!e&&t&&i().catch(()=>0)})(n)
const e=d.backendStatus
e.browserOnline===n.browserOnline&&e.backendReachable===n.backendReachable&&e.apiBaseUrl===n.apiBaseUrl&&e.error===n.error||f({...d,backendStatus:n})}let m=!1,y=null,h=null,k=null,S=null,g=null,p=null,L=!1,C=0,E=!1
function q(){0!==C&&(C=0,L&&R())}function R(){L&&(null!==g&&window.clearTimeout(g),g=window.setTimeout(()=>{g=null,(async()=>{try{const n=await T(),e=!n||n.totalBlocking>0,t=navigator.onLine&&"visible"===document.visibilityState,a=t&&u()?await B():0
t&&await M(),E=a>0&&d.pendingCount>0,C=((n,e)=>e?0:Math.min(Math.max(0,Math.trunc(n))+1,s))(C,e)}catch{E=!1}finally{R()}})()},((n,e=!1)=>{if(e)return 150
const t=Math.max(0,Math.min(Math.trunc(n),s))
return r[t]})(C,E)))}let O=0
async function T(){const n=++O
try{const e=await a()
return n!==O?null:((n=>{d.pendingCount===n.pending&&d.failedCount===n.failed&&d.conflictCount===n.conflict&&"ready"===d.queueStatus||f({...d,pendingCount:n.pending,failedCount:n.failed,conflictCount:n.conflict,queueStatus:"ready"})})(e),e)}catch{return n===O&&"error"!==d.queueStatus&&f({...d,queueStatus:"error"}),null}}async function B(n={}){if(m)return 0
if(!n.manual&&!u())return 0
const a=await c({force:n.manual})
if(v(a),!a.browserOnline||!a.backendReachable)return 0
m=!0,b(!0)
try{const a=n.hydrate??!0===n.manual?await e():await t()
return await T(),a.pushed}catch(i){throw await T(),i}finally{m=!1,b(!1)}}async function M(){if("undefined"!=typeof navigator&&!navigator.onLine)return
if("undefined"!=typeof document&&"visible"!==document.visibilityState)return
const n=await T()
n&&0!==n.totalBlocking&&(m||l("kirana.sync.localQueueRecovery.lastRun",3e3)&&await B({manual:!0,hydrate:!1}))}function j(n){u()&&(null!==y&&window.clearTimeout(y),y=window.setTimeout(()=>{y=null,B().catch(()=>{})},n))}function x(){q(),u()&&c({force:!0}).then(v),j(500)}function I(){c({force:!0}).then(v)}function U(n){T()
const e=n?.detail
"sync"!==e?.type&&(q(),navigator.onLine&&"visible"===document.visibilityState&&(j(450),null!==S&&window.clearTimeout(S),S=window.setTimeout(()=>{S=null,M()},900)))}function z(n){const e=n.detail
e&&"object"==typeof e&&v(e)}function K(){"visible"===document.visibilityState&&(T(),navigator.onLine&&M())}function N(n){return w.add(n),L||"undefined"==typeof window||(L=!0,window.addEventListener("online",x),window.addEventListener("offline",I),window.addEventListener("kirana:sync-queue-updated",U),window.addEventListener("kirana:local-data-changed",U),window.addEventListener("kirana:backend-status-changed",z),document.addEventListener("visibilitychange",K),T(),u()&&c({force:!0}).then(v),("undefined"==typeof navigator||navigator.onLine)&&u()&&(h=window.setTimeout(()=>{h=null,B().catch(()=>{})},700)),k=window.setTimeout(()=>{k=null,M()},1e3),C=0,R(),p=window.setInterval(()=>{"visible"===document.visibilityState&&u()&&c().then(v)},8e3)),()=>{w.delete(n),0===w.size&&(()=>{if(L){L=!1,O+=1,d={...d,queueStatus:"checking"},window.removeEventListener("online",x),window.removeEventListener("offline",I),window.removeEventListener("kirana:sync-queue-updated",U),window.removeEventListener("kirana:local-data-changed",U),window.removeEventListener("kirana:backend-status-changed",z),document.removeEventListener("visibilitychange",K)
for(const n of[y,h,k,S,g])null!==n&&window.clearTimeout(n)
y=null,h=null,k=null,S=null,g=null,C=0,null!==p&&window.clearInterval(p),p=null}})()}}const Q=()=>d
function A(){const e=n.useSyncExternalStore(N,Q,Q)
return{isOnline:e.backendStatus.browserOnline&&e.backendStatus.backendReachable,isBrowserOnline:e.backendStatus.browserOnline,isBackendReachable:e.backendStatus.backendReachable,backendStatus:e.backendStatus,pendingCount:e.pendingCount,failedCount:e.failedCount,conflictCount:e.conflictCount,isSyncing:e.isSyncing,queueStatus:e.queueStatus,syncNow:B}}export{A as u}
