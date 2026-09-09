import{a as n}from"./vendor-data-BaHBZjtO.js"
import{a as e,r as t}from"./deferred-runtime-DF2u_c1Y.js"
import{r as a,c as i}from"./sync-status-repair-CiPZ0ujK.js"
import{b1 as o,h as c,p as u,e as l}from"./index-DbQMpL2c.js"
const r=[2500,8e3,2e4,45e3],s=r.length-1
let d={backendStatus:o(),pendingCount:0,failedCount:0,conflictCount:0,isSyncing:!1,queueStatus:"checking"}
const w=new Set
function f(n){d=n
for(const e of[...w])e()}function b(n){d.isSyncing!==n&&f({...d,isSyncing:n})}function h(n){(n=>{const e=d.backendStatus.browserOnline&&d.backendStatus.backendReachable,t=n.browserOnline&&n.backendReachable
!e&&t&&i().catch(()=>0)})(n)
const e=d.backendStatus
e.browserOnline===n.browserOnline&&e.backendReachable===n.backendReachable&&e.apiBaseUrl===n.apiBaseUrl&&e.error===n.error||f({...d,backendStatus:n})}let v=!1,m=null,y=null,k=null,S=null,g=null,p=null,L=!1,C=0,E=!1
function q(){0!==C&&(C=0,L&&R())}function R(){L&&(null!==g&&window.clearTimeout(g),g=window.setTimeout(()=>{g=null,(async()=>{try{const n=await T(),e=!n||n.totalBlocking>0,t=navigator.onLine&&"visible"===document.visibilityState,a=t&&c()?await x():0
t&&await B(),E=a>0&&d.pendingCount>0,C=((n,e)=>e?0:Math.min(Math.max(0,Math.trunc(n))+1,s))(C,e)}catch{E=!1}finally{R()}})()},((n,e=!1)=>{if(e)return 150
const t=Math.max(0,Math.min(Math.trunc(n),s))
return r[t]})(C,E)))}let O=0
async function T(){const n=++O
try{const e=await a()
return n!==O?null:((n=>{d.pendingCount===n.pending&&d.failedCount===n.failed&&d.conflictCount===n.conflict&&"ready"===d.queueStatus||f({...d,pendingCount:n.pending,failedCount:n.failed,conflictCount:n.conflict,queueStatus:"ready"})})(e),e)}catch{return n===O&&"error"!==d.queueStatus&&f({...d,queueStatus:"error"}),null}}async function x(n={}){if(v)return 0
if(!n.manual&&!c())return 0
const a=await u({force:n.manual})
if(h(a),!a.browserOnline||!a.backendReachable)return 0
v=!0,b(!0)
try{const a=n.hydrate??!0===n.manual?await e():await t()
return await T(),a.pushed}catch(i){throw await T(),i}finally{v=!1,b(!1)}}async function B(){if("undefined"!=typeof navigator&&!navigator.onLine)return
if("undefined"!=typeof document&&"visible"!==document.visibilityState)return
const n=await T()
n&&0!==n.totalBlocking&&(v||l("kirana.sync.localQueueRecovery.lastRun",3e3)&&await x({manual:!0,hydrate:!1}))}function M(n){c()&&(null!==m&&window.clearTimeout(m),m=window.setTimeout(()=>{m=null,x().catch(()=>{})},n))}function j(){q(),c()&&u({force:!0}).then(h),M(500)}function I(){u({force:!0}).then(h)}function U(n){T()
const e=n?.detail
"sync"!==e?.type&&(q(),navigator.onLine&&"visible"===document.visibilityState&&(M(450),null!==S&&window.clearTimeout(S),S=window.setTimeout(()=>{S=null,B().catch(()=>{})},900)))}function z(n){const e=n.detail
e&&"object"==typeof e&&h(e)}function K(){"visible"===document.visibilityState&&(T(),navigator.onLine&&B().catch(()=>{}))}function N(n){return w.add(n),L||"undefined"==typeof window||(L=!0,window.addEventListener("online",j),window.addEventListener("offline",I),window.addEventListener("kirana:sync-queue-updated",U),window.addEventListener("kirana:local-data-changed",U),window.addEventListener("kirana:backend-status-changed",z),document.addEventListener("visibilitychange",K),T(),c()&&u({force:!0}).then(h),("undefined"==typeof navigator||navigator.onLine)&&c()&&(y=window.setTimeout(()=>{y=null,x().catch(()=>{})},700)),k=window.setTimeout(()=>{k=null,B().catch(()=>{})},1e3),C=0,R(),p=window.setInterval(()=>{"visible"===document.visibilityState&&c()&&u().then(h)},8e3)),()=>{w.delete(n),0===w.size&&(()=>{if(L){L=!1,O+=1,d={...d,queueStatus:"checking"},window.removeEventListener("online",j),window.removeEventListener("offline",I),window.removeEventListener("kirana:sync-queue-updated",U),window.removeEventListener("kirana:local-data-changed",U),window.removeEventListener("kirana:backend-status-changed",z),document.removeEventListener("visibilitychange",K)
for(const n of[m,y,k,S,g])null!==n&&window.clearTimeout(n)
m=null,y=null,k=null,S=null,g=null,C=0,null!==p&&window.clearInterval(p),p=null}})()}}const Q=()=>d
function A(){const e=n.useSyncExternalStore(N,Q,Q)
return{isOnline:e.backendStatus.browserOnline&&e.backendStatus.backendReachable,isBrowserOnline:e.backendStatus.browserOnline,isBackendReachable:e.backendStatus.backendReachable,backendStatus:e.backendStatus,pendingCount:e.pendingCount,failedCount:e.failedCount,conflictCount:e.conflictCount,isSyncing:e.isSyncing,queueStatus:e.queueStatus,syncNow:x}}export{A as u}
