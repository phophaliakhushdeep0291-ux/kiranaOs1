import{j as e,a}from"./vendor-data-BaHBZjtO.js"
import{b4 as s,b5 as t,b6 as o,b7 as r,b8 as l,b9 as i,ba as n,bb as d,bc as c,bd as f,be as m,bf as p,bg as u,bh as g,l as x,bi as N}from"./index-Ci-XYli4.js"
var y="AlertDialog",[b]=u(y,[t]),j=t(),A=a=>{const{__scopeAlertDialog:t,...o}=a,r=j(t)
return e.jsx(s,{...r,...o,modal:!0})}
A.displayName=y,a.forwardRef((a,s)=>{const{__scopeAlertDialog:t,...o}=a,r=j(t)
return e.jsx(g,{...r,...o,ref:s})}).displayName="AlertDialogTrigger"
var v=a=>{const{__scopeAlertDialog:s,...t}=a,r=j(s)
return e.jsx(o,{...r,...t})}
v.displayName="AlertDialogPortal"
var D=a.forwardRef((a,s)=>{const{__scopeAlertDialog:t,...o}=a,r=j(t)
return e.jsx(m,{...r,...o,ref:s})})
D.displayName="AlertDialogOverlay"
var h="AlertDialogContent",[w,R]=b(h),_=p("AlertDialogContent"),O=a.forwardRef((s,t)=>{const{__scopeAlertDialog:o,children:d,...c}=s,f=j(o),m=a.useRef(null),p=r(t,m),u=a.useRef(null)
return e.jsx(l,{contentName:h,titleName:z,docsSlug:"alert-dialog",children:e.jsx(w,{scope:o,cancelRef:u,children:e.jsxs(i,{role:"alertdialog",...f,...c,ref:p,onOpenAutoFocus:n(c.onOpenAutoFocus,e=>{e.preventDefault(),u.current?.focus({preventScroll:!0})}),onPointerDownOutside:e=>e.preventDefault(),onInteractOutside:e=>e.preventDefault(),children:[e.jsx(_,{children:d}),e.jsx(P,{contentRef:m})]})})})})
O.displayName=h
var z="AlertDialogTitle",F=a.forwardRef((a,s)=>{const{__scopeAlertDialog:t,...o}=a,r=j(t)
return e.jsx(d,{...r,...o,ref:s})})
F.displayName=z
var $="AlertDialogDescription",C=a.forwardRef((a,s)=>{const{__scopeAlertDialog:t,...o}=a,r=j(t)
return e.jsx(c,{...r,...o,ref:s})})
C.displayName=$
var I=a.forwardRef((a,s)=>{const{__scopeAlertDialog:t,...o}=a,r=j(t)
return e.jsx(f,{...r,...o,ref:s})})
I.displayName="AlertDialogAction"
var k="AlertDialogCancel",E=a.forwardRef((a,s)=>{const{__scopeAlertDialog:t,...o}=a,{cancelRef:l}=R(k,t),i=j(t),n=r(s,l)
return e.jsx(f,{...i,...o,ref:n})})
E.displayName=k
var P=({contentRef:e})=>{const s=`\`${h}\` requires a description for the component to be accessible for screen reader users.\n\nYou can add a description to the \`${h}\` by passing a \`${$}\` component as a child, which also benefits sighted users by adding visible context to the dialog.\n\nAlternatively, you can use your own component as a description by assigning it an \`id\` and passing the same value to the \`aria-describedby\` prop in \`${h}\`. If the description is confusing or duplicative for sighted users, you can use the \`@radix-ui/react-visually-hidden\` primitive as a wrapper around your description component.\n\nFor more information, see https://radix-ui.com/primitives/docs/components/alert-dialog`
return a.useEffect(()=>{document.getElementById(e.current?.getAttribute("aria-describedby"))},[s,e]),null},S=D,T=O,q=I,B=E,H=F,Y=C
const G=A,J=v,K=a.forwardRef(({className:a,...s},t)=>e.jsx(S,{className:x("fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",a),...s,ref:t}))
K.displayName=S.displayName
const L=a.forwardRef(({className:a,...s},t)=>e.jsxs(J,{children:[e.jsx(K,{}),e.jsx(T,{ref:t,className:x("fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",a),...s})]}))
L.displayName=T.displayName
const M=({className:a,...s})=>e.jsx("div",{className:x("flex flex-col space-y-2 text-center sm:text-left",a),...s})
M.displayName="AlertDialogHeader"
const Q=({className:a,...s})=>e.jsx("div",{className:x("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",a),...s})
Q.displayName="AlertDialogFooter"
const U=a.forwardRef(({className:a,...s},t)=>e.jsx(H,{ref:t,className:x("text-lg font-semibold",a),...s}))
U.displayName=H.displayName
const V=a.forwardRef(({className:a,...s},t)=>e.jsx(Y,{ref:t,className:x("text-sm text-muted-foreground",a),...s}))
V.displayName=Y.displayName
const W=a.forwardRef(({className:a,...s},t)=>e.jsx(q,{ref:t,className:x(N(),a),...s}))
W.displayName=q.displayName
const X=a.forwardRef(({className:a,...s},t)=>e.jsx(B,{ref:t,className:x(N({variant:"outline"}),"mt-2 sm:mt-0",a),...s}))
X.displayName=B.displayName
export{G as A,L as a,M as b,U as c,V as d,Q as e,X as f,W as g}
