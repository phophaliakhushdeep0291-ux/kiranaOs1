class e extends Error{constructor(e){super(e),this.name="CartDecodeError"}}function t(t){let r
try{r=(new TextDecoder).decode((e=>{const t=e.replace(/-/g,"+").replace(/_/g,"/"),r=t+"=".repeat((4-t.length%4)%4),n=atob(r),o=new Uint8Array(n.length)
for(let c=0;c<n.length;c++)o[c]=n.charCodeAt(c)
return o})(t.trim()))}catch{throw new e("This QR code is not a valid order.")}const n=r.split("|")
if(n.length<3)throw new e("This QR code is not a valid order.")
const o=n[0],c=n[1],i=n.slice(2).join("|")
if("1"!==o)throw new e(`This order was made with a newer app version (${o}). Please update.`)
const l=[]
if(i)for(const e of i.split(";")){const t=e.lastIndexOf(":")
if(t<=0)continue
const r=e.slice(0,t),n=Number(e.slice(t+1))
!r||!Number.isFinite(n)||n<=0||l.push({productId:r,qty:n})}return{shopCode:c,items:l}}function r(e,t,r={}){const n=r.singleMax??1200,o=r.chunkLen??1e3,c=`${e.replace(/\/$/,"")}/import-order`,i=(e=>{const t=e.items.filter(e=>e.productId&&Number.isFinite(e.qty)&&e.qty>0).map(e=>{return`${e.productId}:${t=e.qty,String(Math.round(1e3*t)/1e3)}`
var t}).join(";"),r=`1|${e.shopCode}|${t}`
return(e=>{let t=""
for(const r of e)t+=String.fromCharCode(r)
return btoa(t).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")})((new TextEncoder).encode(r))})(t),l=`${c}#o=${i}`
if(l.length<=n)return[l]
const s=(globalThis.crypto?.randomUUID?.()??`${Date.now()}${Math.random()}`).replace(/[^a-zA-Z0-9]/g,"").slice(0,8)||"g",a=[]
for(let d=0;d<i.length;d+=o)a.push(i.slice(d,d+o))
const u=a.length
return a.map((e,t)=>`${c}#m=${s}.${t+1}.${u}.${e}`)}function n(e){const r=/[#&]o=([^&]+)/.exec(e)
if(r)try{return{kind:"single",payload:t(decodeURIComponent(r[1]))}}catch{return null}const n=/[#&]m=([^&]+)/.exec(e)
if(n){const e=decodeURIComponent(n[1]).split(".")
if(e.length<4)return null
const[t,r,o]=e,c=e.slice(3).join("."),i=Number(r),l=Number(o)
return t&&c&&Number.isInteger(i)&&Number.isInteger(l)?i<1||l<1||i>l?null:{kind:"part",group:t,index:i,total:l,chunk:c}:null}return null}function o(e,r){let n=""
for(let t=1;t<=r;t++){const r=e[t]
if(null==r)return null
n+=r}try{return t(n)}catch{return null}}export{r as b,n as p,o as r}
