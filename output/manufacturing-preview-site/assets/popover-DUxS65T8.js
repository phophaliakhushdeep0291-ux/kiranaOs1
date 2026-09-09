import{a as e,j as o}from"./vendor-data-BaHBZjtO.js"
import{bk as r,bl as t,bm as n,b7 as a,bn as s,ba as i,bo as d,bp as p,bq as c,br as u,bg as l,bs as f,bt as v,bu as h,bv as g,bw as m,bx as b,by as x,bz as P,l as C}from"./index-Ci-XYli4.js"
var O="Popover",[w]=l(O,[p]),j=p(),[R,_]=w(O),y=a=>{const{__scopePopover:s,children:i,open:d,defaultOpen:p,onOpenChange:c,modal:u=!1}=a,l=j(s),f=e.useRef(null),[v,h]=e.useState(!1),[g,m]=r({prop:d,defaultProp:p??!1,onChange:c,caller:O})
return o.jsx(t,{...l,children:o.jsx(R,{scope:s,contentId:n(),triggerRef:f,open:g,onOpenChange:m,onOpenToggle:e.useCallback(()=>m(e=>!e),[m]),hasCustomAnchor:v,onCustomAnchorAdd:e.useCallback(()=>h(!0),[]),onCustomAnchorRemove:e.useCallback(()=>h(!1),[]),modal:u,children:i})})}
y.displayName=O
var A="PopoverAnchor"
e.forwardRef((r,t)=>{const{__scopePopover:n,...a}=r,s=_(A,n),i=j(n),{onCustomAnchorAdd:p,onCustomAnchorRemove:c}=s
return e.useEffect(()=>(p(),()=>c()),[p,c]),o.jsx(d,{...i,...a,ref:t})}).displayName=A
var F="PopoverTrigger",D=e.forwardRef((e,r)=>{const{__scopePopover:t,...n}=e,p=_(F,t),c=j(t),u=a(r,p.triggerRef),l=o.jsx(s.button,{type:"button","aria-haspopup":"dialog","aria-expanded":p.open,"aria-controls":p.open?p.contentId:void 0,"data-state":Z(p.open),...n,ref:u,onClick:i(e.onClick,p.onOpenToggle)})
return p.hasCustomAnchor?l:o.jsx(d,{asChild:!0,...c,children:l})})
D.displayName=F
var E="PopoverPortal",[N,k]=w(E,{forceMount:void 0}),I=e=>{const{__scopePopover:r,forceMount:t,children:n,container:a}=e,s=_(E,r)
return o.jsx(N,{scope:r,forceMount:t,children:o.jsx(c,{present:t||s.open,children:o.jsx(u,{asChild:!0,container:a,children:n})})})}
I.displayName=E
var M="PopoverContent",z=e.forwardRef((e,r)=>{const t=k(M,e.__scopePopover),{forceMount:n=t.forceMount,...a}=e,s=_(M,e.__scopePopover)
return o.jsx(c,{present:n||s.open,children:s.modal?o.jsx(T,{...a,ref:r}):o.jsx(S,{...a,ref:r})})})
z.displayName=M
var K=h("PopoverContent.RemoveScroll"),T=e.forwardRef((r,t)=>{const n=_(M,r.__scopePopover),s=e.useRef(null),d=a(t,s),p=e.useRef(!1)
return e.useEffect(()=>{const e=s.current
if(e)return f(e)},[]),o.jsx(v,{as:K,allowPinchZoom:!0,children:o.jsx(q,{...r,ref:d,trapFocus:n.open,disableOutsidePointerEvents:!0,onCloseAutoFocus:i(r.onCloseAutoFocus,e=>{e.preventDefault(),p.current||n.triggerRef.current?.focus()}),onPointerDownOutside:i(r.onPointerDownOutside,e=>{const o=e.detail.originalEvent,r=0===o.button&&!0===o.ctrlKey,t=2===o.button||r
p.current=t},{checkForDefaultPrevented:!1}),onFocusOutside:i(r.onFocusOutside,e=>e.preventDefault(),{checkForDefaultPrevented:!1})})})}),S=e.forwardRef((r,t)=>{const n=_(M,r.__scopePopover),a=e.useRef(!1),s=e.useRef(!1)
return o.jsx(q,{...r,ref:t,trapFocus:!1,disableOutsidePointerEvents:!1,onCloseAutoFocus:e=>{r.onCloseAutoFocus?.(e),e.defaultPrevented||(a.current||n.triggerRef.current?.focus(),e.preventDefault()),a.current=!1,s.current=!1},onInteractOutside:e=>{r.onInteractOutside?.(e),e.defaultPrevented||(a.current=!0,"pointerdown"===e.detail.originalEvent.type&&(s.current=!0))
const o=e.target,t=n.triggerRef.current?.contains(o)
t&&e.preventDefault(),"focusin"===e.detail.originalEvent.type&&s.current&&e.preventDefault()}})}),q=e.forwardRef((e,r)=>{const{__scopePopover:t,trapFocus:n,onOpenAutoFocus:a,onCloseAutoFocus:s,disableOutsidePointerEvents:i,onEscapeKeyDown:d,onPointerDownOutside:p,onFocusOutside:c,onInteractOutside:u,...l}=e,f=_(M,t),v=j(t)
return g(),o.jsx(m,{asChild:!0,loop:!0,trapped:n,onMountAutoFocus:a,onUnmountAutoFocus:s,children:o.jsx(b,{asChild:!0,disableOutsidePointerEvents:i,onInteractOutside:u,onEscapeKeyDown:d,onPointerDownOutside:p,onFocusOutside:c,onDismiss:()=>f.onOpenChange(!1),children:o.jsx(x,{"data-state":Z(f.open),role:"dialog",id:f.contentId,...v,...l,ref:r,style:{...l.style,"--radix-popover-content-transform-origin":"var(--radix-popper-transform-origin)","--radix-popover-content-available-width":"var(--radix-popper-available-width)","--radix-popover-content-available-height":"var(--radix-popper-available-height)","--radix-popover-trigger-width":"var(--radix-popper-anchor-width)","--radix-popover-trigger-height":"var(--radix-popper-anchor-height)"}})})})}),U="PopoverClose"
function Z(e){return e?"open":"closed"}e.forwardRef((e,r)=>{const{__scopePopover:t,...n}=e,a=_(U,t)
return o.jsx(s.button,{type:"button",...n,ref:r,onClick:i(e.onClick,()=>a.onOpenChange(!1))})}).displayName=U,e.forwardRef((e,r)=>{const{__scopePopover:t,...n}=e,a=j(t)
return o.jsx(P,{...a,...n,ref:r})}).displayName="PopoverArrow"
var B=I,G=z
const H=y,J=D,L=e.forwardRef(({className:e,align:r="center",sideOffset:t=4,...n},a)=>o.jsx(B,{children:o.jsx(G,{ref:a,align:r,sideOffset:t,className:C("z-50 w-72 rounded-md border bg-popover p-4 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 origin-[var(--radix-popover-content-transform-origin)]",e),...n})}))
L.displayName=G.displayName
export{H as P,J as a,L as b}
