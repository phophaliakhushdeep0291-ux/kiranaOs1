import{a,j as e}from"./vendor-data-BaHBZjtO.js"
import{bn as r,bg as l,l as s}from"./index-Ci-XYli4.js"
var t="Progress",[n]=l(t),[o,i]=n(t),u=a.forwardRef((a,l)=>{const{__scopeProgress:s,value:t=null,max:n,getValueLabel:i=f,...u}=a;(n||0===n)&&x(n)
const d=x(n)?n:100
null!==t&&p(t,d)
const m=p(t,d)?t:null,N=c(m)?i(m,d):void 0
return e.jsx(o,{scope:s,value:m,max:d,children:e.jsx(r.div,{"aria-valuemax":d,"aria-valuemin":0,"aria-valuenow":c(m)?m:void 0,"aria-valuetext":N,role:"progressbar","data-state":v(m,d),"data-value":m??void 0,"data-max":d,...u,ref:l})})})
u.displayName=t
var d="ProgressIndicator",m=a.forwardRef((a,l)=>{const{__scopeProgress:s,...t}=a,n=i(d,s)
return e.jsx(r.div,{"data-state":v(n.value,n.max),"data-value":n.value??void 0,"data-max":n.max,...t,ref:l})})
function f(a,e){return`${Math.round(a/e*100)}%`}function v(a,e){return null==a?"indeterminate":a===e?"complete":"loading"}function c(a){return"number"==typeof a}function x(a){return c(a)&&!isNaN(a)&&a>0}function p(a,e){return c(a)&&!isNaN(a)&&a<=e&&a>=0}m.displayName=d
var N=u,g=m
const j=a.forwardRef(({className:a,value:r,...l},t)=>e.jsx(N,{ref:t,className:s("relative h-2 w-full overflow-hidden rounded-full bg-primary/20",a),...l,children:e.jsx(g,{className:"h-full w-full flex-1 bg-primary transition-all",style:{transform:`translateX(-${100-(r||0)}%)`}})}))
j.displayName=N.displayName
export{j as P}
