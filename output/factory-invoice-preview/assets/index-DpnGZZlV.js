import{a as e,j as o}from"./vendor-data-BaHBZjtO.js"
import{bm as r,bn as t,ba as n,bg as a,b$ as s,b7 as u,bk as c,c0 as i}from"./index-DtTTo2f-.js"
import{u as l}from"./index-CxWW_46C.js"
var f="rovingFocusGroup.onEntryFocus",d={bubbles:!1,cancelable:!0},p="RovingFocusGroup",[v,b,m]=s(p),[w,g]=a(p,[m]),[F,I]=w(p),h=e.forwardRef((e,r)=>o.jsx(v.Provider,{scope:e.__scopeRovingFocusGroup,children:o.jsx(v.Slot,{scope:e.__scopeRovingFocusGroup,children:o.jsx(R,{...e,ref:r})})}))
h.displayName=p
var R=e.forwardRef((r,a)=>{const{__scopeRovingFocusGroup:s,orientation:v,loop:m=!1,dir:w,currentTabStopId:g,defaultCurrentTabStopId:I,onCurrentTabStopIdChange:h,onEntryFocus:R,preventScrollOnEntryFocus:y=!1,...S}=r,x=e.useRef(null),A=u(a,x),E=l(w),[j,D]=c({prop:g,defaultProp:I??null,onChange:h,caller:p}),[C,_]=e.useState(!1),k=i(R),G=b(s),K=e.useRef(!1),[L,P]=e.useState(0)
return e.useEffect(()=>{const e=x.current
if(e)return e.addEventListener(f,k),()=>e.removeEventListener(f,k)},[k]),o.jsx(F,{scope:s,orientation:v,dir:E,loop:m,currentTabStopId:j,onItemFocus:e.useCallback(e=>D(e),[D]),onItemShiftTab:e.useCallback(()=>_(!0),[]),onFocusableItemAdd:e.useCallback(()=>P(e=>e+1),[]),onFocusableItemRemove:e.useCallback(()=>P(e=>e-1),[]),children:o.jsx(t.div,{tabIndex:C||0===L?-1:0,"data-orientation":v,...S,ref:A,style:{outline:"none",...r.style},onMouseDown:n(r.onMouseDown,()=>{K.current=!0}),onFocus:n(r.onFocus,e=>{const o=!K.current
if(e.target===e.currentTarget&&o&&!C){const o=new CustomEvent(f,d)
if(e.currentTarget.dispatchEvent(o),!o.defaultPrevented){const e=G().filter(e=>e.focusable)
T([e.find(e=>e.active),e.find(e=>e.id===j),...e].filter(Boolean).map(e=>e.ref.current),y)}}K.current=!1}),onBlur:n(r.onBlur,()=>_(!1))})})}),y="RovingFocusGroupItem",S=e.forwardRef((a,s)=>{const{__scopeRovingFocusGroup:u,focusable:c=!0,active:i=!1,tabStopId:l,children:f,...d}=a,p=r(),m=l||p,w=I(y,u),g=w.currentTabStopId===m,F=b(u),{onFocusableItemAdd:h,onFocusableItemRemove:R,currentTabStopId:S}=w
return e.useEffect(()=>{if(c)return h(),()=>R()},[c,h,R]),o.jsx(v.ItemSlot,{scope:u,id:m,focusable:c,active:i,children:o.jsx(t.span,{tabIndex:g?0:-1,"data-orientation":w.orientation,...d,ref:s,onMouseDown:n(a.onMouseDown,e=>{c?w.onItemFocus(m):e.preventDefault()}),onFocus:n(a.onFocus,()=>w.onItemFocus(m)),onKeyDown:n(a.onKeyDown,e=>{if("Tab"===e.key&&e.shiftKey)return void w.onItemShiftTab()
if(e.target!==e.currentTarget)return
const o=((e,o,r)=>{const t=((e,o)=>"rtl"!==o?e:"ArrowLeft"===e?"ArrowRight":"ArrowRight"===e?"ArrowLeft":e)(e.key,r)
return"vertical"===o&&["ArrowLeft","ArrowRight"].includes(t)||"horizontal"===o&&["ArrowUp","ArrowDown"].includes(t)?void 0:x[t]})(e,w.orientation,w.dir)
if(void 0!==o){if(e.metaKey||e.ctrlKey||e.altKey||e.shiftKey)return
e.preventDefault()
let n=F().filter(e=>e.focusable).map(e=>e.ref.current)
if("last"===o)n.reverse()
else if("prev"===o||"next"===o){"prev"===o&&n.reverse()
const a=n.indexOf(e.currentTarget)
n=w.loop?(t=a+1,(r=n).map((e,o)=>r[(t+o)%r.length])):n.slice(a+1)}setTimeout(()=>T(n))}var r,t}),children:"function"==typeof f?f({isCurrentTabStop:g,hasTabStop:null!=S}):f})})})
S.displayName=y
var x={ArrowLeft:"prev",ArrowUp:"prev",ArrowRight:"next",ArrowDown:"next",PageUp:"first",Home:"first",PageDown:"last",End:"last"}
function T(e,o=!1){const r=document.activeElement
for(const t of e){if(t===r)return
if(t.focus({preventScroll:o}),document.activeElement!==r)return}}var A=h,E=S
export{E as I,A as R,g as c}
