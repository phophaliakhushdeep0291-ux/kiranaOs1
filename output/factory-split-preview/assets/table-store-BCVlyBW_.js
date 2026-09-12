import{J as t}from"./index-CYG8yywH.js"
import{d as e,e as n,c as a}from"./billing-calculations-DrJWXY6g.js"
const r="kirana-os:restaurant:floor-plan:v1",i="kirana-os:restaurant:table-bills:v1",o=["new","preparing","ready","served"]
function s(t){const e=o.indexOf(t)
return e<0||e===o.length-1?null:o[e+1]}function c(){return`table-${Date.now()}-${Math.random().toString(36).slice(2,6)}`}async function u(){const e=await t.getSetting(r).catch(()=>null)
return Array.isArray(e)?e:[...Array.from({length:6},(t,e)=>({id:`table-${e+1}`,name:`T${e+1}`,section:"Dining",seats:4})),{id:"table-7",name:"T7",section:"Terrace",seats:6},{id:"table-8",name:"T8",section:"Terrace",seats:2},{id:"counter-1",name:"Takeaway 1",section:"Counter",seats:0}]}function l(e){return t.setSetting(r,e).catch(()=>{})}async function d(){const e=await t.getSetting(i).catch(()=>null)
return e&&"object"==typeof e&&!Array.isArray(e)?e:{}}function f(e){return t.setSetting(i,e).catch(()=>{})}function g(t,e,n){const a=new Map(e.map(t=>[t.id,t])),r={}
for(const[i,o]of Object.entries(t)){const t=a.get(o)
t&&(0===(t.cart?.length??0)&&o!==n||(r[i]=o))}return r}function m(t,e){const n=e?.activeBillId
return n?t.map(t=>t.id===n?{...t,...e,id:t.id}:t):t}function p(t){const e=t.product?.name??"Item",n=t.sellingUnit?.unitCode
return n&&n!==t.unit?`${e} (${n})`:e}function b(t,a){const r=new Map
for(const e of a)for(const t of e.lines)r.set(t.key,(r.get(t.key)??0)+t.qty)
const i=[]
for(const o of t??[]){const t=e(o),a=(Number(o.quantity)||0)-(r.get(t)??0)
a<=1e-4||i.push({guestOrderId:o.guestOrderId,guestOrderLineId:o.guestOrderLineId,key:t,name:p(o),qty:Math.round(1e3*a)/1e3,unit:o.unit??"piece",note:[n(o.addons),o.note].filter(Boolean).join(" · ")||void 0})}return i}function y(t,e,n,r){const i=new Map(e.map(t=>[t.id,t]))
return t.map(t=>{const e=i.get(n[t.id]??"")??null,o=(e?r.filter(t=>t.billId===e.id):[]).sort((t,e)=>e.createdAt.localeCompare(t.createdAt))
return{table:t,bill:e,items:e?.cart?.length??0,runningTotal:(s=e?.cart,(s??[]).reduce((t,e)=>t+a(e),0)),openedAt:e?.createdAt??null,pendingKotLines:e?b(e.cart,o):[],tickets:o}
var s})}function h(t){return t.reduce((t,e)=>Math.max(t,e.ticketNo||0),0)+1}function w(t,e,n,a,r=new Date){return{id:`kot-${r.getTime()}-${Math.random().toString(36).slice(2,6)}`,ticketNo:h(a),tableId:t.id,tableName:t.name,billId:e,createdAt:r.toISOString(),status:"new",lines:n}}function A(t,e=Date.now()){const n=Date.parse(t.createdAt)
return Number.isFinite(n)?Math.max(0,Math.floor((e-n)/6e4)):0}export{o as K,i as T,u as a,l as b,y as c,w as d,s as e,d as l,c as n,b as p,g as r,f as s,A as t,m as w}
