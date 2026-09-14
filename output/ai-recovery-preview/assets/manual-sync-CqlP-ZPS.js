import{hydrateFromBackendSnapshot as r}from"./cloud-hydration-7ZLaFtau.js"
import{r as s}from"./sync-engine-CEaweufP.js"
import{t,A as o}from"./index-DhCGH5L2.js"
import"./vendor-data-BaHBZjtO.js"
import"./sync-reconcile-btNMUEr7.js"
import"./sync-types-B187FdZc.js"
import"./vendor-react-CdF70ZyV.js"
import"./vendor-ui-CIi-vqR6.js"
import"./vendor-validation-C84QDzN5.js"
import"./sync-push-BfdTogiR.js"
import"./sync-status-repair-CP18WTtH.js"
import"./api-B2_aluva.js"
async function i(){let i,n={pushed:0,pulled:0,conflicts:0,failed:0,pending:0,skipped:0}
t(o.SYNC_STARTED,{trigger:"manual"},{module:"sync"})
try{n=await s()}catch(a){i=a instanceof Error?a.message:String(a)}const e=await r()
return e.errors.length,{...n,snapshot:e,...i?{syncError:i}:{}}}export{i as runManualSyncCycle}
