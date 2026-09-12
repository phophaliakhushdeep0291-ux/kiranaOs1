import{a as e,j as n}from"./vendor-data-BaHBZjtO.js"
import{c0 as r,bl as o,bo as t,bg as a,bp as s,bq as d,br as i,b7 as c,ba as u,bn as l,b$ as p,bs as f,c5 as m,bv as h,bt as v,bw as w,bx as g,by as x,bu as y,bz as b,c6 as _,bk as M,bm as j,l as D}from"./index-CYG8yywH.js"
import{u as R}from"./index-CxWW_46C.js"
import{c as C,I as N,R as k}from"./index-DY0GzH8N.js"
import{u as P,aZ as O,bi as I}from"./vendor-ui-CIi-vqR6.js"
var E=["Enter"," "],T=["ArrowUp","PageDown","End"],S=["ArrowDown","PageUp","Home",...T],F={ltr:[...E,"ArrowRight"],rtl:[...E,"ArrowLeft"]},L={ltr:["ArrowLeft"],rtl:["ArrowRight"]},K="Menu",[A,G,z]=p(K),[V,U]=a(K,[z,s,C]),B=s(),X=C(),[W,Y]=V(K),[Z,q]=V(K),H=t=>{const{__scopeMenu:a,open:s=!1,children:d,dir:i,onOpenChange:c,modal:u=!0}=t,l=B(a),[p,f]=e.useState(null),m=e.useRef(!1),h=r(c),v=R(i)
return e.useEffect(()=>{const e=()=>{m.current=!0,document.addEventListener("pointerdown",n,{capture:!0,once:!0}),document.addEventListener("pointermove",n,{capture:!0,once:!0})},n=()=>m.current=!1
return document.addEventListener("keydown",e,{capture:!0}),()=>{document.removeEventListener("keydown",e,{capture:!0}),document.removeEventListener("pointerdown",n,{capture:!0}),document.removeEventListener("pointermove",n,{capture:!0})}},[]),n.jsx(o,{...l,children:n.jsx(W,{scope:a,open:s,onOpenChange:h,content:p,onContentChange:f,children:n.jsx(Z,{scope:a,onClose:e.useCallback(()=>h(!1),[h]),isUsingKeyboardRef:m,dir:v,modal:u,children:d})})})}
H.displayName=K
var $=e.forwardRef((e,r)=>{const{__scopeMenu:o,...a}=e,s=B(o)
return n.jsx(t,{...s,...a,ref:r})})
$.displayName="MenuAnchor"
var J="MenuPortal",[Q,ee]=V(J,{forceMount:void 0}),ne=e=>{const{__scopeMenu:r,forceMount:o,children:t,container:a}=e,s=Y(J,r)
return n.jsx(Q,{scope:r,forceMount:o,children:n.jsx(d,{present:o||s.open,children:n.jsx(i,{asChild:!0,container:a,children:t})})})}
ne.displayName=J
var re="MenuContent",[oe,te]=V(re),ae=e.forwardRef((e,r)=>{const o=ee(re,e.__scopeMenu),{forceMount:t=o.forceMount,...a}=e,s=Y(re,e.__scopeMenu),i=q(re,e.__scopeMenu)
return n.jsx(A.Provider,{scope:e.__scopeMenu,children:n.jsx(d,{present:t||s.open,children:n.jsx(A.Slot,{scope:e.__scopeMenu,children:i.modal?n.jsx(se,{...a,ref:r}):n.jsx(de,{...a,ref:r})})})})}),se=e.forwardRef((r,o)=>{const t=Y(re,r.__scopeMenu),a=e.useRef(null),s=c(o,a)
return e.useEffect(()=>{const e=a.current
if(e)return f(e)},[]),n.jsx(ce,{...r,ref:s,trapFocus:t.open,disableOutsidePointerEvents:t.open,disableOutsideScroll:!0,onFocusOutside:u(r.onFocusOutside,e=>e.preventDefault(),{checkForDefaultPrevented:!1}),onDismiss:()=>t.onOpenChange(!1)})}),de=e.forwardRef((e,r)=>{const o=Y(re,e.__scopeMenu)
return n.jsx(ce,{...e,ref:r,trapFocus:!1,disableOutsidePointerEvents:!1,disableOutsideScroll:!1,onDismiss:()=>o.onOpenChange(!1)})}),ie=y("MenuContent.ScrollLock"),ce=e.forwardRef((r,o)=>{const{__scopeMenu:t,loop:a=!1,trapFocus:s,onOpenAutoFocus:d,onCloseAutoFocus:i,disableOutsidePointerEvents:l,onEntryFocus:p,onEscapeKeyDown:f,onPointerDownOutside:m,onFocusOutside:y,onInteractOutside:b,onDismiss:_,disableOutsideScroll:M,...j}=r,D=Y(re,t),R=q(re,t),C=B(t),N=X(t),P=G(t),[O,I]=e.useState(null),E=e.useRef(null),F=c(o,E,D.onContentChange),L=e.useRef(0),K=e.useRef(""),A=e.useRef(0),z=e.useRef(null),V=e.useRef("right"),U=e.useRef(0),W=M?v:e.Fragment,Z=M?{as:ie,allowPinchZoom:!0}:void 0
e.useEffect(()=>()=>window.clearTimeout(L.current),[]),h()
const H=e.useCallback(e=>V.current===z.current?.side&&((e,n)=>!!n&&((e,n)=>{const{x:r,y:o}=e
let t=!1
for(let a=0,s=n.length-1;a<n.length;s=a++){const e=n[a],d=n[s],i=e.x,c=e.y,u=d.x,l=d.y
c>o!=l>o&&r<(u-i)*(o-c)/(l-c)+i&&(t=!t)}return t})({x:e.clientX,y:e.clientY},n))(e,z.current?.area),[])
return n.jsx(oe,{scope:t,searchRef:K,onItemEnter:e.useCallback(e=>{H(e)&&e.preventDefault()},[H]),onItemLeave:e.useCallback(e=>{H(e)||(E.current?.focus(),I(null))},[H]),onTriggerLeave:e.useCallback(e=>{H(e)&&e.preventDefault()},[H]),pointerGraceTimerRef:A,onPointerGraceIntentChange:e.useCallback(e=>{z.current=e},[]),children:n.jsx(W,{...Z,children:n.jsx(w,{asChild:!0,trapped:s,onMountAutoFocus:u(d,e=>{e.preventDefault(),E.current?.focus({preventScroll:!0})}),onUnmountAutoFocus:i,children:n.jsx(g,{asChild:!0,disableOutsidePointerEvents:l,onEscapeKeyDown:f,onPointerDownOutside:m,onFocusOutside:y,onInteractOutside:b,onDismiss:_,children:n.jsx(k,{asChild:!0,...N,dir:R.dir,orientation:"vertical",loop:a,currentTabStopId:O,onCurrentTabStopIdChange:I,onEntryFocus:u(p,e=>{R.isUsingKeyboardRef.current||e.preventDefault()}),preventScrollOnEntryFocus:!0,children:n.jsx(x,{role:"menu","aria-orientation":"vertical","data-state":Se(D.open),"data-radix-menu-content":"",dir:R.dir,...C,...j,ref:F,style:{outline:"none",...j.style},onKeyDown:u(j.onKeyDown,e=>{const n=e.target.closest("[data-radix-menu-content]")===e.currentTarget,r=e.ctrlKey||e.altKey||e.metaKey,o=1===e.key.length
n&&("Tab"===e.key&&e.preventDefault(),!r&&o&&(e=>{const n=K.current+e,r=P().filter(e=>!e.disabled),o=document.activeElement,t=r.find(e=>e.ref.current===o)?.textValue,a=((e,n,r)=>{const o=n.length>1&&Array.from(n).every(e=>e===n[0])?n[0]:n,t=r?e.indexOf(r):-1
let a=(s=e,d=Math.max(t,0),s.map((e,n)=>s[(d+n)%s.length]))
var s,d
1===o.length&&(a=a.filter(e=>e!==r))
const i=a.find(e=>e.toLowerCase().startsWith(o.toLowerCase()))
return i!==r?i:void 0})(r.map(e=>e.textValue),n,t),s=r.find(e=>e.textValue===a)?.ref.current
!function e(n){K.current=n,window.clearTimeout(L.current),""!==n&&(L.current=window.setTimeout(()=>e(""),1e3))}(n),s&&setTimeout(()=>s.focus())})(e.key))
const t=E.current
if(e.target!==t)return
if(!S.includes(e.key))return
e.preventDefault()
const a=P().filter(e=>!e.disabled).map(e=>e.ref.current)
T.includes(e.key)&&a.reverse(),(e=>{const n=document.activeElement
for(const r of e){if(r===n)return
if(r.focus(),document.activeElement!==n)return}})(a)}),onBlur:u(r.onBlur,e=>{e.currentTarget.contains(e.target)||(window.clearTimeout(L.current),K.current="")}),onPointerMove:u(r.onPointerMove,Ke(e=>{const n=e.target,r=U.current!==e.clientX
if(e.currentTarget.contains(n)&&r){const n=e.clientX>U.current?"right":"left"
V.current=n,U.current=e.clientX}}))})})})})})})})
ae.displayName=re
var ue=e.forwardRef((e,r)=>{const{__scopeMenu:o,...t}=e
return n.jsx(l.div,{role:"group",...t,ref:r})})
ue.displayName="MenuGroup"
var le=e.forwardRef((e,r)=>{const{__scopeMenu:o,...t}=e
return n.jsx(l.div,{...t,ref:r})})
le.displayName="MenuLabel"
var pe="MenuItem",fe="menu.itemSelect",me=e.forwardRef((r,o)=>{const{disabled:t=!1,onSelect:a,...s}=r,d=e.useRef(null),i=q(pe,r.__scopeMenu),l=te(pe,r.__scopeMenu),p=c(o,d),f=e.useRef(!1)
return n.jsx(he,{...s,ref:p,disabled:t,onClick:u(r.onClick,()=>{const e=d.current
if(!t&&e){const n=new CustomEvent(fe,{bubbles:!0,cancelable:!0})
e.addEventListener(fe,e=>a?.(e),{once:!0}),m(e,n),n.defaultPrevented?f.current=!1:i.onClose()}}),onPointerDown:e=>{r.onPointerDown?.(e),f.current=!0},onPointerUp:u(r.onPointerUp,e=>{f.current||e.currentTarget?.click()}),onKeyDown:u(r.onKeyDown,e=>{const n=""!==l.searchRef.current
t||n&&" "===e.key||E.includes(e.key)&&(e.currentTarget.click(),e.preventDefault())})})})
me.displayName=pe
var he=e.forwardRef((r,o)=>{const{__scopeMenu:t,disabled:a=!1,textValue:s,...d}=r,i=te(pe,t),p=X(t),f=e.useRef(null),m=c(o,f),[h,v]=e.useState(!1),[w,g]=e.useState("")
return e.useEffect(()=>{const e=f.current
e&&g((e.textContent??"").trim())},[d.children]),n.jsx(A.ItemSlot,{scope:t,disabled:a,textValue:s??w,children:n.jsx(N,{asChild:!0,...p,focusable:!a,children:n.jsx(l.div,{role:"menuitem","data-highlighted":h?"":void 0,"aria-disabled":a||void 0,"data-disabled":a?"":void 0,...d,ref:m,onPointerMove:u(r.onPointerMove,Ke(e=>{a?i.onItemLeave(e):(i.onItemEnter(e),e.defaultPrevented||e.currentTarget.focus({preventScroll:!0}))})),onPointerLeave:u(r.onPointerLeave,Ke(e=>i.onItemLeave(e))),onFocus:u(r.onFocus,()=>v(!0)),onBlur:u(r.onBlur,()=>v(!1))})})})}),ve=e.forwardRef((e,r)=>{const{checked:o=!1,onCheckedChange:t,...a}=e
return n.jsx(je,{scope:e.__scopeMenu,checked:o,children:n.jsx(me,{role:"menuitemcheckbox","aria-checked":Fe(o)?"mixed":o,...a,ref:r,"data-state":Le(o),onSelect:u(a.onSelect,()=>t?.(!!Fe(o)||!o),{checkForDefaultPrevented:!1})})})})
ve.displayName="MenuCheckboxItem"
var we="MenuRadioGroup",[ge,xe]=V(we,{value:void 0,onValueChange:()=>{}}),ye=e.forwardRef((e,o)=>{const{value:t,onValueChange:a,...s}=e,d=r(a)
return n.jsx(ge,{scope:e.__scopeMenu,value:t,onValueChange:d,children:n.jsx(ue,{...s,ref:o})})})
ye.displayName=we
var be="MenuRadioItem",_e=e.forwardRef((e,r)=>{const{value:o,...t}=e,a=xe(be,e.__scopeMenu),s=o===a.value
return n.jsx(je,{scope:e.__scopeMenu,checked:s,children:n.jsx(me,{role:"menuitemradio","aria-checked":s,...t,ref:r,"data-state":Le(s),onSelect:u(t.onSelect,()=>a.onValueChange?.(o),{checkForDefaultPrevented:!1})})})})
_e.displayName=be
var Me="MenuItemIndicator",[je,De]=V(Me,{checked:!1}),Re=e.forwardRef((e,r)=>{const{__scopeMenu:o,forceMount:t,...a}=e,s=De(Me,o)
return n.jsx(d,{present:t||Fe(s.checked)||!0===s.checked,children:n.jsx(l.span,{...a,ref:r,"data-state":Le(s.checked)})})})
Re.displayName=Me
var Ce=e.forwardRef((e,r)=>{const{__scopeMenu:o,...t}=e
return n.jsx(l.div,{role:"separator","aria-orientation":"horizontal",...t,ref:r})})
Ce.displayName="MenuSeparator"
var Ne=e.forwardRef((e,r)=>{const{__scopeMenu:o,...t}=e,a=B(o)
return n.jsx(b,{...a,...t,ref:r})})
Ne.displayName="MenuArrow"
var[ke,Pe]=V("MenuSub"),Oe="MenuSubTrigger",Ie=e.forwardRef((r,o)=>{const t=Y(Oe,r.__scopeMenu),a=q(Oe,r.__scopeMenu),s=Pe(Oe,r.__scopeMenu),d=te(Oe,r.__scopeMenu),i=e.useRef(null),{pointerGraceTimerRef:c,onPointerGraceIntentChange:l}=d,p={__scopeMenu:r.__scopeMenu},f=e.useCallback(()=>{i.current&&window.clearTimeout(i.current),i.current=null},[])
return e.useEffect(()=>f,[f]),e.useEffect(()=>{const e=c.current
return()=>{window.clearTimeout(e),l(null)}},[c,l]),n.jsx($,{asChild:!0,...p,children:n.jsx(he,{id:s.triggerId,"aria-haspopup":"menu","aria-expanded":t.open,"aria-controls":t.open?s.contentId:void 0,"data-state":Se(t.open),...r,ref:_(o,s.onTriggerChange),onClick:e=>{r.onClick?.(e),r.disabled||e.defaultPrevented||(e.currentTarget.focus(),t.open||t.onOpenChange(!0))},onPointerMove:u(r.onPointerMove,Ke(e=>{d.onItemEnter(e),e.defaultPrevented||r.disabled||t.open||i.current||(d.onPointerGraceIntentChange(null),i.current=window.setTimeout(()=>{t.onOpenChange(!0),f()},100))})),onPointerLeave:u(r.onPointerLeave,Ke(e=>{f()
const n=t.content?.getBoundingClientRect()
if(n){const r=t.content?.dataset.side,o="right"===r,a=o?-5:5,s=n[o?"left":"right"],i=n[o?"right":"left"]
d.onPointerGraceIntentChange({area:[{x:e.clientX+a,y:e.clientY},{x:s,y:n.top},{x:i,y:n.top},{x:i,y:n.bottom},{x:s,y:n.bottom}],side:r}),window.clearTimeout(c.current),c.current=window.setTimeout(()=>d.onPointerGraceIntentChange(null),300)}else{if(d.onTriggerLeave(e),e.defaultPrevented)return
d.onPointerGraceIntentChange(null)}})),onKeyDown:u(r.onKeyDown,e=>{const n=""!==d.searchRef.current
r.disabled||n&&" "===e.key||F[a.dir].includes(e.key)&&(t.onOpenChange(!0),t.content?.focus(),e.preventDefault())})})})})
Ie.displayName=Oe
var Ee="MenuSubContent",Te=e.forwardRef((r,o)=>{const t=ee(re,r.__scopeMenu),{forceMount:a=t.forceMount,align:s="start",...i}=r,l=Y(re,r.__scopeMenu),p=q(re,r.__scopeMenu),f=Pe(Ee,r.__scopeMenu),m=e.useRef(null),h=c(o,m)
return n.jsx(A.Provider,{scope:r.__scopeMenu,children:n.jsx(d,{present:a||l.open,children:n.jsx(A.Slot,{scope:r.__scopeMenu,children:n.jsx(ce,{id:f.contentId,"aria-labelledby":f.triggerId,...i,ref:h,align:s,side:"rtl"===p.dir?"left":"right",disableOutsidePointerEvents:!1,disableOutsideScroll:!1,trapFocus:!1,onOpenAutoFocus:e=>{p.isUsingKeyboardRef.current&&m.current?.focus(),e.preventDefault()},onCloseAutoFocus:e=>e.preventDefault(),onFocusOutside:u(r.onFocusOutside,e=>{e.target!==f.trigger&&l.onOpenChange(!1)}),onEscapeKeyDown:u(r.onEscapeKeyDown,e=>{p.onClose(),e.preventDefault()}),onKeyDown:u(r.onKeyDown,e=>{const n=e.currentTarget.contains(e.target),r=L[p.dir].includes(e.key)
n&&r&&(l.onOpenChange(!1),f.trigger?.focus(),e.preventDefault())})})})})})})
function Se(e){return e?"open":"closed"}function Fe(e){return"indeterminate"===e}function Le(e){return Fe(e)?"indeterminate":e?"checked":"unchecked"}function Ke(e){return n=>"mouse"===n.pointerType?e(n):void 0}Te.displayName=Ee
var Ae=H,Ge=$,ze=ne,Ve=ae,Ue=ue,Be=le,Xe=me,We=ve,Ye=ye,Ze=_e,qe=Re,He=Ce,$e=Ne,Je=Ie,Qe=Te,en="DropdownMenu",[nn]=a(en,[U]),rn=U(),[on,tn]=nn(en),an=r=>{const{__scopeDropdownMenu:o,children:t,dir:a,open:s,defaultOpen:d,onOpenChange:i,modal:c=!0}=r,u=rn(o),l=e.useRef(null),[p,f]=M({prop:s,defaultProp:d??!1,onChange:i,caller:en})
return n.jsx(on,{scope:o,triggerId:j(),triggerRef:l,contentId:j(),open:p,onOpenChange:f,onOpenToggle:e.useCallback(()=>f(e=>!e),[f]),modal:c,children:n.jsx(Ae,{...u,open:p,onOpenChange:f,dir:a,modal:c,children:t})})}
an.displayName=en
var sn="DropdownMenuTrigger",dn=e.forwardRef((e,r)=>{const{__scopeDropdownMenu:o,disabled:t=!1,...a}=e,s=tn(sn,o),d=rn(o)
return n.jsx(Ge,{asChild:!0,...d,children:n.jsx(l.button,{type:"button",id:s.triggerId,"aria-haspopup":"menu","aria-expanded":s.open,"aria-controls":s.open?s.contentId:void 0,"data-state":s.open?"open":"closed","data-disabled":t?"":void 0,disabled:t,...a,ref:_(r,s.triggerRef),onPointerDown:u(e.onPointerDown,e=>{t||0!==e.button||!1!==e.ctrlKey||(s.onOpenToggle(),s.open||e.preventDefault())}),onKeyDown:u(e.onKeyDown,e=>{t||(["Enter"," "].includes(e.key)&&s.onOpenToggle(),"ArrowDown"===e.key&&s.onOpenChange(!0),["Enter"," ","ArrowDown"].includes(e.key)&&e.preventDefault())})})})})
dn.displayName=sn
var cn=e=>{const{__scopeDropdownMenu:r,...o}=e,t=rn(r)
return n.jsx(ze,{...t,...o})}
cn.displayName="DropdownMenuPortal"
var un="DropdownMenuContent",ln=e.forwardRef((r,o)=>{const{__scopeDropdownMenu:t,...a}=r,s=tn(un,t),d=rn(t),i=e.useRef(!1)
return n.jsx(Ve,{id:s.contentId,"aria-labelledby":s.triggerId,...d,...a,ref:o,onCloseAutoFocus:u(r.onCloseAutoFocus,e=>{i.current||s.triggerRef.current?.focus(),i.current=!1,e.preventDefault()}),onInteractOutside:u(r.onInteractOutside,e=>{const n=e.detail.originalEvent,r=0===n.button&&!0===n.ctrlKey,o=2===n.button||r
s.modal&&!o||(i.current=!0)}),style:{...r.style,"--radix-dropdown-menu-content-transform-origin":"var(--radix-popper-transform-origin)","--radix-dropdown-menu-content-available-width":"var(--radix-popper-available-width)","--radix-dropdown-menu-content-available-height":"var(--radix-popper-available-height)","--radix-dropdown-menu-trigger-width":"var(--radix-popper-anchor-width)","--radix-dropdown-menu-trigger-height":"var(--radix-popper-anchor-height)"}})})
ln.displayName=un,e.forwardRef((e,r)=>{const{__scopeDropdownMenu:o,...t}=e,a=rn(o)
return n.jsx(Ue,{...a,...t,ref:r})}).displayName="DropdownMenuGroup"
var pn=e.forwardRef((e,r)=>{const{__scopeDropdownMenu:o,...t}=e,a=rn(o)
return n.jsx(Be,{...a,...t,ref:r})})
pn.displayName="DropdownMenuLabel"
var fn=e.forwardRef((e,r)=>{const{__scopeDropdownMenu:o,...t}=e,a=rn(o)
return n.jsx(Xe,{...a,...t,ref:r})})
fn.displayName="DropdownMenuItem"
var mn=e.forwardRef((e,r)=>{const{__scopeDropdownMenu:o,...t}=e,a=rn(o)
return n.jsx(We,{...a,...t,ref:r})})
mn.displayName="DropdownMenuCheckboxItem",e.forwardRef((e,r)=>{const{__scopeDropdownMenu:o,...t}=e,a=rn(o)
return n.jsx(Ye,{...a,...t,ref:r})}).displayName="DropdownMenuRadioGroup"
var hn=e.forwardRef((e,r)=>{const{__scopeDropdownMenu:o,...t}=e,a=rn(o)
return n.jsx(Ze,{...a,...t,ref:r})})
hn.displayName="DropdownMenuRadioItem"
var vn=e.forwardRef((e,r)=>{const{__scopeDropdownMenu:o,...t}=e,a=rn(o)
return n.jsx(qe,{...a,...t,ref:r})})
vn.displayName="DropdownMenuItemIndicator"
var wn=e.forwardRef((e,r)=>{const{__scopeDropdownMenu:o,...t}=e,a=rn(o)
return n.jsx(He,{...a,...t,ref:r})})
wn.displayName="DropdownMenuSeparator",e.forwardRef((e,r)=>{const{__scopeDropdownMenu:o,...t}=e,a=rn(o)
return n.jsx($e,{...a,...t,ref:r})}).displayName="DropdownMenuArrow"
var gn=e.forwardRef((e,r)=>{const{__scopeDropdownMenu:o,...t}=e,a=rn(o)
return n.jsx(Je,{...a,...t,ref:r})})
gn.displayName="DropdownMenuSubTrigger"
var xn=e.forwardRef((e,r)=>{const{__scopeDropdownMenu:o,...t}=e,a=rn(o)
return n.jsx(Qe,{...a,...t,ref:r,style:{...e.style,"--radix-dropdown-menu-content-transform-origin":"var(--radix-popper-transform-origin)","--radix-dropdown-menu-content-available-width":"var(--radix-popper-available-width)","--radix-dropdown-menu-content-available-height":"var(--radix-popper-available-height)","--radix-dropdown-menu-trigger-width":"var(--radix-popper-anchor-width)","--radix-dropdown-menu-trigger-height":"var(--radix-popper-anchor-height)"}})})
xn.displayName="DropdownMenuSubContent"
var yn=cn,bn=ln,_n=pn,Mn=fn,jn=mn,Dn=hn,Rn=vn,Cn=wn,Nn=gn,kn=xn
const Pn=an,On=dn
e.forwardRef(({className:e,inset:r,children:o,...t},a)=>n.jsxs(Nn,{ref:a,className:D("flex min-h-11 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",r&&"pl-8",e),...t,children:[o,n.jsx(P,{className:"ml-auto"})]})).displayName=Nn.displayName,e.forwardRef(({className:e,...r},o)=>n.jsx(kn,{ref:o,className:D("z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[var(--radix-dropdown-menu-content-transform-origin)]",e),...r})).displayName=kn.displayName
const In=e.forwardRef(({className:e,sideOffset:r=4,...o},t)=>n.jsx(yn,{children:n.jsx(bn,{ref:t,sideOffset:r,className:D("z-50 max-h-[var(--radix-dropdown-menu-content-available-height)] min-w-[8rem] overflow-y-auto overflow-x-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md","data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[var(--radix-dropdown-menu-content-transform-origin)]",e),...o})}))
In.displayName=bn.displayName
const En=e.forwardRef(({className:e,inset:r,...o},t)=>n.jsx(Mn,{ref:t,className:D("relative flex min-h-11 cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",r&&"pl-8",e),...o}))
En.displayName=Mn.displayName,e.forwardRef(({className:e,children:r,checked:o,...t},a)=>n.jsxs(jn,{ref:a,className:D("relative flex min-h-11 cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",e),checked:o,...t,children:[n.jsx("span",{className:"absolute left-2 flex h-3.5 w-3.5 items-center justify-center",children:n.jsx(Rn,{children:n.jsx(O,{className:"h-4 w-4"})})}),r]})).displayName=jn.displayName,e.forwardRef(({className:e,children:r,...o},t)=>n.jsxs(Dn,{ref:t,className:D("relative flex min-h-11 cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",e),...o,children:[n.jsx("span",{className:"absolute left-2 flex h-3.5 w-3.5 items-center justify-center",children:n.jsx(Rn,{children:n.jsx(I,{className:"h-2 w-2 fill-current"})})}),r]})).displayName=Dn.displayName,e.forwardRef(({className:e,inset:r,...o},t)=>n.jsx(_n,{ref:t,className:D("px-2 py-1.5 text-sm font-semibold",r&&"pl-8",e),...o})).displayName=_n.displayName
const Tn=e.forwardRef(({className:e,...r},o)=>n.jsx(Cn,{ref:o,className:D("-mx-1 my-1 h-px bg-muted",e),...r}))
Tn.displayName=Cn.displayName
export{Pn as D,On as a,In as b,En as c,Tn as d}
