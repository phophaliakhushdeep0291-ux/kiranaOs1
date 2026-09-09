import{g as t}from"./index-CYG8yywH.js"
class r extends Error{constructor(t="This shop is not accepting online orders right now."){super(t),this.name="CatalogUnavailableError"}}const e="kirana:customer-catalog:",o={read(t){try{const r=localStorage.getItem(`${e}${t}`)
return r?JSON.parse(r):null}catch{return null}},write(t,r){try{localStorage.setItem(`${e}${t}`,JSON.stringify(r))}catch{}},remove(t){try{localStorage.removeItem(`${e}${t}`)}catch{}}}
function a(t,r){return r?`${t}:location:${r}`:t}function n(t,r){return o.read(a(t,r))}async function c(e,o,a){const n=new URLSearchParams
o&&n.set("locationId",o),a&&n.set("table",a)
const c=n.toString()?`?${n}`:"",s=`${t()}/public/shops/${encodeURIComponent(e)}/catalog${c}`
let i
try{i=await fetch(s,{headers:{Accept:"application/json"}})}catch(u){throw new Error("Could not reach the shop. Check your internet and try again.",{cause:u})}if(404===i.status)throw new r
if(!i.ok)throw new Error(`Catalog request failed (${i.status}).`)
const l=await i.json()
if(!l.data)throw new Error("Catalog response was malformed.")
return{...l.data,cachedAt:(new Date).toISOString()}}async function s(r,e,o,a){const n=`${t()}/public/shops/${encodeURIComponent(r)}/orders`
let c
try{const t={"Content-Type":"application/json",Accept:"application/json"}
a&&(t["Idempotency-Key"]=a),c=await fetch(n,{method:"POST",headers:t,body:JSON.stringify({...e,items:o,idempotencyKey:a})})}catch(i){throw new Error("Could not reach the shop. Check your internet and try again.",{cause:i})}const s=await c.json().catch(()=>({}))
if(!c.ok||!s.data)throw new Error(s.error||`Could not place the order (${c.status}).`)
return s.data}class i extends Error{constructor(t="We couldn't find that order."){super(t),this.name="OrderNotFoundError"}}async function l(r,e){const o=`${t()}/public/shops/${encodeURIComponent(r)}/orders/${encodeURIComponent(e)}`
let a
try{a=await fetch(o,{headers:{Accept:"application/json"}})}catch(c){throw new Error("Could not reach the shop. Check your internet and try again.",{cause:c})}if(404===a.status)throw new i
if(!a.ok)throw new Error(`Order status request failed (${a.status}).`)
const n=await a.json()
if(!n.data)throw new Error("Order status response was malformed.")
return n.data}const u="kirana:customer-order:my:"
function h(t,r){try{localStorage.setItem(`${u}${t}`,JSON.stringify({orderId:r,placedAt:(new Date).toISOString()}))}catch{}}function d(t){try{const r=localStorage.getItem(`${u}${t}`)
if(!r)return null
const e=JSON.parse(r)
return e?.orderId?e:null}catch{return null}}function p(t){try{localStorage.removeItem(`${u}${t}`)}catch{}}async function w(t,e={},n,s){const i=e.fetcher??c,l=e.storage??o
try{const r=await i(t,n,s)
return l.write(a(t,n),r),{catalog:r,source:"network"}}catch(u){if(u instanceof r)throw l.remove(a(t,n)),u
const e=l.read(a(t,n))
if(e)return{catalog:e,source:"cache"}
throw u}}export{r as C,i as O,n as a,h as b,l as c,p as f,w as l,d as r,s}
