import{a as e}from"./vendor-data-BaHBZjtO.js"
import{t as r,A as t}from"./index-Ci-XYli4.js"
function u(u,n,c){const s=c?.eventType??t.PRODUCT_SEARCH,l=c?.enabled??!0,o=c?.screen,a=e.useRef(null),i=e.useRef(null),d=e.useRef(null),f=e.useRef(n)
f.current=n
const m=e.useCallback(e=>{const t=d.current
t&&(d.current=null,r(s,{query:t.query,results:t.results,selectedProductId:e?.id,selectedProduct:e?.name},{durationMs:t.durationMs,screen:o}))},[s,o])
return e.useEffect(()=>{if(!l)return
const e=u.trim()
if(i.current&&clearTimeout(i.current),d.current&&d.current.query!==e&&m(),e.length<2)return void(a.current=null)
null===a.current&&(a.current=Date.now())
const r=a.current
return i.current=setTimeout(()=>{d.current={query:e,results:f.current,durationMs:Date.now()-r},a.current=null},900),()=>{i.current&&clearTimeout(i.current)}},[u,l,m]),e.useEffect(()=>()=>{i.current&&clearTimeout(i.current),m()},[m]),{notifySelection:e.useCallback((e,t)=>{if(i.current&&clearTimeout(i.current),d.current)return void m({id:e,name:t})
const n=a.current,c=u.trim()
a.current=null,c.length<2||r(s,{query:c,results:f.current,selectedProductId:e,selectedProduct:t},{durationMs:null===n?void 0:Date.now()-n,screen:o})},[m,s,o,u])}}export{u}
