import{ar as t,J as e,c3 as r,Y as n,ak as a,b2 as s,c4 as i,X as o}from"./index-CYG8yywH.js"
import{r as c,i as l,s as d,j as u}from"./sync-reconcile-lGRdyR1D.js"
import"./vendor-data-BaHBZjtO.js"
import"./vendor-react-CdF70ZyV.js"
import"./vendor-ui-CIi-vqR6.js"
import"./vendor-validation-C84QDzN5.js"
import"./sync-types-B187FdZc.js"
const y="2099-12-31T23:59:59.999Z|~"
function p(t){return"object"==typeof t&&null!==t&&!Array.isArray(t)}function m(t){return t.toISOString().slice(0,10)}function f(t,e){return new Date(t.getTime()+24*e*60*60*1e3)}function h(t){const e=new Map
for(const r of t){const t=r.id??r.server_id??r.serverId
"string"==typeof t&&t.length>0&&e.set(t,r)}return[...e.values()]}const g=["id","server_id","serverId","clientProductId","client_product_id","local_id","localId"],b=["id","server_id","serverId","clientCustomerId","client_customer_id","local_id","localId"],_=["id","server_id","serverId","clientBillId","client_bill_id","localBillId","local_bill_id","local_id","localId"]
function w(t,e){return new Set(t.flatMap(t=>e.map(e=>t[e]).filter(t=>"string"==typeof t&&t.length>0)))}const A=new Set(["pending_sync","syncing","failed","conflict","local_only"])
async function v(t,r,n){const a=(await e.getAll(t).catch(()=>[])).filter(t=>A.has(String(t.sync_status??"synced").toLowerCase()))
if(0===a.length)return r
const s=new Set
for(const e of a)for(const t of n){const r=e[t]
"string"==typeof r&&r&&s.add(r)}return[...r.filter(t=>!n.some(e=>{const r=t[e]
return"string"==typeof r&&s.has(r)})),...a]}function I(t){const e="string"==typeof t.id&&t.id.length>0?t.id:`server_${Date.now()}_${Math.random().toString(36).slice(2)}`
return{...t,id:e,server_id:"string"==typeof t.server_id?t.server_id:e,deleted_at:t.deleted_at??t.deletedAt??null,created_at:"string"==typeof t.created_at?t.created_at:t.createdAt,updated_at:"string"==typeof t.updated_at?t.updated_at:t.updatedAt,sync_status:"synced"}}async function S(t,e){try{return{label:t,data:await e()}}catch(r){return{label:t,error:r instanceof Error?r.message:String(r)}}}async function T(){const n=t(),s=await a("/products?limit=5000",{method:"GET",cache:"no-store",background:!0}),i=Array.isArray(s)?s:[],c=await v("products",i,g)
return r(n),await e.replaceSyncedSnapshot("products",c,n),await e.removeOrphans("inventory_movements",w(c,g),["product_id","productId"],n),r(n),o("products",c),i.length}async function M(){const n=t(),s=await a("/customers?limit=5000",{method:"GET",cache:"no-store",background:!0}),i=Array.isArray(s)?s.map(t=>{const e=Number(t.udharAmount??t.totalUdhar??0),r=Number.isFinite(e)?Math.max(0,e):0
return{...t,udharAmount:r,totalUdhar:r}}):[],c=await v("customers",i,b)
return r(n),await e.replaceSyncedSnapshot("customers",c,n),r(n),o("customers",c),i.length}async function k(){const n=t(),s=new Date,i=m(f(s,-730)),c=m(f(s,1)),l=await a(`/bills?from=${encodeURIComponent(i)}&to=${encodeURIComponent(c)}&status=all&limit=5000`,{method:"GET",cache:"no-store",background:!0}),d=Array.isArray(l?.bills)?l.bills:[],u=[],y=[]
for(const t of d){const e=t.id,r=Array.isArray(t.items)?t.items:[],n=Array.isArray(t.payments)?t.payments:[]
for(const t of r)p(t)&&u.push({...t,billId:e,bill_id:t.bill_id??t.billId??e})
for(const t of n)p(t)&&y.push({...t,billId:e,bill_id:t.bill_id??t.billId??e})}const g=await v("bills",d,_)
r(n)
const b=new Date(`${i}T00:00:00.000Z`).getTime(),A=new Date(`${c}T23:59:59.999Z`).getTime()
await e.replaceSyncedSnapshot("bills",g,n,t=>{const e=t.businessDate??t.business_date??t.createdAt??t.created_at,r=new Date(String(e??"")).getTime()
return Number.isFinite(r)&&r>=b&&r<=A}),r(n),o("bills",g),u.length>0&&(r(n),await e.putMany("bill_items",h(u))),y.length>0&&(r(n),await e.putMany("payments",h(y)),r(n),o("payments",h(y)))
const I=await e.getAll("bills")
r(n)
const S=w(I,_)
return await e.removeOrphans("bill_items",S,["bill_id","billId"],n),await e.removeOrphans("payments",S,["bill_id","billId"],n,{removeWhenForeignKeyMissing:!1}),{bills:d.length,billItems:u.length,payments:y.length}}async function j(){const n=t(),s=await a("/inventory",{method:"GET",cache:"no-store",background:!0}),i=Array.isArray(s)?s.map(t=>{const e=t.id??t.productId??t.product_id
return"string"==typeof e?{...t,id:e}:t}).filter(t=>"string"==typeof t.id):[]
if(0===i.length)return 0
const o=await e.getAll("products").catch(()=>[]),c=new Map
for(const t of o)for(const e of g){const r=t[e]
"string"==typeof r&&r&&c.set(r,t)}const l=i.map(t=>({...c.get(String(t.id))??{},...t})),d=await v("products",l,g)
return r(n),await e.putMany("products",d),l.length}async function E(){return D()}async function D(){const n=t(),i=await a("/udhar?limit=5000",{method:"GET",cache:"no-store",background:!0}),o=(Array.isArray(i?.entries)?i.entries:Array.isArray(i?.ledger)?i.ledger:[]).filter(p)
r(n)
const c=await s.customer_ledger.filter(t=>{if(t.tenant_id!==n.tenant_id||t.store_id!==n.store_id)return!1
const e=String(t.sync_status??"synced").toLowerCase()
return!["pending_sync","syncing","failed","conflict","local_only"].includes(e)}).primaryKeys()
return r(n),c.length>0&&await s.customer_ledger.bulkDelete(c),o.length>0&&(r(n),await e.putMany("customer_ledger",o)),o.length}async function H(){const a=t()
await e.init()
let s=null,i=0
const o=await l().catch(()=>({keys:new Set}))
for(let t=0;t<10;t+=1){const t=await d({since:"1970-01-01T00:00:00.000Z",cursor:null,cursors:{products:y,customers:y,bills:y,stockLedger:y,udharLedger:y,suppliers:y,purchaseHistory:s},limit:1e3,background:!0}),n=(Array.isArray(t.purchaseHistory)?t.purchaseHistory.filter(p).map(I):[]).filter(t=>!u(t,o))
n.length>0&&(r(a),await e.putMany("purchase_bills",h(n)),i+=n.length)
const c=p(t.sync)?t.sync:{},l=p(c.entityCursors)?c.entityCursors:{},m="string"==typeof l.purchaseHistory?l.purchaseHistory:null
if(!0!==(p(c.hasMoreByEntity)?c.hasMoreByEntity:{}).purchaseHistory||!m||m===s)break
s=m}return i>0&&(r(a),await c().catch(()=>{}),n({type:"cloud-hydration",action:"purchase-history-import",count:i})),i}async function C(){const e=t(),n=await a("/subscription/current",{method:"GET",cache:"no-store",background:!0})
return p(n)&&(r(e),await i(n)),p(n)?1:0}async function G(){const a=t()
await e.init()
const[s,i,o,l,d,u]=await Promise.all([S("subscription",C),S("products",T),S("customers",M),S("bills",k),S("udharLedger",D),S("purchaseHistory",H)]),y=await S("inventory",j),m=p(l.data)?l.data:{},f={products:"number"==typeof i.data?i.data:0,customers:"number"==typeof o.data?o.data:0,bills:"number"==typeof m.bills?m.bills:0,billItems:"number"==typeof m.billItems?m.billItems:0,payments:"number"==typeof m.payments?m.payments:0,inventoryProducts:"number"==typeof y.data?y.data:0,udharLedger:"number"==typeof d.data?d.data:0,purchaseHistory:"number"==typeof u.data?u.data:0,subscription:"number"==typeof s.data?s.data:0,errors:[s,i,o,l,y,d,u].filter(t=>"string"==typeof t.error).map(({label:t,error:e})=>({label:t,error:e}))}
return r(a),await c().catch(()=>{}),r(a),n({type:"cloud-hydration",action:"direct-import",result:f}),f}export{G as hydrateFromBackendSnapshot,H as hydratePurchaseHistoryFromSyncPull,E as resyncUdharLedgerFromServer}
