import{J as e,a8 as t,bO as n,bP as a,au as o,ax as s,at as r,a9 as i,bQ as u,a6 as d,as as c,av as m,aw as l}from"./index-CYG8yywH.js"
function p(e){return String(e??"").trim().toLocaleLowerCase("en-IN").normalize("NFKC").replace(/[^\p{L}\p{N}\s]/gu," ").replace(/\s+/g," ").trim()}function y(e){const t=String(e??"").replace(/\D/g,"")
return t.length>10?t.slice(-10):t}function b(e){return/^[6-9]\d{9}$/.test(y(e))}function _(e){const t=p(e)
return t?t.split(" ").filter(e=>e.length>1):[]}function g(e,t){const n=p(e),a=p(t)
return n&&a?n===a?1:n.includes(a)||a.includes(n)?.9:((e,t)=>{if(0===e.length||0===t.length)return 0
const n=new Set(e),a=new Set(t)
return 2*[...n].filter(e=>a.has(e)).length/(n.size+a.size)})(_(n),_(a)):0}function f(e,t){const n=g(e.name,t.name),a=p(e.address),o=p(t.address)
return!(n<.55)&&(a&&o?g(a,o)>=.45:n>=.9)}function w(e,t,n){const a=y(e.mobile),o=[]
for(const s of t){if(n&&s.id===n)continue
if(s.deletedAt||s.deleted_at)continue
const t=y(s.mobile)
a&&t&&a===t?o.push({customerId:s.id,customerName:s.name,reason:"mobile",matchedFields:["mobile"],message:`Duplicate customer: mobile number already exists for ${s.name}.`}):f(e,s)&&o.push({customerId:s.id,customerName:s.name,reason:"name_address_similarity",matchedFields:["name","address"],message:`Possible duplicate: ${e.name??"Customer"} looks similar to existing customer ${s.name}.`})}return o}const h="customers",A=["customers","local_audit_logs","sync_outbox"]
function P(e){const t=Math.max(0,d(e.udharAmount??e.totalUdhar,0))
return{...e,udharAmount:t,totalUdhar:t}}function C(e,t=c("customer"),n){const a=(new Date).toISOString()
return P({...n,id:t,name:e.name?.trim()||n?.name||"Customer",mobile:e.mobile?.trim()||n?.mobile||null,type:e.type??n?.type??"regular",reminderOverrideUntil:e.reminderOverrideUntil??n?.reminderOverrideUntil??null,address:e.address??n?.address??null,gstNumber:e.gstNumber??n?.gstNumber??null,stateCode:e.stateCode??n?.stateCode??null,dueDate:void 0!==e.dueDate?e.dueDate:n?.dueDate??null,promiseToPayDate:void 0!==e.promiseToPayDate?e.promiseToPayDate:n?.promiseToPayDate??null,udharLimit:void 0!==e.udharLimit?e.udharLimit:n?.udharLimit??null,customerSpecificPricing:e.customerSpecificPricing??n?.customerSpecificPricing??null,notes:void 0!==e.notes?e.notes:n?.notes??null,createdAt:n?.createdAt??a,updatedAt:a,deletedAt:null})}async function D(t){const n=t.auditLogs.map(e=>m(l(e))),a=m(t.outbox)
await e.transaction(A,async e=>{await e.put("customers",t.customer)
for(const n of t.auditLogs)await e.put("local_audit_logs",n)
for(const t of n)await e.enqueueOutboxOperation(t)
await e.enqueueOutboxOperation(a)})}async function L(a){const i=y(a.mobile),u=t(n,{...a,name:a.name??"",mobile:i}),d=w(u,await e.getAll("customers").catch(()=>[])).find(e=>"mobile"===e.reason)
if(d)throw new Error(`Mobile number already belongs to ${d.customerName}. Open that customer instead.`)
const c=r(C(u),"customer","pending_sync")
return await D({customer:c,auditLogs:[o({action:"customer_created",entityType:"customer",entityId:c.id,entityLabel:c.name,newValue:c,summary:`Customer ${c.name} created`})],outbox:{entity_type:"customer",entity_id:c.id,operation_type:"CREATE_CUSTOMER",payload:{localCustomerId:c.id,customer:u}}}),s(h,c,1e3),c}async function v(r,i){const u=await e.getAll("customers").catch(()=>[]),d=u.find(e=>e.id===r),c="synced"===d?.sync_status?d.updatedAt??d.updated_at:d?.base_updated_at??d?.updatedAt??d?.updated_at,m={...d,...i,name:i.name??d?.name??"",mobile:y(i.mobile??d?.mobile)},l=t(n,m),p=w(l,u,r).find(e=>"mobile"===e.reason)
if(p)throw new Error(`Mobile number already belongs to ${p.customerName}. Open that customer instead.`)
const b={...a(C(l,r,d),"pending_sync"),...c?{base_updated_at:c}:{}}
return await D({customer:b,auditLogs:[o({action:"customer_edited",entityType:"customer",entityId:r,entityLabel:b.name,oldValue:d??null,newValue:b,summary:`Customer ${b.name} edited`})],outbox:{entity_type:"customer",entity_id:r,operation_type:"UPDATE_CUSTOMER",payload:{customerId:r,customer:l,...c?{baseUpdatedAt:c}:{}}}}),s(h,b,1e3),b}async function I(n){const a=n.id.trim(),s=n.reason?.trim()||"Moved to recycle bin"
t(i,{action:"delete_customer",ownerPin:n.ownerPin,entityId:a,reason:s})
const d=(new Date).toISOString(),c=await e.getAll("customers").then(e=>e.find(e=>e.id===a||e.local_id===a||e.server_id===a)).catch(()=>{}),m=c?{...c,deletedAt:d,deleted_at:d,deleteReason:s,updatedAt:d,updated_at:d,sync_status:"pending_sync"}:r({id:a,name:"Deleted customer",mobile:null,type:"regular",createdAt:d,updatedAt:d,deletedAt:d,deleteReason:s},"customer","pending_sync")
return await D({customer:m,auditLogs:[o({action:"customer_deleted",entityType:"customer",entityId:a,entityLabel:c?.name??a,oldValue:c??null,newValue:m,reason:s,ownerPinProvided:!0,summary:`Customer ${c?.name??a} moved to recycle bin`})],outbox:{entity_type:"customer",entity_id:a,operation_type:"DELETE_CUSTOMER_PENDING",idempotency_key:`delete-customer:${a}`,payload:{customerId:a,localCustomerId:m.local_id??a,serverCustomerId:m.server_id??null,reason:s,ownerPinProvided:!0,ownerPin:n.ownerPin}}}),u(h,a),{success:!0,message:"Customer delete queued for sync"}}export{y as a,L as c,I as d,w as f,b as i,P as n,v as u}
