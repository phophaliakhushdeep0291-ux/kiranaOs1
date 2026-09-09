const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/cloud-hydration-c9ELc8tY.js","assets/index-DbQMpL2c.js","assets/vendor-data-BaHBZjtO.js","assets/vendor-react-CdF70ZyV.js","assets/vendor-ui-CIi-vqR6.js","assets/vendor-validation-C84QDzN5.js","assets/index-C-nn0uN8.css","assets/sync-reconcile-MR5x3Lmq.js","assets/sync-types-B187FdZc.js"])))=>i.map(i=>d[i]);
import{du as e,dk as t,aO as n,dv as a,dw as s,dx as r,ar as i,a_ as o,J as c,b2 as l,dm as d,bH as u,dy as _,dz as p,p as f,c9 as y,aJ as w,A as v,ds as h,t as g}from"./index-DbQMpL2c.js"
import{w as m,u as S,x as b,q as C}from"./sync-reconcile-MR5x3Lmq.js"
import{c as E,d as O,p as A,b as k}from"./sync-push-iPGo0vIO.js"
import{d as F,e as D,r as L}from"./sync-status-repair-CiPZ0ujK.js"
import{e as N,t as I}from"./sync-types-B187FdZc.js"
import"./vendor-data-BaHBZjtO.js"
import{p as x,a as R}from"./api-CBwaPDBi.js"
const P={async COLLECT_DIAGNOSTICS(){const e=await a()
return await s(e),{reported:!0,appVersion:r().appVersion??null,online:e.online??null}},async RUN_SYNC_NOW(){const{runSyncCycle:e}=await n(async()=>{const{runSyncCycle:e}=await Promise.resolve().then(()=>W)
return{runSyncCycle:e}},void 0),t=await e()
return{pushed:t.pushed,pulled:t.pulled,failed:t.failed,conflicts:t.conflicts}},async RETRY_FAILED_SYNC(){const{retryFailedSyncOperations:e}=await n(async()=>{const{retryFailedSyncOperations:e}=await Promise.resolve().then(()=>W)
return{retryFailedSyncOperations:e}},void 0)
return{...await e()}},async PULL_FROM_CLOUD(){const{hydrateFromBackendSnapshot:e}=await n(async()=>{const{hydrateFromBackendSnapshot:e}=await import("./cloud-hydration-c9ELc8tY.js")
return{hydrateFromBackendSnapshot:e}},__vite__mapDeps([0,1,2,3,4,5,6,7,8]))
return{...await e()}},CLEAR_LOCAL_CACHE:async()=>(t(),{cleared:"memory-cache"}),REFRESH_APP:async()=>(e(),{reloading:!0})}
function j(e){return e instanceof Error?e.message:"string"==typeof e?e:"Command failed"}async function M(e){if(t=e.type,!Object.prototype.hasOwnProperty.call(P,t))return{status:"failed",error:`Unsupported command: ${e.type}`}
var t
if(e.reloadsApp)return await R(e.id,{status:"applied",result:{reloading:!0}}).catch(()=>null),await P[e.type](e).catch(()=>({})),{status:"applied",result:{reloading:!0}}
try{return{status:"applied",result:await P[e.type](e)}}catch(n){return{status:"failed",error:j(n)}}}let T=!1
function $(e,t){if(!e||"object"!=typeof e)return
const n=e
for(const a of t)if("string"==typeof n[a]&&n[a])return n[a]}const Y=new Map
function q(e={}){const t=i(),n=`${t.tenant_id}:${t.store_id}`,a=Y.get(n)
if(a&&(a.inFlight||!e.force&&Date.now()-a.startedAt<6e4))return a.promise
const s=Date.now(),r=(async()=>{const e=o(await c.getAll("sync_conflicts")),n=new Map(e.map(e=>[e.id,JSON.stringify(e)])),a=[],r=new Set
let u=null
for(;;){const e=await m({status:"open",limit:100,cursor:u,background:!0})
if(a.push(...e.conflicts),!e.pagination.hasMore)break
if(u=e.pagination.nextCursor,!u||r.has(u))throw new Error("Conflict pagination did not advance")
r.add(u)}const _=()=>{const e=i()
return e.tenant_id===t.tenant_id&&e.store_id===t.store_id}
if(!_())return
let p=!1
await l.transaction("rw",[l.sync_conflicts],async()=>{if(!_())return
const e=o(await c.getAll("sync_conflicts")),t=new Set(e.filter(e=>Date.parse(e.updated_at)>s||n.get(e.id)!==JSON.stringify(e)).map(e=>e.id)),r=a.filter(n=>!e.some(e=>(e.server_conflict_id===n.id||e.id===n.client_conflict_id)&&(t.has(e.id)||Number(e.server_record_version??0)>n.version))),u=new Set(a.map(e=>e.id)),f=((e,t)=>{const n=i(),a=new Set(t.map(e=>e.source_event_id).filter(e=>"string"==typeof e&&e.length>0)),s=e=>{const t=("string"==typeof e.source_event_id&&e.source_event_id.length>0?e.source_event_id:null)??("string"==typeof e.server_version&&a.has(e.server_version)?e.server_version:null)
return t?`source:${t}`:e.client_conflict_id?`client:${e.client_conflict_id}`:`server:${e.id}`},r=new Map
for(const i of t){const e=s(i),t=r.get(e),n="string"==typeof i.source_event_id&&i.source_event_id.length>0,a="string"==typeof t?.source_event_id&&t.source_event_id.length>0;(!t||n&&!a)&&r.set(e,i)}const o=new Map
for(const i of e){const e=$(i,["source_event_id"])??("string"==typeof i.server_version&&a.has(i.server_version)?i.server_version:null),t=e?`source:${e}`:`client:${String(i.id)}`
o.set(t,i)}for(const[i,c]of r){const e=c.client_conflict_id??void 0,t=o.get(i)??(e?o.get(`client:${e}`):void 0)??[...o.values()].find(e=>e.server_conflict_id===c.id),a={...t??{},id:t?.id??e??c.id,entity_type:c.entity_type,entity_id:c.entity_id,tenant_id:t?.tenant_id??n.tenant_id,store_id:t?.store_id??n.store_id,device_id:t?.device_id??c.device_id??n.device_id,created_at:t?.created_at??c.created_at,updated_at:c.updated_at,deleted_at:null,version:t?.version??1,sync_status:"conflict",last_modified_by:t?.last_modified_by??null,resolution:"unresolved",local_snapshot:S(t?.local_snapshot??c.local_snapshot??null),server_snapshot:S(c.server_snapshot??t?.server_snapshot??null),error_message:c.message,source_event_id:c.source_event_id??$(t,["source_event_id"]),server_conflict_id:c.id,server_record_version:c.version,server_version:c.server_version}
if(t)for(const[n,s]of o)n!==i&&s.id===t.id&&o.delete(n)
o.set(i,a)}return[...o.values()].sort((e,t)=>String(t.updated_at??t.created_at??"").localeCompare(String(e.updated_at??e.created_at??"")))})(e,r),y=new Map(e.map(e=>[e.id,e]))
for(const n of f){let e=n
"string"!=typeof n.server_conflict_id||u.has(n.server_conflict_id)||!d(n)||t.has(n.id)||(e={...n,resolution:"server_closed",sync_status:"synced",updated_at:(new Date).toISOString()}),JSON.stringify(y.get(e.id))!==JSON.stringify(e)&&(await l.sync_conflicts.put(e),p=!0)}}),p&&"undefined"!=typeof window&&window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated"))})(),u={startedAt:s,promise:r,inFlight:!0}
return Y.set(n,u),r.then(()=>{u.inFlight=!1},()=>{u.inFlight=!1}),r}async function B(e){return{pushed:0,pulled:0,conflicts:0,failed:0,pending:(await L()).totalBlocking,skipped:0,cursor:e}}let J=null,V=null
function z(){return J?(V||(V=J.catch(()=>{}).then(()=>(V=null,z()))),V):(J=(async()=>{try{return await(async e=>"undefined"==typeof navigator||"function"!=typeof navigator.locks?.request?e(!1):navigator.locks.request("kirana-os:sync-cycle:v1",{mode:"exclusive"},()=>e(!0)))(U)}finally{J=null}})(),J)}async function U(e=!1){if(await c.init(),"undefined"!=typeof window&&!_()&&!p())return B()
const t=await f()
if(!t.browserOnline||!t.backendReachable)return B();(async()=>{if(T)return{ran:0,failed:0}
T=!0
try{return await(async()=>{let e=0,t=0
try{const{commands:n}=await x()
if(!Array.isArray(n)||0===n.length)return{ran:0,failed:0}
for(const a of n){const n=await M(a)
if("applied"===n.status?e+=1:t+=1,a.reloadsApp||await R(a.id,{status:n.status,result:n.result,error:n.error}).catch(()=>null),a.reloadsApp)break}}catch{return{ran:e,failed:t}}return{ran:e,failed:t}})()}finally{T=!1}})(),["owner","admin"].includes(String(y().user?.role??""))&&q().catch(()=>{})
const n=await(async()=>(await h()).cloudSyncAllowed)()
let a,s=null
try{const e=await C({background:!0})
s=!1!==e.allowed,a=e.cursor??e.server_version}catch(d){if((e=>e instanceof w&&(401===e.status||403===e.status))(d))return B(a)}if(!(s??n))return B(a)
await F({recoverAbandonedSyncing:e}).catch(()=>0),await D().catch(()=>0)
const r=Date.now()
let i,o,l
try{i=await O(),o=await A()}catch(d){throw H(v.SYNC_FAILED,Date.now()-r,{reason:d instanceof w?d.data?.code??String(d.status):"unknown"}),d}await F().catch(()=>0)
try{l=await L()}catch(d){throw H(v.SYNC_FAILED,Date.now()-r,{reason:"local_queue_unavailable"}),d}return(i.pushed+o.pulled+i.failed+i.conflicts+o.conflicts>0||o.failed)&&H(i.failed>0||o.failed?v.SYNC_FAILED:v.SYNC_COMPLETED,Date.now()-r,{pushed:i.pushed,pulled:o.pulled,failed:i.failed,conflicts:i.conflicts+o.conflicts,...o.failed?{pullFailed:!0,reason:o.failureReason??"unknown"}:{}}),{pushed:i.pushed,pulled:o.pulled,conflicts:i.conflicts+o.conflicts,failed:i.failed,pending:l.totalBlocking,skipped:i.skipped,cursor:o.cursor,pullFailed:o.failed,pullFailureReason:o.failureReason}}function H(e,t,n){g(e,n,{durationMs:t,module:"sync"})}async function G(e,t=[]){await l.open()
const n=e?.length?await Promise.all(e.map(e=>l.sync_outbox.get(e))).then(e=>e.filter(e=>Boolean(e)&&u(e))):await c.getAll("sync_outbox").then(e=>e.filter(e=>"FAILED"===e.status||"CONFLICT"===e.status||"failed"===e.sync_status||"conflict"===e.sync_status)),a=new Set(t),s=e=>e.op_id||e.clientEventId,r=n.filter(e=>!a.has(s(e))),i=n.filter(e=>a.has(s(e)))
let o=null
const d=[...new Set([...r.map(s),...t].filter(e=>"string"==typeof e&&e.length>0))]
try{o=await b({op_ids:d.length>0?d:e})}catch(y){if(t.length>0)throw y}const _=o?.recovery?.results??[],p=new Set(_.filter(e=>"replayed"===e.status||"already_recovered"===e.status).map(e=>e.sourceEventId))
for(const c of i){const e=s(c),t=_.find(t=>t.sourceEventId===e)
"replayed"===t?.status&&t.replay?await E(c,t.replay):"already_recovered"===t?.status&&await l.sync_outbox.put({...c,status:"SYNCED",sync_status:"synced",error_message:null,last_error:null,next_retry_at:null})}r.length>0&&await l.transaction("rw",l.sync_outbox,async()=>{for(const e of r){await l.sync_outbox.put({...e,status:"PENDING",sync_status:"pending_sync",error_message:null,last_error:null,next_retry_at:null,repair_requeues:0})
const t=N(e.operation_type,e.entity_type),n=I(t)
if(n&&"settings"!==n){const t=l.table(n),a=await t.get(e.entity_id).catch(()=>{})
a&&u(a)&&await t.put({...a,sync_status:"pending_sync",isSynced:"bills"!==n&&a.isSynced,is_synced:"bills"!==n&&a.is_synced})}}})
const f=await z()
return 0===t.length?f:{...f,storedConflictRecovery:{requested:t.length,recovered:p.size,failed:_.filter(e=>"failed"===e.status).length,skipped:_.filter(e=>"skipped"===e.status).length,codes:_.filter(e=>"failed"===e.status||"skipped"===e.status).map(e=>e.code)}}}const W=Object.freeze(Object.defineProperty({__proto__:null,pullServerChanges:A,pushPendingOutboxOperations:k,retryFailedSyncOperations:G,runSyncCycle:z},Symbol.toStringTag,{value:"Module"}))
export{G as a,q as b,z as r,W as s}
