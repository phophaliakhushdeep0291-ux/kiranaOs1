import{a as e,j as t}from"./vendor-data-BaHBZjtO.js"
import{k as a,K as s,B as n,J as i,l as r}from"./index-DbQMpL2c.js"
import{b as d,s as l}from"./restaurant-api-B8oIU1ZM.js"
import{b4 as o,bu as c,ax as u,U as p}from"./vendor-ui-CIi-vqR6.js"
import{C as m}from"./chip-tones-cbbqDYQQ.js"
import{u as g,l as b}from"./api-Bo0oKdbL.js"
import{u as f}from"./queries-ZEK2KQ7v.js"
import{T as x,a as h}from"./table-store-DcXUw2Ue.js"
import{H as w,n as y,u as j,B as v,w as N}from"./open-bills-Jn_xogou.js"
import{d as k}from"./billing-calculations-DbfnqEn3.js"
function S(){const{t:i}=a(),{toast:r}=s(),[u,p]=e.useState(null),[m,g]=e.useState([]),[b,f]=e.useState(!1),x=e.useCallback(async()=>{try{const e=await d()
g(e.filter(e=>"pending"===e.status||"acknowledged"===e.status)),f(!1)}catch{f(!0)}},[])
return e.useEffect(()=>{x()
const e=window.setInterval(()=>{x()},5e3),t=()=>{x()}
return window.addEventListener("focus",t),()=>{window.clearInterval(e),window.removeEventListener("focus",t)}},[x]),0!==m.length||b?t.jsxs("section",{className:"rounded-2xl border border-amber-300 bg-amber-50 p-3","data-testid":"guest-requests-strip",children:[b?t.jsxs("div",{role:"alert",className:"mb-2 rounded-lg border border-amber-400 bg-white px-3 py-2 text-xs font-semibold text-amber-900",children:[i("restaurant.guest.requestsStale")," ",t.jsx("button",{type:"button",className:"ml-1 min-h-11 underline",onClick:()=>{x()},children:i("restaurant.guest.retryNow")})]}):null,m.length>0?t.jsxs(t.Fragment,{children:[t.jsx("h2",{className:"mb-2 text-xs font-black uppercase tracking-wider text-amber-900",children:i("restaurant.guest.requests")}),t.jsx("div",{className:"flex flex-wrap gap-2",children:m.map(e=>t.jsxs("div",{className:"flex min-w-64 flex-1 items-center gap-2 rounded-xl bg-white p-3 shadow-sm",children:["bill"===e.type?t.jsx(o,{size:18}):t.jsx(c,{size:18}),t.jsxs("div",{className:"min-w-0 flex-1",children:[t.jsxs("p",{className:"text-sm font-bold",children:[e.tableName," · ",i("bill"===e.type?"restaurant.guest.bill":"restaurant.guest.waiter")]}),e.reason?t.jsx("p",{className:"truncate text-xs text-slate-500",children:e.reason}):null]}),t.jsx(n,{size:"sm",disabled:null!==u,onClick:async()=>{p(e.id)
try{await l(e.id,"pending"===e.status?"acknowledged":"completed"),await x()}catch{r({title:i("restaurant.guest.requestFailed"),variant:"destructive"})}finally{p(null)}},children:i("pending"===e.status?"restaurant.guest.acknowledge":"restaurant.guest.done")})]},e.id))})]}):null]}):null}const I="kirana-os:restaurant:accepted-guest-orders:v1",$="kirana-os:restaurant:pending-guest-orders:v1"
async function q(){const e=await i.getSetting($)
return Object.values(e??{}).map(e=>e.order)}async function A(){const e=await i.getSetting(I)
return Array.isArray(e)?e:[]}function C(e,t){const a=new Set(t)
return e.filter(e=>"dine_in"===e.fulfillmentType&&Boolean(e.tableId)).filter(e=>"new"===e.status).filter(e=>!a.has(e.id)).sort((e,t)=>e.createdAt.localeCompare(t.createdAt))}function E(e,t){const a=new Map
for(const i of t){a.set(i.id,i)
const e=i.serverId
e&&!a.has(e)&&a.set(e,i)}const s=[],n=[]
for(const[i,r]of(e.items??[]).entries()){const t=a.get(r.productId)
if(!t){n.push(r.name||r.productId)
continue}const d=Number(r.qty)>0?Number(r.qty):1,l=r.variation?.unitCode?(t.sellingUnits??[]).find(e=>e.unitCode===r.variation?.unitCode&&!1!==e.isActive):void 0
if(r.variation&&!l){n.push(`${r.name}: portion unavailable`)
continue}const o=(r.addons??[]).map(e=>({...e})),c=o.reduce((e,t)=>e+t.price*(t.quantity??1),0),u=Number(r.basePrice??r.variation?.price??r.price-c)
!Number.isFinite(u)||u<0||!Number.isFinite(Number(r.qty))||Number(r.qty)<=0?n.push(`${r.name}: invalid price or quantity`):s.push({product:t,quantity:d,rate:u,manualRate:!0,guestSnapshot:!0,guestOrderId:e.id,guestOrderLineId:r.lineId??`${e.id}-${i}`,unit:r.unit||l?.name||t.rateUnit||t.displayUnit||"piece",sellingUnit:l,addons:o,note:[r.note,e.note].filter(Boolean).join(" — ")||void 0})}return{lines:s,skipped:n}}function O(e,t){const a=[...e]
for(const s of t){const e=k(s),t=a.findIndex(t=>k(t)===e)
t>=0?a[t]={...a[t],quantity:a[t].quantity+s.quantity}:a.push(s)}return a}async function F(e){const t=await i.getSetting(w)??[],a=await i.getSetting(x)??{},s=await i.getSetting(v)
if(a[e]&&s?.activeBillId===a[e])throw new Error("Park this table's active bill before accepting more food. Keep billing closed in other tabs.")
if(N(t,{id:a[e]??"new-guest-bill"}))throw new Error("The open-bill limit is reached. Settle an existing bill before accepting another table.")}function L({onAccepted:d,readOnly:l=!1}){const{toast:o}=s(),{t:c}=a(),v=f(),[N,k]=e.useState([]),[S,L]=e.useState([]),[R,T]=e.useState(null),[U,z]=e.useState(!1),B=e.useCallback(async()=>{try{const[e,t,a,s]=await Promise.all([b("new"),A(),h(),q()])
L(a)
const n=new Map([...C(e.orders??[],t),...s].map(e=>[e.id,e]))
k([...n.values()]),z(!1)}catch{z(!0)}},[])
return e.useEffect(()=>{const e=()=>{B()}
e()
const t=window.setInterval(e,2e4),a=e
return window.addEventListener("focus",a),()=>{window.clearInterval(t),window.removeEventListener("focus",a)}},[B,o,c]),0!==N.length||U?t.jsxs("section",{className:"space-y-2","data-testid":"guest-orders-strip",children:[U?t.jsxs("div",{role:"alert",className:"rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900",children:[c("restaurant.guest.ordersStale")," ",t.jsx("button",{type:"button",className:"ml-2 min-h-11 underline",onClick:()=>{B()},children:c("restaurant.guest.retryNow")})]}):null,N.length>0?t.jsxs(t.Fragment,{children:[t.jsxs("h2",{className:"flex items-center gap-2 text-[12px] font-black uppercase tracking-wider text-[#64748b]",children:[t.jsx(u,{size:13})," ",c("restaurant.guest.ordered"),t.jsx("span",{className:r("rounded-full px-2 py-0.5 text-[10px]",m.violet),children:N.length})]}),t.jsx("div",{className:"grid gap-2 md:grid-cols-2 xl:grid-cols-3",children:N.map(e=>t.jsxs("article",{className:"rounded-2xl border border-[#ddd6fe] bg-[#faf8ff] p-3.5",children:[t.jsxs("div",{className:"flex items-start justify-between gap-2",children:[t.jsx("div",{className:"font-display text-[16px] font-black text-[var(--brand-ink)]",children:e.tableName??"Table"}),t.jsx("span",{className:r("rounded-full px-2 py-0.5 text-[10px] font-black uppercase",m.violet),children:c("restaurant.guest.fromTheQr")})]}),t.jsx("ul",{className:"mt-2 space-y-1",children:e.items.map(a=>t.jsxs("li",{className:"flex justify-between gap-2 text-[13px]",children:[t.jsx("span",{className:"min-w-0 truncate font-bold text-[var(--brand-ink)]",children:a.name}),t.jsxs("span",{className:"shrink-0 font-black tabular-nums",children:["×",a.qty]})]},`${e.id}-${a.productId}`))}),e.note?t.jsx("p",{className:"mt-1.5 rounded-lg bg-[#fff7ed] px-2 py-1 text-[11px] font-semibold text-[#9a3412]",children:e.note}):null,e.promisedSlot?t.jsxs("p",{className:"mt-1.5 rounded-lg bg-blue-50 px-2 py-1 text-[11px] font-semibold text-blue-800",children:[c("restaurant.guest.scheduled")," ",e.promisedSlot]}):null,l?t.jsx("p",{className:"mt-3 text-xs text-[#52627e]",children:c("restaurant.guest.awaitingCounter")}):t.jsxs(n,{size:"sm",className:"mt-3 h-9 w-full gap-1.5 rounded-[8px] text-[12px] font-black",disabled:null!==R,"data-testid":`accept-guest-order-${e.id}`,onClick:()=>{(async e=>{if(l)return
const t=S.find(t=>t.id===e.tableId)??S.find(t=>t.name===e.tableName)
if(t){T(e.id)
try{const a=await(async(e,t,a)=>{const s=await i.transaction(["settings"],async s=>{if((await A()).includes(e.id))return null
const n=await i.getSetting($)??{}
if(await F(t.id),n[e.id])return n[e.id]
const{lines:r,skipped:d}=E(e,a)
if(!r.length||d.length)throw new Error(`Order not accepted. Refresh the catalogue: ${d.join(", ")||"no items available"}.`)
const l={key:crypto.randomUUID(),order:e,table:t,lines:r}
return await s.setSetting($,{...n,[e.id]:l}),l})
if(!s)return{billId:"",added:0,skipped:[]}
let n
try{n=await g(e.id,{status:"accepted",acceptanceKey:s.key})}catch(d){const t=d
throw 409===t.status&&"ORDER_ALREADY_CLAIMED"===t.data?.code&&await i.transaction(["settings"],async t=>{const a=await i.getSetting($)??{}
a[e.id]?.key===s.key&&(delete a[e.id],await t.setSetting($,a))}),d}if(n.id!==s.order.id||n.tableId!==s.order.tableId||"accepted"!==n.status||!Array.isArray(n.items))throw new Error("Could not confirm the accepted order. Refresh and retry before adding food.")
const r=E(n,a)
if(!r.lines.length||r.skipped.length)throw new Error(`Order accepted but not added. Refresh the catalogue and retry: ${r.skipped.join(", ")||"no items available"}.`)
return i.transaction(["settings"],async t=>{const a=await A()
if(a.includes(e.id))return{billId:"",added:0,skipped:[]}
const n=await i.getSetting(w)??[],d=await i.getSetting(x)??{},l=await i.getSetting($)??{},o=s.table
await F(o.id)
const c=n.find(e=>e.id===d[o.id]),u=c?{...c,tableId:o.id,cart:O(c.cart??[],r.lines)}:{id:y(),label:`${o.name} • table`,createdAt:(new Date).toISOString(),cart:r.lines,selectedCustomerId:"walk_in",customerName:o.name,tableId:o.id}
return delete l[e.id],await t.setSetting(w,j(n,u)),await t.setSetting(x,{...d,[o.id]:u.id}),await t.setSetting(I,[e.id,...a].slice(0,500)),await t.setSetting($,l),{billId:u.id,added:r.lines.length,skipped:[]}})})(e,t,v.data??[])
await B(),d?.(),o({title:`Added to ${t.name}`,description:a.skipped.length>0?`${a.added} item${1===a.added?"":"s"} added. Not in your catalogue: ${a.skipped.join(", ")}.`:`${a.added} item${1===a.added?" is":"s are"} on the table's bill. Fire from the Tables screen.`})}catch(a){o({title:c("restaurant.guest.acceptFailed"),description:`${a instanceof Error?a.message:""} ${c("restaurant.guest.retry")}`,variant:"destructive"})}finally{T(null)}}else o({title:`No table called ${e.tableName??"that"} on this floor`,description:c("restaurant.guest.noTableHelp"),variant:"destructive"})})(e)},children:[t.jsx(p,{size:13})," ",R===e.id?"Adding…":`Add to ${e.tableName??"table"}`]})]},e.id))})]}):null]}):null}export{L as G,S as a}
