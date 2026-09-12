import{a as e,j as r}from"./vendor-data-BaHBZjtO.js"
import{bq as t,bn as n,bk as o,b7 as a,ba as s,ca as c,bg as d,l as i}from"./index-DtTTo2f-.js"
import{u as l}from"./index-DLkqWn8u.js"
import{aZ as u}from"./vendor-ui-CIi-vqR6.js"
var p="Checkbox",[b]=d(p),[f,h]=b(p)
function m(t){const{__scopeCheckbox:n,checked:a,children:s,defaultChecked:c,disabled:d,form:i,name:l,onCheckedChange:u,required:b,value:h="on",internal_do_not_use_render:m}=t,[k,C]=o({prop:a,defaultProp:c??!1,onChange:u,caller:p}),[x,v]=e.useState(null),[_,y]=e.useState(null),g=e.useRef(!1),R=!x||!!i||!!x.closest("form"),E={checked:k,disabled:d,setChecked:C,control:x,setControl:v,name:l,form:i,value:h,hasConsumerStoppedPropagationRef:g,required:b,defaultChecked:!w(c)&&c,isFormControl:R,bubbleInput:_,setBubbleInput:y}
return r.jsx(f,{scope:n,...E,children:j(m)?m(E):s})}var k="CheckboxTrigger",C=e.forwardRef(({__scopeCheckbox:t,onKeyDown:o,onClick:c,...d},i)=>{const{control:l,value:u,disabled:p,checked:b,required:f,setControl:m,setChecked:C,hasConsumerStoppedPropagationRef:x,isFormControl:v,bubbleInput:_}=h(k,t),y=a(i,m),g=e.useRef(b)
return e.useEffect(()=>{const e=l?.form
if(e){const r=()=>C(g.current)
return e.addEventListener("reset",r),()=>e.removeEventListener("reset",r)}},[l,C]),r.jsx(n.button,{type:"button",role:"checkbox","aria-checked":w(b)?"mixed":b,"aria-required":f,"data-state":R(b),"data-disabled":p?"":void 0,disabled:p,value:u,...d,ref:y,onKeyDown:s(o,e=>{"Enter"===e.key&&e.preventDefault()}),onClick:s(c,e=>{C(e=>!!w(e)||!e),_&&v&&(x.current=e.isPropagationStopped(),x.current||e.stopPropagation())})})})
C.displayName=k
var x=e.forwardRef((e,t)=>{const{__scopeCheckbox:n,name:o,checked:a,defaultChecked:s,required:c,disabled:d,value:i,onCheckedChange:l,form:u,...p}=e
return r.jsx(m,{__scopeCheckbox:n,checked:a,defaultChecked:s,disabled:d,required:c,onCheckedChange:l,name:o,form:u,value:i,internal_do_not_use_render:({isFormControl:e})=>r.jsxs(r.Fragment,{children:[r.jsx(C,{...p,ref:t,__scopeCheckbox:n}),e&&r.jsx(g,{__scopeCheckbox:n})]})})})
x.displayName=p
var v="CheckboxIndicator",_=e.forwardRef((e,o)=>{const{__scopeCheckbox:a,forceMount:s,...c}=e,d=h(v,a)
return r.jsx(t,{present:s||w(d.checked)||!0===d.checked,children:r.jsx(n.span,{"data-state":R(d.checked),"data-disabled":d.disabled?"":void 0,...c,ref:o,style:{pointerEvents:"none",...e.style}})})})
_.displayName=v
var y="CheckboxBubbleInput",g=e.forwardRef(({__scopeCheckbox:t,...o},s)=>{const{control:d,hasConsumerStoppedPropagationRef:i,checked:u,defaultChecked:p,required:b,disabled:f,name:m,value:k,form:C,bubbleInput:x,setBubbleInput:v}=h(y,t),_=a(s,v),g=l(u),j=c(d)
e.useEffect(()=>{const e=x
if(!e)return
const r=window.HTMLInputElement.prototype,t=Object.getOwnPropertyDescriptor(r,"checked").set,n=!i.current
if(g!==u&&t){const r=new Event("click",{bubbles:n})
e.indeterminate=w(u),t.call(e,!w(u)&&u),e.dispatchEvent(r)}},[x,g,u,i])
const R=e.useRef(!w(u)&&u)
return r.jsx(n.input,{type:"checkbox","aria-hidden":!0,defaultChecked:p??R.current,required:b,disabled:f,name:m,value:k,form:C,...o,tabIndex:-1,ref:_,style:{...o.style,...j,position:"absolute",pointerEvents:"none",opacity:0,margin:0,transform:"translateX(-100%)"}})})
function j(e){return"function"==typeof e}function w(e){return"indeterminate"===e}function R(e){return w(e)?"indeterminate":e?"checked":"unchecked"}g.displayName=y
const E=e.forwardRef(({className:e,...t},n)=>r.jsx(x,{ref:n,className:i("grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",e),...t,children:r.jsx(_,{className:i("grid place-content-center text-current"),children:r.jsx(u,{className:"h-4 w-4"})})}))
E.displayName=x.displayName
export{E as C}
