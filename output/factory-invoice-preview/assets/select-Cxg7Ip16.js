import{j as e,a as t}from"./vendor-data-BaHBZjtO.js"
import{b7 as n,bY as o,bn as r,bk as a,bm as l,bl as s,bZ as i,bo as c,ba as d,br as u,bq as p,b_ as f,bp as m,b$ as h,c0 as v,bg as x,bs as g,bv as w,bt as y,bw as b,bx as S,bu as C,by as j,bz as N,l as _}from"./index-DtTTo2f-.js"
import{u as R}from"./index-CxWW_46C.js"
import{u as P}from"./index-DLkqWn8u.js"
import{O as I,aZ as T,bh as k}from"./vendor-ui-CIi-vqR6.js"
function D(e,[t,n]){return Math.min(n,Math.max(t,e))}var E=[" ","Enter","ArrowUp","ArrowDown"],M=[" ","Enter"],O="Select",[L,H,A]=h(O),[V]=x(O,[A,m]),B=m(),[F,K]=V(O),[W,z]=V(O)
function q(n){const{__scopeSelect:o,children:r,open:i,defaultOpen:c,onOpenChange:d,value:u,defaultValue:p,onValueChange:f,dir:m,name:h,autoComplete:v,disabled:x,required:g,form:w,internal_do_not_use_render:y}=n,b=B(o),[S,C]=t.useState(null),[j,N]=t.useState(null),[_,P]=t.useState(!1),I=R(m),[T,k]=a({prop:i,defaultProp:c??!1,onChange:d,caller:O}),[D,E]=a({prop:u,defaultProp:p,onChange:f,caller:O}),M=t.useRef(null),H=!S||!!w||!!S.closest("form"),[A,V]=t.useState(new Set),K=l(),z=Array.from(A).map(e=>e.props.value).join(";"),q=t.useCallback(e=>{V(t=>new Set(t).add(e))},[]),U=t.useCallback(e=>{V(t=>{const n=new Set(t)
return n.delete(e),n})},[]),Y={required:g,trigger:S,onTriggerChange:C,valueNode:j,onValueNodeChange:N,valueNodeHasChildren:_,onValueNodeHasChildrenChange:P,contentId:K,value:D,onValueChange:E,open:T,onOpenChange:k,dir:I,triggerPointerDownPosRef:M,disabled:x,name:h,autoComplete:v,form:w,nativeOptions:A,nativeSelectKey:z,isFormControl:H}
return e.jsx(s,{...b,children:e.jsx(F,{scope:o,...Y,children:e.jsx(L.Provider,{scope:o,children:e.jsx(W,{scope:o,onNativeOptionAdd:q,onNativeOptionRemove:U,children:Ae(y)?y(Y):r})})})})}q.displayName="SelectProvider"
var U=t=>{const{__scopeSelect:n,children:o,...r}=t
return e.jsx(q,{__scopeSelect:n,...r,internal_do_not_use_render:({isFormControl:t})=>e.jsxs(e.Fragment,{children:[o,t?e.jsx(He,{__scopeSelect:n}):null]})})}
U.displayName=O
var Y="SelectTrigger",Z=t.forwardRef((o,a)=>{const{__scopeSelect:l,disabled:s=!1,...i}=o,u=B(l),p=K(Y,l),f=p.disabled||s,m=n(a,p.onTriggerChange),h=H(l),v=t.useRef("touch"),[x,g,w]=Be(e=>{const t=h().filter(e=>!e.disabled),n=t.find(e=>e.value===p.value),o=Fe(t,e,n)
void 0!==o&&p.onValueChange(o.value)}),y=e=>{f||(p.onOpenChange(!0),w()),e&&(p.triggerPointerDownPosRef.current={x:Math.round(e.pageX),y:Math.round(e.pageY)})}
return e.jsx(c,{asChild:!0,...u,children:e.jsx(r.button,{type:"button",role:"combobox","aria-controls":p.open?p.contentId:void 0,"aria-expanded":p.open,"aria-required":p.required,"aria-autocomplete":"none",dir:p.dir,"data-state":p.open?"open":"closed",disabled:f,"data-disabled":f?"":void 0,"data-placeholder":Ve(p.value)?"":void 0,...i,ref:m,onClick:d(i.onClick,e=>{e.currentTarget.focus(),"mouse"!==v.current&&y(e)}),onPointerDown:d(i.onPointerDown,e=>{v.current=e.pointerType
const t=e.target
t.hasPointerCapture(e.pointerId)&&t.releasePointerCapture(e.pointerId),0===e.button&&!1===e.ctrlKey&&"mouse"===e.pointerType&&(y(e),e.preventDefault())}),onKeyDown:d(i.onKeyDown,e=>{const t=""!==x.current
e.ctrlKey||e.altKey||e.metaKey||1!==e.key.length||g(e.key),t&&" "===e.key||E.includes(e.key)&&(y(),e.preventDefault())})})})})
Z.displayName=Y
var X="SelectValue",$=t.forwardRef((a,l)=>{const{__scopeSelect:s,className:i,style:c,children:d,placeholder:u="",...p}=a,f=K(X,s),{onValueNodeHasChildrenChange:m}=f,h=void 0!==d,v=n(l,f.onValueNodeChange)
o(()=>{m(h)},[m,h])
const x=Ve(f.value)
return e.jsx(r.span,{...p,asChild:!x&&p.asChild,ref:v,style:{pointerEvents:"none"},children:e.jsx(t.Fragment,{children:x?u:d},x?"placeholder":"value")})})
$.displayName=X
var G=t.forwardRef((t,n)=>{const{__scopeSelect:o,children:a,...l}=t
return e.jsx(r.span,{"aria-hidden":!0,...l,ref:n,children:a||"▼"})})
G.displayName="SelectIcon"
var J="SelectPortal",[Q,ee]=V(J,{forceMount:void 0}),te=t=>{const{__scopeSelect:n,forceMount:o,...r}=t
return e.jsx(Q,{scope:t.__scopeSelect,forceMount:o,children:e.jsx(u,{asChild:!0,...r})})}
te.displayName=J
var ne="SelectContent",oe=t.forwardRef((n,r)=>{const a=ee(ne,n.__scopeSelect),{forceMount:l=a.forceMount,...s}=n,i=K(ne,n.__scopeSelect),[c,d]=t.useState()
return o(()=>{d(new DocumentFragment)},[]),e.jsx(p,{present:l||i.open,children:({present:t})=>t?e.jsx(ce,{...s,ref:r}):e.jsx(re,{...s,fragment:c})})})
oe.displayName=ne
var re=t.forwardRef((t,n)=>{const{__scopeSelect:o,children:r,fragment:a}=t
return a?f.createPortal(e.jsx(le,{scope:o,children:e.jsx(L.Slot,{scope:o,children:e.jsx("div",{ref:n,children:r})})}),a):null})
re.displayName="SelectContentFragment"
var ae=10,[le,se]=V(ne),ie=C("SelectContent.RemoveScroll"),ce=t.forwardRef((o,r)=>{const{__scopeSelect:a}=o,{position:l="item-aligned",onCloseAutoFocus:s,onEscapeKeyDown:i,onPointerDownOutside:c,side:u,sideOffset:p,align:f,alignOffset:m,arrowPadding:h,collisionBoundary:v,collisionPadding:x,sticky:C,hideWhenDetached:j,avoidCollisions:N,..._}=o,R=K(ne,a),[P,I]=t.useState(null),[T,k]=t.useState(null),D=n(r,e=>I(e)),[E,M]=t.useState(null),[O,L]=t.useState(null),A=H(a),[V,B]=t.useState(!1),F=t.useRef(!1)
t.useEffect(()=>{if(P)return g(P)},[P]),w()
const W=t.useCallback(e=>{const[t,...n]=A().map(e=>e.ref.current),[o]=n.slice(-1),r=document.activeElement
for(const a of e){if(a===r)return
if(a?.scrollIntoView({block:"nearest"}),a===t&&T&&(T.scrollTop=0),a===o&&T&&(T.scrollTop=T.scrollHeight),a?.focus(),document.activeElement!==r)return}},[A,T]),z=t.useCallback(()=>W([E,P]),[W,E,P])
t.useEffect(()=>{V&&z()},[V,z])
const{onOpenChange:q,triggerPointerDownPosRef:U}=R
t.useEffect(()=>{if(P){let e={x:0,y:0}
const t=t=>{e={x:Math.abs(Math.round(t.pageX)-(U.current?.x??0)),y:Math.abs(Math.round(t.pageY)-(U.current?.y??0))}},n=n=>{e.x<=10&&e.y<=10?n.preventDefault():n.composedPath().includes(P)||q(!1),document.removeEventListener("pointermove",t),U.current=null}
return null!==U.current&&(document.addEventListener("pointermove",t),document.addEventListener("pointerup",n,{capture:!0,once:!0})),()=>{document.removeEventListener("pointermove",t),document.removeEventListener("pointerup",n,{capture:!0})}}},[P,q,U]),t.useEffect(()=>{const e=()=>q(!1)
return window.addEventListener("blur",e),window.addEventListener("resize",e),()=>{window.removeEventListener("blur",e),window.removeEventListener("resize",e)}},[q])
const[Y,Z]=Be(e=>{const t=A().filter(e=>!e.disabled),n=t.find(e=>e.ref.current===document.activeElement),o=Fe(t,e,n)
o&&setTimeout(()=>o.ref.current.focus())}),X=t.useCallback((e,t,n)=>{const o=!F.current&&!n;(void 0!==R.value&&R.value===t||o)&&(M(e),o&&(F.current=!0))},[R.value]),$=t.useCallback(()=>P?.focus(),[P]),G=t.useCallback((e,t,n)=>{const o=!F.current&&!n;(void 0!==R.value&&R.value===t||o)&&L(e)},[R.value]),J="popper"===l?ue:de,Q=J===ue?{side:u,sideOffset:p,align:f,alignOffset:m,arrowPadding:h,collisionBoundary:v,collisionPadding:x,sticky:C,hideWhenDetached:j,avoidCollisions:N}:{}
return e.jsx(le,{scope:a,content:P,viewport:T,onViewportChange:k,itemRefCallback:X,selectedItem:E,onItemLeave:$,itemTextRefCallback:G,focusSelectedItem:z,selectedItemText:O,position:l,isPositioned:V,searchRef:Y,children:e.jsx(y,{as:ie,allowPinchZoom:!0,children:e.jsx(b,{asChild:!0,trapped:R.open,onMountAutoFocus:e=>{e.preventDefault()},onUnmountAutoFocus:d(s,e=>{R.trigger?.focus({preventScroll:!0}),e.preventDefault()}),children:e.jsx(S,{asChild:!0,disableOutsidePointerEvents:!0,onEscapeKeyDown:i,onPointerDownOutside:c,onFocusOutside:e=>e.preventDefault(),onDismiss:()=>R.onOpenChange(!1),children:e.jsx(J,{role:"listbox",id:R.contentId,"data-state":R.open?"open":"closed",dir:R.dir,onContextMenu:e=>e.preventDefault(),..._,...Q,onPlaced:()=>B(!0),ref:D,style:{display:"flex",flexDirection:"column",outline:"none",..._.style},onKeyDown:d(_.onKeyDown,e=>{const t=e.ctrlKey||e.altKey||e.metaKey
if("Tab"===e.key&&e.preventDefault(),t||1!==e.key.length||Z(e.key),["ArrowUp","ArrowDown","Home","End"].includes(e.key)){let t=A().filter(e=>!e.disabled).map(e=>e.ref.current)
if(["ArrowUp","End"].includes(e.key)&&(t=t.slice().reverse()),["ArrowUp","ArrowDown"].includes(e.key)){const n=e.target,o=t.indexOf(n)
t=t.slice(o+1)}setTimeout(()=>W(t)),e.preventDefault()}})})})})})})})
ce.displayName="SelectContentImpl"
var de=t.forwardRef((a,l)=>{const{__scopeSelect:s,onPlaced:i,...c}=a,d=K(ne,s),u=se(ne,s),[p,f]=t.useState(null),[m,h]=t.useState(null),v=n(l,e=>h(e)),x=H(s),g=t.useRef(!1),w=t.useRef(!0),{viewport:y,selectedItem:b,selectedItemText:S,focusSelectedItem:C}=u,j=t.useCallback(()=>{if(d.trigger&&d.valueNode&&p&&m&&y&&b&&S){const e=d.trigger.getBoundingClientRect(),t=m.getBoundingClientRect(),n=d.valueNode.getBoundingClientRect(),o=S.getBoundingClientRect()
if("rtl"!==d.dir){const r=o.left-t.left,a=n.left-r,l=e.left-a,s=e.width+l,i=Math.max(s,t.width),c=window.innerWidth-ae,d=D(a,[ae,Math.max(ae,c-i)])
p.style.minWidth=s+"px",p.style.left=d+"px"}else{const r=t.right-o.right,a=window.innerWidth-n.right-r,l=window.innerWidth-e.right-a,s=e.width+l,i=Math.max(s,t.width),c=window.innerWidth-ae,d=D(a,[ae,Math.max(ae,c-i)])
p.style.minWidth=s+"px",p.style.right=d+"px"}const r=x(),a=window.innerHeight-2*ae,l=y.scrollHeight,s=window.getComputedStyle(m),c=parseInt(s.borderTopWidth,10),u=parseInt(s.paddingTop,10),f=parseInt(s.borderBottomWidth,10),h=c+u+l+parseInt(s.paddingBottom,10)+f,v=Math.min(5*b.offsetHeight,h),w=window.getComputedStyle(y),C=parseInt(w.paddingTop,10),j=parseInt(w.paddingBottom,10),N=e.top+e.height/2-ae,_=a-N,R=b.offsetHeight/2,P=c+u+(b.offsetTop+R),I=h-P
if(P<=N){const e=r.length>0&&b===r[r.length-1].ref.current
p.style.bottom="0px"
const t=m.clientHeight-y.offsetTop-y.offsetHeight,n=P+Math.max(_,R+(e?j:0)+t+f)
p.style.height=n+"px"}else{const e=r.length>0&&b===r[0].ref.current
p.style.top="0px"
const t=Math.max(N,c+y.offsetTop+(e?C:0)+R)+I
p.style.height=t+"px",y.scrollTop=P-N+y.offsetTop}p.style.margin=`${ae}px 0`,p.style.minHeight=v+"px",p.style.maxHeight=a+"px",i?.(),requestAnimationFrame(()=>g.current=!0)}},[x,d.trigger,d.valueNode,p,m,y,b,S,d.dir,i])
o(()=>j(),[j])
const[N,_]=t.useState()
o(()=>{m&&_(window.getComputedStyle(m).zIndex)},[m])
const R=t.useCallback(e=>{e&&!0===w.current&&(j(),C?.(),w.current=!1)},[j,C])
return e.jsx(pe,{scope:s,contentWrapper:p,shouldExpandOnScrollRef:g,onScrollButtonChange:R,children:e.jsx("div",{ref:f,style:{display:"flex",flexDirection:"column",position:"fixed",zIndex:N},children:e.jsx(r.div,{...c,ref:v,style:{boxSizing:"border-box",maxHeight:"100%",...c.style}})})})})
de.displayName="SelectItemAlignedPosition"
var ue=t.forwardRef((t,n)=>{const{__scopeSelect:o,align:r="start",collisionPadding:a=ae,...l}=t,s=B(o)
return e.jsx(j,{...s,...l,ref:n,align:r,collisionPadding:a,style:{boxSizing:"border-box",...l.style,"--radix-select-content-transform-origin":"var(--radix-popper-transform-origin)","--radix-select-content-available-width":"var(--radix-popper-available-width)","--radix-select-content-available-height":"var(--radix-popper-available-height)","--radix-select-trigger-width":"var(--radix-popper-anchor-width)","--radix-select-trigger-height":"var(--radix-popper-anchor-height)"}})})
ue.displayName="SelectPopperPosition"
var[pe,fe]=V(ne,{}),me="SelectViewport",he=t.forwardRef((o,a)=>{const{__scopeSelect:l,nonce:s,...i}=o,c=se(me,l),u=fe(me,l),p=n(a,c.onViewportChange),f=t.useRef(0)
return e.jsxs(e.Fragment,{children:[e.jsx("style",{dangerouslySetInnerHTML:{__html:"[data-radix-select-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-select-viewport]::-webkit-scrollbar{display:none}"},nonce:s}),e.jsx(L.Slot,{scope:l,children:e.jsx(r.div,{"data-radix-select-viewport":"",role:"presentation",...i,ref:p,style:{position:"relative",flex:1,overflow:"hidden auto",...i.style},onScroll:d(i.onScroll,e=>{const t=e.currentTarget,{contentWrapper:n,shouldExpandOnScrollRef:o}=u
if(o?.current&&n){const e=Math.abs(f.current-t.scrollTop)
if(e>0){const o=window.innerHeight-2*ae,r=parseFloat(n.style.minHeight),a=parseFloat(n.style.height),l=Math.max(r,a)
if(l<o){const r=l+e,a=Math.min(o,r),s=r-a
n.style.height=a+"px","0px"===n.style.bottom&&(t.scrollTop=s>0?s:0,n.style.justifyContent="flex-end")}}}f.current=t.scrollTop})})})]})})
he.displayName=me
var ve="SelectGroup",[xe,ge]=V(ve)
t.forwardRef((t,n)=>{const{__scopeSelect:o,...a}=t,s=l()
return e.jsx(xe,{scope:o,id:s,children:e.jsx(r.div,{role:"group","aria-labelledby":s,...a,ref:n})})}).displayName=ve
var we="SelectLabel",ye=t.forwardRef((t,n)=>{const{__scopeSelect:o,...a}=t,l=ge(we,o)
return e.jsx(r.div,{id:l.id,...a,ref:n})})
ye.displayName=we
var be="SelectItem",[Se,Ce]=V(be),je=t.forwardRef((o,a)=>{const{__scopeSelect:s,value:i,disabled:c=!1,textValue:u,...p}=o,f=K(be,s),m=se(be,s),h=f.value===i,[v,x]=t.useState(u??""),[g,w]=t.useState(!1),y=n(a,e=>m.itemRefCallback?.(e,i,c)),b=l(),S=t.useRef("touch"),C=()=>{c||(f.onValueChange(i),f.onOpenChange(!1))}
if(""===i)throw new Error("A <Select.Item /> must have a value prop that is not an empty string. This is because the Select value can be set to an empty string to clear the selection and show the placeholder.")
return e.jsx(Se,{scope:s,value:i,disabled:c,textId:b,isSelected:h,onItemTextChange:t.useCallback(e=>{x(t=>t||(e?.textContent??"").trim())},[]),children:e.jsx(L.ItemSlot,{scope:s,value:i,disabled:c,textValue:v,children:e.jsx(r.div,{role:"option","aria-labelledby":b,"data-highlighted":g?"":void 0,"aria-selected":h&&g,"data-state":h?"checked":"unchecked","aria-disabled":c||void 0,"data-disabled":c?"":void 0,tabIndex:c?void 0:-1,...p,ref:y,onFocus:d(p.onFocus,()=>w(!0)),onBlur:d(p.onBlur,()=>w(!1)),onClick:d(p.onClick,()=>{"mouse"!==S.current&&C()}),onPointerUp:d(p.onPointerUp,()=>{"mouse"===S.current&&C()}),onPointerDown:d(p.onPointerDown,e=>{S.current=e.pointerType}),onPointerMove:d(p.onPointerMove,e=>{S.current=e.pointerType,c?m.onItemLeave?.():"mouse"===S.current&&e.currentTarget.focus({preventScroll:!0})}),onPointerLeave:d(p.onPointerLeave,e=>{e.currentTarget===document.activeElement&&m.onItemLeave?.()}),onKeyDown:d(p.onKeyDown,e=>{""!==m.searchRef?.current&&" "===e.key||(M.includes(e.key)&&C()," "===e.key&&e.preventDefault())})})})})})
je.displayName=be
var Ne="SelectItemText",_e=t.forwardRef((a,l)=>{const{__scopeSelect:s,className:i,style:c,...d}=a,u=K(Ne,s),p=se(Ne,s),m=Ce(Ne,s),h=z(Ne,s),[v,x]=t.useState(null),g=n(l,e=>x(e),m.onItemTextChange,e=>p.itemTextRefCallback?.(e,m.value,m.disabled)),w=v?.textContent,y=t.useMemo(()=>e.jsx("option",{value:m.value,disabled:m.disabled,children:w},m.value),[m.disabled,m.value,w]),{onNativeOptionAdd:b,onNativeOptionRemove:S}=h
return o(()=>(b(y),()=>S(y)),[b,S,y]),e.jsxs(e.Fragment,{children:[e.jsx(r.span,{id:m.textId,...d,ref:g}),m.isSelected&&u.valueNode&&!u.valueNodeHasChildren?f.createPortal(d.children,u.valueNode):null]})})
_e.displayName=Ne
var Re="SelectItemIndicator",Pe=t.forwardRef((t,n)=>{const{__scopeSelect:o,...a}=t
return Ce(Re,o).isSelected?e.jsx(r.span,{"aria-hidden":!0,...a,ref:n}):null})
Pe.displayName=Re
var Ie="SelectScrollUpButton",Te=t.forwardRef((r,a)=>{const l=se(Ie,r.__scopeSelect),s=fe(Ie,r.__scopeSelect),[i,c]=t.useState(!1),d=n(a,s.onScrollButtonChange)
return o(()=>{if(l.viewport&&l.isPositioned){let e=()=>{const e=t.scrollTop>0
c(e)}
const t=l.viewport
return e(),t.addEventListener("scroll",e),()=>t.removeEventListener("scroll",e)}},[l.viewport,l.isPositioned]),i?e.jsx(Ee,{...r,ref:d,onAutoScroll:()=>{const{viewport:e,selectedItem:t}=l
e&&t&&(e.scrollTop=e.scrollTop-t.offsetHeight)}}):null})
Te.displayName=Ie
var ke="SelectScrollDownButton",De=t.forwardRef((r,a)=>{const l=se(ke,r.__scopeSelect),s=fe(ke,r.__scopeSelect),[i,c]=t.useState(!1),d=n(a,s.onScrollButtonChange)
return o(()=>{if(l.viewport&&l.isPositioned){let e=()=>{const e=t.scrollHeight-t.clientHeight,n=Math.ceil(t.scrollTop)<e
c(n)}
const t=l.viewport
return e(),t.addEventListener("scroll",e),()=>t.removeEventListener("scroll",e)}},[l.viewport,l.isPositioned]),i?e.jsx(Ee,{...r,ref:d,onAutoScroll:()=>{const{viewport:e,selectedItem:t}=l
e&&t&&(e.scrollTop=e.scrollTop+t.offsetHeight)}}):null})
De.displayName=ke
var Ee=t.forwardRef((n,a)=>{const{__scopeSelect:l,onAutoScroll:s,...i}=n,c=se("SelectScrollButton",l),u=t.useRef(null),p=H(l),f=t.useCallback(()=>{null!==u.current&&(window.clearInterval(u.current),u.current=null)},[])
return t.useEffect(()=>()=>f(),[f]),o(()=>{const e=p().find(e=>e.ref.current===document.activeElement)
e?.ref.current?.scrollIntoView({block:"nearest"})},[p]),e.jsx(r.div,{"aria-hidden":!0,...i,ref:a,style:{flexShrink:0,...i.style},onPointerDown:d(i.onPointerDown,()=>{null===u.current&&(u.current=window.setInterval(s,50))}),onPointerMove:d(i.onPointerMove,()=>{c.onItemLeave?.(),null===u.current&&(u.current=window.setInterval(s,50))}),onPointerLeave:d(i.onPointerLeave,()=>{f()})})}),Me=t.forwardRef((t,n)=>{const{__scopeSelect:o,...a}=t
return e.jsx(r.div,{"aria-hidden":!0,...a,ref:n})})
Me.displayName="SelectSeparator"
var Oe="SelectArrow"
t.forwardRef((t,n)=>{const{__scopeSelect:o,...r}=t,a=B(o)
return"popper"===se(Oe,o).position?e.jsx(N,{...a,...r,ref:n}):null}).displayName=Oe
var Le="SelectBubbleInput",He=t.forwardRef(({__scopeSelect:o,...a},l)=>{const s=K(Le,o),{value:c,onValueChange:d,required:u,disabled:p,name:f,autoComplete:m,form:h}=s,{nativeOptions:v,nativeSelectKey:x}=s,g=t.useRef(null),w=n(l,g),y=c??"",b=P(y)
return t.useEffect(()=>{const e=g.current
if(!e)return
const t=window.HTMLSelectElement.prototype,n=Object.getOwnPropertyDescriptor(t,"value").set
if(b!==y&&n){const t=new Event("change",{bubbles:!0})
n.call(e,y),e.dispatchEvent(t)}},[b,y]),e.jsxs(r.select,{"aria-hidden":!0,required:u,tabIndex:-1,name:f,autoComplete:m,disabled:p,form:h,onChange:e=>d(e.target.value),...a,style:{...i,...a.style},ref:w,defaultValue:y,children:[Ve(c)?e.jsx("option",{value:""}):null,Array.from(v)]},x)})
function Ae(e){return"function"==typeof e}function Ve(e){return""===e||void 0===e}function Be(e){const n=v(e),o=t.useRef(""),r=t.useRef(0),a=t.useCallback(e=>{const t=o.current+e
n(t),function e(t){o.current=t,window.clearTimeout(r.current),""!==t&&(r.current=window.setTimeout(()=>e(""),1e3))}(t)},[n]),l=t.useCallback(()=>{o.current="",window.clearTimeout(r.current)},[])
return t.useEffect(()=>()=>window.clearTimeout(r.current),[]),[o,a,l]}function Fe(e,t,n){const o=t.length>1&&Array.from(t).every(e=>e===t[0])?t[0]:t,r=n?e.indexOf(n):-1
let a=(l=e,s=Math.max(r,0),l.map((e,t)=>l[(s+t)%l.length]))
var l,s
1===o.length&&(a=a.filter(e=>e!==n))
const i=a.find(e=>e.textValue.toLowerCase().startsWith(o.toLowerCase()))
return i!==n?i:void 0}He.displayName=Le
const Ke=U,We=$,ze=t.forwardRef(({className:t,children:n,...o},r)=>e.jsxs(Z,{ref:r,className:_("flex h-11 min-h-11 w-full items-center justify-between whitespace-nowrap rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm ring-offset-background data-[placeholder]:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1",t),...o,children:[n,e.jsx(G,{asChild:!0,children:e.jsx(I,{className:"h-4 w-4 opacity-50"})})]}))
ze.displayName=Z.displayName
const qe=t.forwardRef(({className:t,...n},o)=>e.jsx(Te,{ref:o,className:_("flex cursor-default items-center justify-center py-1",t),...n,children:e.jsx(k,{className:"h-4 w-4"})}))
qe.displayName=Te.displayName
const Ue=t.forwardRef(({className:t,...n},o)=>e.jsx(De,{ref:o,className:_("flex cursor-default items-center justify-center py-1",t),...n,children:e.jsx(I,{className:"h-4 w-4"})}))
Ue.displayName=De.displayName
const Ye=t.forwardRef(({className:t,children:n,position:o="popper",...r},a)=>e.jsx(te,{children:e.jsxs(oe,{ref:a,className:_("relative z-50 max-h-[min(max(var(--radix-select-content-available-height,0px),12rem),24rem)] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover text-popover-foreground shadow-md data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[var(--radix-select-content-transform-origin)]","popper"===o&&"data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",t),position:o,...r,children:[e.jsx(qe,{}),e.jsx(he,{className:_("p-1","popper"===o&&"w-full min-w-[var(--radix-select-trigger-width)]"),children:n}),e.jsx(Ue,{})]})}))
Ye.displayName=oe.displayName,t.forwardRef(({className:t,...n},o)=>e.jsx(ye,{ref:o,className:_("px-2 py-1.5 text-sm font-semibold",t),...n})).displayName=ye.displayName
const Ze=t.forwardRef(({className:t,children:n,...o},r)=>e.jsxs(je,{ref:r,className:_("relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-2 pr-8 text-sm outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",t),...o,children:[e.jsx("span",{className:"absolute right-2 flex h-3.5 w-3.5 items-center justify-center",children:e.jsx(Pe,{children:e.jsx(T,{className:"h-4 w-4"})})}),e.jsx(_e,{children:n})]}))
Ze.displayName=je.displayName,t.forwardRef(({className:t,...n},o)=>e.jsx(Me,{ref:o,className:_("-mx-1 my-1 h-px bg-muted",t),...n})).displayName=Me.displayName
export{Ke as S,ze as a,We as b,Ye as c,Ze as d,D as e}
