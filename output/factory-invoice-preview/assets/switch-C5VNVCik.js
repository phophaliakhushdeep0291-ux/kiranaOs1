import{a as e,j as r}from"./vendor-data-BaHBZjtO.js"
import{bn as t,bk as a,b7 as o,ba as n,ca as s,bg as d,l as i}from"./index-DbQMpL2c.js"
import{u as c}from"./index-DLkqWn8u.js"
var l="Switch",[u]=d(l),[f,b]=u(l)
function p(t){const{__scopeSwitch:o,checked:n,children:s,defaultChecked:d,disabled:i,form:c,name:u,onCheckedChange:b,required:p,value:h="on",internal_do_not_use_render:m}=t,[k,g]=a({prop:n,defaultProp:d??!1,onChange:b,caller:l}),[w,v]=e.useState(null),[C,S]=e.useState(null),x=e.useRef(!1),y=!w||!!c||!!w.closest("form"),j={checked:k,setChecked:g,disabled:i,control:w,setControl:v,name:u,form:c,value:h,hasConsumerStoppedPropagationRef:x,required:p,defaultChecked:d,isFormControl:y,bubbleInput:C,setBubbleInput:S}
return r.jsx(f,{scope:o,...j,children:_(m)?m(j):s})}var h="SwitchTrigger",m=e.forwardRef(({__scopeSwitch:e,onClick:a,...s},d)=>{const{value:i,disabled:c,checked:l,required:u,setControl:f,setChecked:p,hasConsumerStoppedPropagationRef:m,isFormControl:k,bubbleInput:g}=b(h,e),w=o(d,f)
return r.jsx(t.button,{type:"button",role:"switch","aria-checked":l,"aria-required":u,"data-state":S(l),"data-disabled":c?"":void 0,disabled:c,value:i,...s,ref:w,onClick:n(a,e=>{p(e=>!e),g&&k&&(m.current=e.isPropagationStopped(),m.current||e.stopPropagation())})})})
m.displayName=h
var k=e.forwardRef((e,t)=>{const{__scopeSwitch:a,name:o,checked:n,defaultChecked:s,required:d,disabled:i,value:c,onCheckedChange:l,form:u,...f}=e
return r.jsx(p,{__scopeSwitch:a,checked:n,defaultChecked:s,disabled:i,required:d,onCheckedChange:l,name:o,form:u,value:c,internal_do_not_use_render:({isFormControl:e})=>r.jsxs(r.Fragment,{children:[r.jsx(m,{...f,ref:t,__scopeSwitch:a}),e&&r.jsx(C,{__scopeSwitch:a})]})})})
k.displayName=l
var g="SwitchThumb",w=e.forwardRef((e,a)=>{const{__scopeSwitch:o,...n}=e,s=b(g,o)
return r.jsx(t.span,{"data-state":S(s.checked),"data-disabled":s.disabled?"":void 0,...n,ref:a})})
w.displayName=g
var v="SwitchBubbleInput",C=e.forwardRef(({__scopeSwitch:a,...n},d)=>{const{control:i,hasConsumerStoppedPropagationRef:l,checked:u,defaultChecked:f,required:p,disabled:h,name:m,value:k,form:g,bubbleInput:w,setBubbleInput:C}=b(v,a),_=o(d,C),S=c(u),x=s(i)
e.useEffect(()=>{const e=w
if(!e)return
const r=window.HTMLInputElement.prototype,t=Object.getOwnPropertyDescriptor(r,"checked").set,a=!l.current
if(S!==u&&t){const r=new Event("click",{bubbles:a})
t.call(e,u),e.dispatchEvent(r)}},[w,S,u,l])
const y=e.useRef(u)
return r.jsx(t.input,{type:"checkbox","aria-hidden":!0,defaultChecked:f??y.current,required:p,disabled:h,name:m,value:k,form:g,...n,tabIndex:-1,ref:_,style:{...n.style,...x,position:"absolute",pointerEvents:"none",opacity:0,margin:0,transform:"translateX(-100%)"}})})
function _(e){return"function"==typeof e}function S(e){return e?"checked":"unchecked"}C.displayName=v
const x=e.forwardRef(({className:e,...t},a)=>r.jsx(k,{className:i("peer relative inline-flex h-11 w-11 shrink-0 cursor-pointer items-center rounded-xl bg-transparent p-0 before:absolute before:left-1 before:top-3 before:h-5 before:w-9 before:rounded-full before:border-2 before:border-transparent before:bg-input before:shadow-sm before:transition-colors data-[state=checked]:before:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50",e),...t,ref:a,children:r.jsx(w,{className:i("pointer-events-none relative z-10 ml-1 block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0")})}))
x.displayName=k.displayName
export{x as S}
