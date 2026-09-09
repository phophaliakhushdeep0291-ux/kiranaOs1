import{a as e,j as t}from"./vendor-data-BaHBZjtO.js"
import{k as n}from"./index-DtTTo2f-.js"
function r(t,{defaultWidth:n=420,min:r=360,max:o=760}={}){const[s,a]=e.useState(()=>((e,t,n,r)=>{try{const o=Number(localStorage.getItem(e))
return Number.isFinite(o)&&o>=n?Math.min(o,r):t}catch{return t}})(t,n,r,o)),[u,c]=e.useState(!1),[i,l]=e.useState(()=>"undefined"!=typeof window&&window.matchMedia("(min-width: 1024px)").matches),d=e.useRef(null)
e.useEffect(()=>{if("undefined"==typeof window)return
const e=window.matchMedia("(min-width: 1024px)"),t=()=>l(e.matches)
return l(e.matches),e.addEventListener("change",t),()=>e.removeEventListener("change",t)},[]),e.useEffect(()=>{try{localStorage.setItem(t,String(Math.round(s)))}catch{}},[t,s]),e.useEffect(()=>()=>{null!==d.current&&cancelAnimationFrame(d.current)},[])
const m=e.useCallback(e=>{e.preventDefault()
const t=e.clientX,n=s
let u=t
const i=e=>Math.min(o,Math.max(r,n-(e-t)))
c(!0)
const l=document.body.style.cursor,m=document.body.style.userSelect
document.body.style.cursor="col-resize",document.body.style.userSelect="none"
const w=e=>{u=e.clientX,null===d.current&&(d.current=requestAnimationFrame(()=>{d.current=null,a(i(u))}))},h=()=>{null!==d.current&&(cancelAnimationFrame(d.current),d.current=null),a(i(u)),c(!1),document.body.style.cursor=l,document.body.style.userSelect=m,window.removeEventListener("mousemove",w),window.removeEventListener("mouseup",h)}
window.addEventListener("mousemove",w),window.addEventListener("mouseup",h)},[s,r,o])
return{width:s,isResizing:u,isDesktop:i,onResizeStart:m}}function o({onResizeStart:e}){const{t:r}=n()
return t.jsx("div",{onMouseDown:e,title:r("billing.summary.dragToResize"),className:"group absolute inset-y-0 left-0 z-10 hidden w-2.5 -translate-x-1/2 cursor-col-resize lg:block",children:t.jsx("span",{className:"mx-auto block h-full w-1 bg-transparent transition-colors group-hover:bg-[var(--brand)]/30"})})}export{o as P,r as u}
