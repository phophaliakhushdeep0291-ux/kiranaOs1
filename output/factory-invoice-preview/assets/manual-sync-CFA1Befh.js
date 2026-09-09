import{hydrateFromBackendSnapshot as r}from"./cloud-hydration-c9ELc8tY.js"
import{r as s}from"./sync-engine-DYGstg73.js"
import{t,A as o}from"./index-DbQMpL2c.js"
import"./vendor-data-BaHBZjtO.js"
import"./sync-reconcile-MR5x3Lmq.js"
import"./sync-types-B187FdZc.js"
import"./vendor-react-CdF70ZyV.js"
import"./vendor-ui-CIi-vqR6.js"
import"./vendor-validation-C84QDzN5.js"
import"./sync-push-iPGo0vIO.js"
import"./sync-status-repair-CiPZ0ujK.js"
import"./api-CBwaPDBi.js"
async function i(){let i,n={pushed:0,pulled:0,conflicts:0,failed:0,pending:0,skipped:0}
t(o.SYNC_STARTED,{trigger:"manual"},{module:"sync"})
try{n=await s()}catch(a){i=a instanceof Error?a.message:String(a)}const e=await r()
return e.errors.length,{...n,snapshot:e,...i?{syncError:i}:{}}}export{i as runManualSyncCycle}
