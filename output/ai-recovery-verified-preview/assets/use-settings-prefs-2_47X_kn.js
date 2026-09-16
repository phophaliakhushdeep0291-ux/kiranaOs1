import{u as t,a as e}from"./vendor-data-BaHBZjtO.js"
import{J as n,cg as r,ch as a,ci as s,t as i,A as u}from"./index-C-jOBSyf.js"
import{u as c,g as o}from"./queries-BeWwa58r.js"
let p={upiId:"",payeeName:"Artha merchant"}
function l(t,e){p={upiId:"string"==typeof t?.upi?t.upi.trim():"",payeeName:"string"==typeof t?.holder&&t.holder.trim()?t.holder.trim():e?.trim()||"Artha merchant"}}function f(){return p}function m({upiId:t,payeeName:e,amount:n,note:r}){return/^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/.test(t)?!Number.isFinite(n)||n<=0?null:`upi://pay?${new URLSearchParams({pa:t,pn:e||"Merchant",am:n.toFixed(2),cu:"INR",tn:r||"Artha counter payment"}).toString().replace(/\+/g,"%20").replace(/%40/g,"@")}`:null}const d="kirana:settings-prefs:v1",g="kirana:settings-prefs-pending:v1"
function h(t){const{docs:e,...n}=t
return n}function S(){const p=c(),f=t(),[m,S]=e.useState({}),[y,w]=e.useState(!1),v=e.useRef(!1),N=e.useRef(null),b=e.useRef(null),A=e.useRef({})
async function E(t){try{const e=await s({settingsJson:JSON.stringify(h(t))})
return f.setQueryData(o(),e),await n.setSetting("shop",e).catch(()=>{}),b.current===t&&(b.current=null,await n.setSetting(g,null).catch(()=>{})),e}catch{return b.current=t,await n.setSetting(g,t).catch(()=>{}),null}}return e.useEffect(()=>{let t=!0
return n.getSetting(d).then(e=>{t&&(e&&(A.current=e,S(e),e.printer&&r({...a,...e.printer}),l(e.bank,p.data?.name)),w(!0))}),()=>{t=!1}},[]),e.useEffect(()=>{if(v.current)return
const t=p.data?.settingsJson
if(null!=t){v.current=!0
try{const e=JSON.parse(t||"{}")
e&&"object"==typeof e&&(S(t=>{const r={...t,...h(e)}
return A.current=r,n.setSetting(d,r),r}),e.printer&&r({...a,...e.printer}),l(e.bank,p.data?.name))}catch{}}},[p.data?.settingsJson]),e.useEffect(()=>{let t=!0
n.getSetting(g).then(e=>{t&&e&&(b.current=e,E(e))})
const e=()=>{const t=b.current
t&&E(t)}
window.addEventListener("online",e)
const r=window.setInterval(e,3e4)
return()=>{t=!1,window.removeEventListener("online",e),window.clearInterval(r)}},[]),e.useEffect(()=>()=>{N.current&&clearTimeout(N.current),b.current&&E(b.current)},[]),{prefs:m,patch:(t,e={})=>{const s={...A.current,...t}
return A.current=s,b.current=s,S(s),n.setSetting(d,s),n.setSetting(g,s),i(u.SETTINGS_CHANGED,{sections:Object.keys(t).slice(0,12)}),"printer"in t&&s.printer&&r({...a,...s.printer}),"bank"in t&&l(s.bank,p.data?.name),N.current&&clearTimeout(N.current),e.immediate?E(s):(N.current=setTimeout(()=>{E(s)},700),Promise.resolve(null))},hydrated:y,shop:p.data,shopLoading:p.isLoading}}export{m as b,f as g,S as u}
