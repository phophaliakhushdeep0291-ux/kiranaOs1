import{a as e}from"./vendor-data-BaHBZjtO.js"
import{a as t,t as n,A as r,s as i,f as s}from"./index-DtTTo2f-.js"
function o(o,u,d){const a=e.useRef(!1),c=e.useRef(u),f=e.useRef(d)
c.current=u,f.current=d,e.useEffect(()=>{if(o)return t(o),a.current||(a.current=!0,n(r.ONLINE_SESSION_START,{})),()=>t(null)},[o]),e.useEffect(()=>{if(!o)return
const e=()=>{const e=c.current
!f.current&&e.itemCount>0&&n(r.ONLINE_CART_ABANDONED,{itemCount:e.itemCount,total:e.total,productIds:e.productIds}),n(r.ONLINE_SESSION_END,{ordered:f.current},{durationMs:i()}),s()},t=()=>{"hidden"===document.visibilityState&&e()}
return window.addEventListener("pagehide",e),window.addEventListener("visibilitychange",t),()=>{window.removeEventListener("pagehide",e),window.removeEventListener("visibilitychange",t)}},[o])}const u=new Set
function d(t,i,s=!0){return e.useCallback(e=>{if(!s||!e||u.has(t))return
if("undefined"==typeof IntersectionObserver)return
const o=new IntersectionObserver(e=>{for(const s of e)if(s.isIntersecting){if(u.has(t))break
u.add(t),n(r.ONLINE_PRODUCT_VIEW,{productId:t,productName:i}),o.disconnect()
break}},{threshold:.5})
o.observe(e)},[t,i,s])}export{o as a,d as u}
