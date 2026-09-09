import{u as t,a as e}from"./vendor-data-BaHBZjtO.js"
import{J as n,cb as r,cc as a,cd as s,t as i,A as u}from"./index-Ci-XYli4.js"
import{u as c,g as o}from"./queries-Cm1QJwBl.js"
let p={upiId:"",payeeName:"Artha merchant"}
function l(t,e){p={upiId:"string"==typeof t?.upi?t.upi.trim():"",payeeName:"string"==typeof t?.holder&&t.holder.trim()?t.holder.trim():e?.trim()||"Artha merchant"}}function d(){return p}function f({upiId:t,payeeName:e,amount:n,note:r}){return/^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9.-]{1,63}$/.test(t)?!Number.isFinite(n)||n<=0?null:`upi://pay?${new URLSearchParams({pa:t,pn:e||"Merchant",am:n.toFixed(2),cu:"INR",tn:r||"Artha counter payment"}).toString().replace(/\+/g,"%20").replace(/%40/g,"@")}`:null}const m="kirana:settings-prefs:v1",g="kirana:settings-prefs-pending:v1"
function h(t){const{docs:e,...n}=t
return n}function S(){const p=c(),d=t(),[f,S]=e.useState({}),[y,w]=e.useState(!1),b=e.useRef(!1),v=e.useRef(null),N=e.useRef(null),A=e.useRef({})
async function E(t){try{const e=await s({settingsJson:JSON.stringify(h(t))})
return d.setQueryData(o(),e),await n.setSetting("shop",e).catch(()=>{}),N.current===t&&(N.current=null,await n.setSetting(g,null).catch(()=>{})),e}catch{return N.current=t,await n.setSetting(g,t).catch(()=>{}),null}}return e.useEffect(()=>{let t=!0
return n.getSetting(m).then(e=>{t&&(e&&(A.current=e,S(e),e.printer&&r({...a,...e.printer}),l(e.bank,p.data?.name)),w(!0))}),()=>{t=!1}},[]),e.useEffect(()=>{if(b.current)return
const t=p.data?.settingsJson
if(null!=t){b.current=!0
try{const e=JSON.parse(t||"{}")
e&&"object"==typeof e&&(S(t=>{const r={...t,...h(e)}
return A.current=r,n.setSetting(m,r),r}),e.printer&&r({...a,...e.printer}),l(e.bank,p.data?.name))}catch{}}},[p.data?.settingsJson]),e.useEffect(()=>{let t=!0
n.getSetting(g).then(e=>{t&&e&&(N.current=e,E(e))})
const e=()=>{const t=N.current
t&&E(t)}
window.addEventListener("online",e)
const r=window.setInterval(e,3e4)
return()=>{t=!1,window.removeEventListener("online",e),window.clearInterval(r)}},[]),e.useEffect(()=>()=>{v.current&&clearTimeout(v.current),N.current&&E(N.current)},[]),{prefs:f,patch:(t,e={})=>{const s={...A.current,...t}
return A.current=s,N.current=s,S(s),n.setSetting(m,s),n.setSetting(g,s),i(u.SETTINGS_CHANGED,{sections:Object.keys(t).slice(0,12)}),"printer"in t&&s.printer&&r({...a,...s.printer}),"bank"in t&&l(s.bank,p.data?.name),v.current&&clearTimeout(v.current),e.immediate?E(s):(v.current=setTimeout(()=>{E(s)},700),Promise.resolve(null))},hydrated:y,shop:p.data,shopLoading:p.isLoading}}export{f as b,d as g,S as u}
