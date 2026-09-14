import{f as e}from"./vendor-data-BaHBZjtO.js"
var t=e=>"checkbox"===e.type,r=e=>e instanceof Date,s=e=>null==e
const a=e=>"object"==typeof e
var i=e=>!s(e)&&!Array.isArray(e)&&a(e)&&!r(e),n=e=>{const t=e.constructor&&e.constructor.prototype
return i(t)&&t.hasOwnProperty("isPrototypeOf")},o="undefined"!=typeof window&&void 0!==window.HTMLElement&&"undefined"!=typeof document
function l(e){if(e instanceof Date)return new Date(e)
const t="undefined"!=typeof FileList&&e instanceof FileList
if(o&&(e instanceof Blob||t))return e
const r=Array.isArray(e)
if(!(r||i(e)&&n(e)))return e
const s=r?[]:Object.create(Object.getPrototypeOf(e))
for(const a in e)Object.prototype.hasOwnProperty.call(e,a)&&(s[a]=l(e[a]))
return s}const u="trigger",d="onChange",f="onSubmit",c="all",y="pattern",m="required",v="validate",h="form",p="root",g=["__proto__","constructor","prototype"]
var b=e=>/^\w*$/.test(e),V=e=>void 0===e,_=e=>e.split(/[.[\]'"]/g).filter(Boolean),A=(e,t,r)=>{if(!t||!i(e))return r
const a=b(t)?[t]:_(t)
if(a.some(e=>g.includes(e)))return r
const n=a.reduce((e,t)=>s(e)?void 0:e[t],e)
return V(n)||n===e?V(e[t])?r:e[t]:n},F=e=>"boolean"==typeof e,k=e=>"function"==typeof e,w=(e,t,r)=>{let s=-1
const a=b(t)?[t]:_(t),n=a.length,o=n-1
for(;++s<n;){const t=a[s]
let n=r
if(s!==o){const r=e[t]
n=i(r)||Array.isArray(r)?r:isNaN(+a[s+1])?{}:[]}if(g.includes(t))return
e[t]=n,e=e[t]}}
e.createContext(null).displayName="HookFormControlContext"
const x=o?e.useLayoutEffect:e.useEffect
var D=e=>"string"==typeof e,S=e=>s(e)||!a(e)
const O=(e,t)=>0===t.length&&!Array.isArray(e)&&!n(e)
function E(e,t,s=new WeakSet){if(e===t)return!0
if(S(e)||S(t))return Object.is(e,t)
if(r(e)&&r(t))return Object.is(e.getTime(),t.getTime())
const a=Object.keys(e),n=Object.keys(t)
if(a.length!==n.length)return!1
if(O(e,a)||O(t,n))return Object.is(e,t)
if(s.has(e)||s.has(t))return!0
s.add(e),s.add(t)
for(const o of a){const a=e[o]
if(!(o in t))return!1
if("ref"!==o){const e=t[o]
if(r(a)&&r(e)||(i(a)||Array.isArray(a))&&(i(e)||Array.isArray(e))?!E(a,e,s):!Object.is(a,e))return!1}}return!0}e.createContext(null).displayName="HookFormContext"
var N=(e,t,r,s,a)=>t?{...r[e],types:{...r[e]&&r[e].types?r[e].types:{},[s]:a||!0}}:{},j=e=>Array.isArray(e)?e.filter(Boolean):[],C=e=>Array.isArray(e)?e:[e],T=()=>{let e=[]
return{get observers(){return e},next:t=>{for(const r of e)r.next&&r.next(t)},subscribe:t=>(e.push(t),{unsubscribe:()=>{e=e.filter(e=>e!==t)}}),unsubscribe:()=>{e=[]}}}
function U(e,t){const r={}
for(const s in e)if(e.hasOwnProperty(s)){const a=e[s],n=t[s]
if(a&&i(a)&&n){const e=U(a,n)
i(e)&&(r[s]=e)}else e[s]&&(r[s]=n)}return r}var L=e=>i(e)&&!Object.keys(e).length,M=e=>"file"===e.type,B=e=>{if(!o)return!1
const t=e?e.ownerDocument:0
return e instanceof(t&&t.defaultView?t.defaultView.HTMLElement:HTMLElement)},R=e=>"select-multiple"===e.type,P=e=>"radio"===e.type,I=e=>B(e)&&e.isConnected
function q(e,t){if(D(t)&&Object.prototype.hasOwnProperty.call(e,t))return delete e[t],e
const r=Array.isArray(t)?t:b(t)?[t]:_(t),a=1===r.length?e:((e,t)=>{const r=t.slice(0,-1).length
let a=0
for(;a<r;){if(s(e)){e=void 0
break}e=e[t[a]],a++}return e})(e,r),n=r.length-1,o=r[n]
return a&&delete a[o],0!==n&&(i(a)&&L(a)||Array.isArray(a)&&(e=>{for(const t in e)if(e.hasOwnProperty(t)&&!V(e[t]))return!1
return!0})(a))&&q(e,r.slice(0,-1)),e}function W(e){return Array.isArray(e)||i(e)&&!(e=>{for(const t in e)if(k(e[t]))return!0
return!1})(e)}function H(e,t={}){for(const r in e){const s=e[r]
W(s)?(t[r]=Array.isArray(s)?[]:{},H(s,t[r])):V(s)||(t[r]=!0)}return t}function $(e){if(!1!==e){if(!0===e)return!0
if(Array.isArray(e)){const t=e.map(e=>$(e))
return t.some(e=>void 0!==e)?t:void 0}if(i(e)){const t={}
for(const r in e){const s=$(e[r])
V(s)||(t[r]=s)}return Object.keys(t).length?t:void 0}}}function z(e,t,r){r||(r=H(t))
for(const a in e){const i=e[a]
if(W(i))V(t)||S(r[a])?r[a]=H(i,Array.isArray(i)?[]:{}):z(i,s(t)?{}:t[a],r[a])
else{const e=t[a]
r[a]=!E(i,e)}}return $(r)||{}}const G={value:!1,isValid:!1},J={value:!0,isValid:!0}
var K=e=>{if(Array.isArray(e)){if(e.length>1){const t=e.filter(e=>e&&e.checked&&!e.disabled).map(e=>e.value)
return{value:t,isValid:!!t.length}}return e[0].checked&&!e[0].disabled?e[0].attributes&&!V(e[0].attributes.value)?V(e[0].value)||""===e[0].value?J:{value:e[0].value,isValid:!0}:J:G}return G},Q=(e,{valueAsNumber:t,valueAsDate:r,setValueAs:s})=>V(e)?e:t?""===e?NaN:e?+e:e:r&&D(e)?new Date(e):s?s(e):e
const X={isValid:!1,value:null}
var Y=e=>Array.isArray(e)?e.reduce((e,t)=>t&&t.checked&&!t.disabled?{isValid:!0,value:t.value}:e,X):X
function Z(e){const r=e.ref
return M(r)?r.files:P(r)?Y(e.refs).value:R(r)?[...r.selectedOptions].map(({value:e})=>e):t(r)?K(e.refs).value:Q(V(r.value)?e.ref.value:r.value,e)}var ee=e=>e instanceof RegExp,te=e=>V(e)?e:ee(e)?e.source:i(e)?ee(e.value)?e.value.source:e.value:e,re=e=>({isOnSubmit:!e||e===f,isOnBlur:"onBlur"===e,isOnChange:e===d,isOnAll:e===c,isOnTouch:"onTouched"===e})
const se="AsyncFunction"
var ae=e=>!!e&&!!e.validate&&!!(k(e.validate)&&e.validate.constructor.name===se||i(e.validate)&&Object.values(e.validate).find(e=>e.constructor.name===se)),ie=(e,t,r)=>!r&&(t.watchAll||t.watch.has(e)||[...t.watch].some(t=>e.startsWith(`${t}.`)))
const ne=(e,t,r,s)=>{for(const a of r||Object.keys(e)){const r=A(e,a)
if(r){const{_f:e,...n}=r
if(e){if(e.refs&&e.refs[0]&&t(e.refs[0],a)&&!s)return!0
if(e.ref&&t(e.ref,e.name)&&!s)return!0
if(ne(n,t))break}else if(i(n)&&ne(n,t))break}}}
function oe(e,t,r){const s=A(e,r)
if(s||b(r))return{error:s,name:r}
const a=r.split(".")
for(;a.length;){const s=a.join("."),i=A(t,s),n=A(e,s)
if(i&&!Array.isArray(i)&&r!==s)return{name:r}
if(n&&n.type)return{name:s,error:n}
if(n&&n.root&&n.root.type)return{name:`${s}.root`,error:n.root}
a.pop()}return{name:r}}var le=(e,t,r)=>{const s=A(e,r),a=Array.isArray(s)?s:[]
return w(a,p,t[r]),w(e,r,a),e}
function ue(e,t,r="validate"){if(D(e)||Array.isArray(e)&&e.every(D)||F(e)&&!e)return{type:r,message:D(e)?e:"",ref:t}}var de=e=>i(e)&&!ee(e)?e:{value:e,message:""},fe=async(e,r,a,n,o,l)=>{const{ref:u,refs:d,required:f,maxLength:c,minLength:h,min:p,max:g,pattern:b,validate:_,name:w,valueAsNumber:x,mount:S}=e._f,O=A(a,w)
if(!S||r.has(w))return{}
const E=d?d[0]:u,j=e=>{o&&E.reportValidity&&(E.setCustomValidity(F(e)?"":e||""),E.reportValidity())},C={},T=P(u),U=t(u),R=T||U,I=(x||M(u))&&V(u.value)&&V(O)||B(u)&&""===u.value||""===O||Array.isArray(O)&&!O.length,q=N.bind(null,w,n,C),W=(e,t,r,s="maxLength",a="minLength")=>{const i=e?t:r
C[w]={type:e?s:a,message:i,ref:u,...q(e?s:a,i)}}
if(l?!Array.isArray(O)||!O.length:f&&(!R&&(I||s(O))||F(O)&&!O||U&&!K(d).isValid||T&&!Y(d).isValid)){const{value:e,message:t}=D(f)?{value:!!f,message:f}:de(f)
if(e&&(C[w]={type:m,message:t,ref:E,...q(m,t)},!n))return j(t),C}if(!(I||s(p)&&s(g))){let e,t
const r=de(g),a=de(p)
if(s(O)||isNaN(O)){const s=u.valueAsDate||new Date(O),i=e=>new Date((new Date).toDateString()+" "+e),n="time"==u.type,o="week"==u.type
D(r.value)&&O&&(e=n?i(O)>i(r.value):o?O>r.value:s>new Date(r.value)),D(a.value)&&O&&(t=n?i(O)<i(a.value):o?O<a.value:s<new Date(a.value))}else{const i=u.valueAsNumber||(O?+O:O)
s(r.value)||(e=i>r.value),s(a.value)||(t=i<a.value)}if((e||t)&&(W(!!e,r.message,a.message,"max","min"),!n))return j(C[w].message),C}if((c||h)&&!I&&(D(O)||l&&Array.isArray(O))){const e=de(c),t=de(h),r=!s(e.value)&&O.length>+e.value,a=!s(t.value)&&O.length<+t.value
if((r||a)&&(W(r,e.message,t.message),!n))return j(C[w].message),C}if(b&&!I&&D(O)){const{value:e,message:t}=de(b)
if(ee(e)&&!O.match(e)&&(C[w]={type:y,message:t,ref:u,...q(y,t)},!n))return j(t),C}if(_)if(k(_)){const e=ue(await _(O,a),E)
if(e&&(C[w]={...e,...q(v,e.message)},!n))return j(e.message),C}else if(i(_)){let e={}
for(const t in _){if(!L(e)&&!n)break
const r=ue(await _[t](O,a),E,t)
r&&(e={...r,...q(t,r.message)},j(r.message),n&&(C[w]=e))}if(!L(e)&&(C[w]={ref:E,...e},!n))return C}return j(!0),C}
const ce={mode:f,reValidateMode:d,shouldFocusError:!0},ye={submitCount:0,isDirty:!1,isReady:!1,isValidating:!1,isSubmitted:!1,isSubmitting:!1,isSubmitSuccessful:!1,isValid:!1,touchedFields:{},dirtyFields:{},validatingFields:{}}
function me(e={}){let a,n={...ce,...e},d={...l(ye),isLoading:k(n.defaultValues),errors:n.errors||{},disabled:n.disabled||!1},f={},y=(i(n.defaultValues)||i(n.values))&&l(n.defaultValues||n.values)||{},m=n.shouldUnregister?{}:l(y),g={action:!1,mount:!1,watch:!1,keepIsValid:!1},x={mount:new Set,disabled:new Set,unMount:new Set,array:new Set,watch:new Set,registerName:new Set},S=0
const O={isDirty:!1,dirtyFields:!1,validatingFields:!1,touchedFields:!1,isValidating:!1,isValid:!1,errors:!1},N={...O}
let W={...N}
const H={array:T(),state:T()},$=n.criteriaMode===c,G=async e=>{if(!g.keepIsValid&&!n.disabled&&(N.isValid||W.isValid||e)){let e
n.resolver?(e=L((await ee()).errors),J()):e=await ue({fields:f,onlyCheckValid:!0,eventType:"valid"}),e!==d.isValid&&H.state.next({isValid:e})}},J=(e,t)=>{!n.disabled&&(N.isValidating||N.validatingFields||W.isValidating||W.validatingFields)&&((e||Array.from(x.mount)).forEach(e=>{e&&(t?w(d.validatingFields,e,t):q(d.validatingFields,e))}),H.state.next({validatingFields:d.validatingFields,isValidating:!L(d.validatingFields)}))},K=()=>{d.dirtyFields=z(y,m)},X=(e,t,r,a)=>{const i=A(f,e)
if(i){if((e=>{const t=b(e)?[e]:_(e)
let r=m,a=y
for(let i=0;i<t.length-1;i++){const e=t[i]
if(r=s(r)?r:r[e],a=s(a)?a:a[e],null===r&&null!==a)return!0}return!1})(e))return
const n=V(A(m,e)),o=A(m,e,V(r)?A(y,e):r)
V(o)||a&&a.defaultChecked||t?w(m,e,t?o:Z(i._f)):ve(e,o),g.mount&&!g.action&&(G(),n&&d.isDirty&&(N.isDirty||W.isDirty))&&(de()||(d.isDirty=!1,H.state.next({...d})))}},Y=(e,t,r,s,a)=>{let i=!1,o=!1
const l={name:e}
if(!n.disabled){if(!r||s){(N.isDirty||W.isDirty)&&(o=d.isDirty,d.isDirty=l.isDirty=de(),i=o!==l.isDirty)
const r=E(A(y,e),t)
o=!!A(d.dirtyFields,e),r!==d.isDirty?d.dirtyFields=z(y,m):r?q(d.dirtyFields,e):w(d.dirtyFields,e,!0),l.dirtyFields=d.dirtyFields,i=i||(N.dirtyFields||W.dirtyFields)&&o!==!r}if(r){const t=A(d.touchedFields,e)
t||(w(d.touchedFields,e,r),l.touchedFields=d.touchedFields,i=i||(N.touchedFields||W.touchedFields)&&t!==r)}i&&a&&H.state.next(l)}return i?l:{}},ee=async e=>(J(e,!0),await n.resolver(m,n.context,((e,t,r,s)=>{const a={}
for(const i of e){const e=A(t,i)
e&&w(a,i,e._f)}return{criteriaMode:r,names:[...e],fields:a,shouldUseNativeValidation:s}})(e||x.mount,f,n.criteriaMode,n.shouldUseNativeValidation))),se=async({name:t,eventType:r})=>{if(e.validate){const s=await e.validate({formValues:m,formState:d,name:t,eventType:r})
if(i(s))for(const e in s){const t=s[e]
t&&we(`${h}.${e}`,{message:D(t.message)?t.message:"",type:t.type||v})}else D(s)||!s?we(h,{message:s||"",type:v}):ke(h)
return s}return!0},ue=async({fields:t,onlyCheckValid:r,name:s,eventType:a,context:i={valid:!0,runRootValidation:!1}})=>{if(e.validate&&(i.runRootValidation=!0,!(await se({name:s,eventType:a}))&&(i.valid=!1,r)))return i.valid
for(const o in t){const s=t[o]
if(s){const{_f:t,...l}=s
if(t){const a=x.array.has(t.name),o=s._f&&ae(s._f),l=N.validatingFields||N.isValidating||W.validatingFields||W.isValidating
o&&l&&J([t.name],!0)
const u=await fe(s,x.disabled,m,$,n.shouldUseNativeValidation&&!r,a)
if(o&&l&&J([t.name]),u[t.name]&&(i.valid=!1,r))break
if(!r&&(A(u,t.name)?a?le(d.errors,u,t.name):w(d.errors,t.name,u[t.name]):q(d.errors,t.name)),e.shouldUseNativeValidation&&u[t.name])break}!L(l)&&await ue({context:i,onlyCheckValid:r,fields:l,name:o,eventType:a})}}return i.valid},de=(e,t)=>!n.disabled&&(e&&t&&w(m,e,t),!E(Ae(),y)),me=(e,t,r)=>((e,t,r,s,a)=>D(e)?(s&&t.watch.add(e),A(r,e,a)):Array.isArray(e)?e.map(e=>(s&&t.watch.add(e),A(r,e))):(s&&(t.watchAll=!0),r))(e,x,{...g.mount?m:V(t)?y:D(e)?{[e]:t}:t},r,t),ve=(e,r,a={},i=!1)=>{const n=A(f,e)
let o=r
if(n){const a=n._f
a&&(!a.disabled&&w(m,e,Q(r,a)),o=B(a.ref)&&s(r)?"":r,R(a.ref)?[...a.ref.options].forEach(e=>e.selected=o.includes(e.value)):a.refs?t(a.ref)?a.refs.forEach(e=>{e.defaultChecked&&e.disabled||(Array.isArray(o)?e.checked=!!o.find(t=>t===e.value):e.checked=o===e.value||!!o)}):a.refs.forEach(e=>e.checked=e.value===o):M(a.ref)?a.ref.value="":(a.ref.value=o,a.ref.type||H.state.next({name:e,values:i?m:l(m)})))}(a.shouldDirty||a.shouldTouch)&&Y(e,o,a.shouldTouch,a.shouldDirty,!0),a.shouldValidate&&_e(e)},he=(e,t,s,a=!1)=>{for(const n in t){if(!t.hasOwnProperty(n))return
const o=t[n],l=e+"."+n,u=A(f,l);(x.array.has(e)||i(o)||u&&!u._f)&&!r(o)?he(l,o,s,a):ve(l,o,s,a)}},pe=(e,t,r,a)=>{const i=A(f,e),n=x.array.has(e),o=a?t:l(t),u=E(A(m,e),o)
if(u||w(m,e,o),n)H.array.next({name:e,values:a?m:l(m)}),(N.isDirty||N.dirtyFields||W.isDirty||W.dirtyFields)&&r.shouldDirty&&(K(),H.state.next({name:e,dirtyFields:d.dirtyFields,isDirty:de(e,o)}))
else{const t=Array.isArray(o)&&!o.length||L(o)
!i||i._f||s(o)||t?ve(e,o,r,a):he(e,o,r,a)}if(!u){const t=ie(e,x),r=a?m:l(m)
H.state.next({...t&&d,name:g.mount||t?e:void 0,values:r})}},ge=(e,t,r={})=>pe(e,t,r,!1),be=async s=>{g.mount=!0
const o=s.target
let u=o.name,c=!0
const y=A(f,u),v=e=>{c=Number.isNaN(e)||r(e)&&isNaN(e.getTime())||E(e,A(m,u,e))},h=re(n.mode),p=re(n.reValidateMode)
if(y){let r,g
const V=o.type?Z(y._f):(e=>i(e)&&e.target?t(e.target)?e.target.checked:e.target.value:e)(s),_="blur"===s.type||"focusout"===s.type,k=!((b=y._f).mount&&(b.required||b.min||b.max||b.maxLength||b.minLength||b.pattern||b.validate)||e.validate||n.resolver||A(d.errors,u)||y._f.deps)||((e,t,r,s,a)=>!a.isOnAll&&(!r&&a.isOnTouch?!(t||e):(r?s.isOnBlur:a.isOnBlur)?!e:!(r?s.isOnChange:a.isOnChange)||e))(_,A(d.touchedFields,u),d.isSubmitted,p,h),D=ie(u,x,_)
w(m,u,V),_?o&&o.readOnly||(y._f.onBlur&&y._f.onBlur(s),a&&a(0)):y._f.onChange&&y._f.onChange(s)
const O=Y(u,V,_),j=!L(O)||D
if(!_&&H.state.next({name:u,type:s.type,values:l(m)}),k)return(N.isValid||W.isValid)&&("onBlur"===n.mode?_&&G():_||G()),j&&H.state.next({name:u,...D?{}:O})
if(!n.resolver&&e.validate&&await se({name:u,eventType:s.type}),!_&&D&&H.state.next({...d}),n.resolver){const{errors:e}=await ee([u])
if(J([u]),v(V),!c)return void(!L(O)&&H.state.next(O))
const t=oe(d.errors,f,u),s=oe(e,f,t.name||u)
r=s.error,u=s.name,g=L(e)}else J([u],!0),r=(await fe(y,x.disabled,m,$,n.shouldUseNativeValidation))[u],J([u]),v(V),c&&(r?g=!1:(N.isValid||W.isValid)&&(g=await ue({fields:f,onlyCheckValid:!0,name:u,eventType:s.type})))
c&&(y._f.deps&&(!Array.isArray(y._f.deps)||y._f.deps.length>0)&&_e(y._f.deps),((e,t,r,s)=>{const i=A(d.errors,e),o=(N.isValid||W.isValid)&&F(t)&&d.isValid!==t
var l
if(n.delayError&&r?(l=()=>((e,t)=>{w(d.errors,e,t),H.state.next({errors:d.errors})})(e,r),a=e=>{clearTimeout(S),S=setTimeout(l,e)},a(n.delayError)):(clearTimeout(S),a=null,r?w(d.errors,e,r):q(d.errors,e)),(r?!E(i,r):i)||!L(s)||o){const r={...s,...o&&F(t)?{isValid:t}:{},errors:d.errors,name:e}
d={...d,...r},H.state.next(r)}})(u,g,r,O))}var b},Ve=(e,t)=>{if(A(d.errors,t)&&e.focus)return e.focus(),1},_e=async(e,t={})=>{let r,s
const a=C(e)
if(n.resolver){const t=await(async e=>{const{errors:t}=await ee(e)
if(J(e),e)for(const r of e){const e=A(t,r)
e?x.array.has(r)&&i(e)&&!Object.keys(e).some(e=>!Number.isNaN(Number(e)))?le(d.errors,{[r]:e},r):w(d.errors,r,e):q(d.errors,r)}else d.errors=t
return t})(V(e)?e:a)
r=L(t),s=e?!a.some(e=>A(t,e)):r}else e?(s=(await Promise.all(a.map(async e=>{const t=A(f,e)
return await ue({fields:t&&t._f?{[e]:t}:t,eventType:u})}))).every(Boolean),(s||d.isValid)&&G()):s=r=await ue({fields:f,name:e,eventType:u})
return H.state.next({...!D(e)||(N.isValid||W.isValid)&&r!==d.isValid?{}:{name:e},...n.resolver||!e?{isValid:r}:{},errors:d.errors}),t.shouldFocus&&!s&&ne(f,Ve,e?a:x.mount),s},Ae=(e,t)=>{let r={...g.mount?m:y}
return t&&(r=U(t.dirtyFields?d.dirtyFields:d.touchedFields,r)),V(e)?r:D(e)?A(r,e):e.map(e=>A(r,e))},Fe=(e,t)=>({invalid:!!A((t||d).errors,e),isDirty:!!A((t||d).dirtyFields,e),error:A((t||d).errors,e),isValidating:!!A(d.validatingFields,e),isTouched:!!A((t||d).touchedFields,e)}),ke=e=>{const t=e?C(e):void 0
null==t||t.forEach(e=>q(d.errors,e)),t?t.forEach(e=>{H.state.next({name:e,errors:d.errors})}):H.state.next({errors:{}})},we=(e,t,r)=>{const s=(A(f,e,{_f:{}})._f||{}).ref,a=A(d.errors,e)||{},{ref:i,message:n,type:o,...l}=a
w(d.errors,e,{...l,...t,ref:s}),H.state.next({name:e,errors:d.errors,isValid:!1}),r&&r.shouldFocus&&s&&s.focus&&s.focus()},xe=e=>H.state.subscribe({next:t=>{if(r=e.name,s=t.name,a=e.exact,(!r||!s||r===s||C(r).some(e=>e&&(a?e===s:e.startsWith(s)||s.startsWith(e))))&&((e,t,r,s)=>{r(e)
const{name:a,...i}=e
return L(i)||s&&Object.keys(i).length>=Object.keys(t).length||Object.keys(i).find(e=>t[e]===(!s||c))})(t,e.formState||N,Te,e.reRenderRoot)){const r={...m}
e.callback({values:r,...d,...t,defaultValues:y})}var r,s,a}}).unsubscribe,De=(e,t={})=>{for(const r of e?C(e):x.mount)x.mount.delete(r),x.array.delete(r),t.keepValue||(q(f,r),q(m,r)),!t.keepError&&q(d.errors,r),!t.keepDirty&&q(d.dirtyFields,r),!t.keepTouched&&q(d.touchedFields,r),!t.keepIsValidating&&q(d.validatingFields,r),!n.shouldUnregister&&!t.keepDefaultValue&&q(y,r)
H.state.next({values:l(m)}),H.state.next({...d,...t.keepDirty?{isDirty:de()}:{}}),!t.keepIsValid&&G()},Se=({disabled:e,name:t})=>{if(F(e)&&g.mount||e||x.disabled.has(t)){const r=x.disabled.has(t)!==!!e
e?x.disabled.add(t):x.disabled.delete(t),r&&g.mount&&!g.action&&G()}},Oe=(e,r={})=>{let s=A(f,e)
const a=F(r.disabled)||F(n.disabled),i=!x.registerName.has(e)&&s&&s._f&&!s._f.mount
return w(f,e,{...s||{},_f:{...s&&s._f?s._f:{ref:{name:e}},name:e,mount:!0,...r}}),x.mount.add(e),s&&!i?Se({disabled:F(r.disabled)?r.disabled:n.disabled,name:e}):X(e,!0,r.value),{...a?{disabled:r.disabled||n.disabled}:{},...n.progressive?{required:!!r.required,min:te(r.min),max:te(r.max),minLength:te(r.minLength),maxLength:te(r.maxLength),pattern:te(r.pattern)}:{},name:e,onChange:be,onBlur:be,ref:a=>{if(a){x.registerName.add(e),Oe(e,r),x.registerName.delete(e),s=A(f,e)
const i=V(a.value)&&a.querySelectorAll&&a.querySelectorAll("input,select,textarea")[0]||a,n=(e=>P(e)||t(e))(i),o=s._f.refs||[]
if(n?o.find(e=>e===i):i===s._f.ref)return
w(f,e,{_f:{...s._f,...n?{refs:[...o.filter(I),i,...Array.isArray(A(y,e))?[{}]:[]],ref:{type:i.type,name:e}}:{ref:i}}}),X(e,!1,void 0,i)}else s=A(f,e,{}),s._f&&(s._f.mount=!1),(n.shouldUnregister||r.shouldUnregister)&&(!((e,t)=>t.split(".").some((t,r,s)=>!isNaN(Number(t))&&e.has(s.slice(0,r).join("."))))(x.array,e)||!g.action)&&x.unMount.add(e)}}},Ee=()=>n.shouldFocusError&&!n.shouldUseNativeValidation&&ne(f,Ve,x.mount),Ne=(e,t)=>async r=>{let s
r&&(r.preventDefault&&r.preventDefault(),r.persist&&r.persist())
let a=l(m)
if(H.state.next({isSubmitting:!0}),n.resolver){const{errors:e,values:t}=await ee()
J(),d.errors=e,a=l(t)}else await ue({fields:f,eventType:"submit"})
if(x.disabled.size)for(const e of x.disabled)q(a,e)
if(q(d.errors,p),L(d.errors)){H.state.next({errors:{}})
try{await e(a,r)}catch(i){s=i}}else t&&await t({...d.errors},r),Ee(),setTimeout(Ee)
if(H.state.next({isSubmitted:!0,isSubmitting:!1,isSubmitSuccessful:L(d.errors)&&!s,submitCount:d.submitCount+1,errors:d.errors}),s)throw s},je=(e,t={})=>{const r=e?l(e):y,s=l(r),a=L(e),i=s
if(t.keepDefaultValues||(y=r),!t.keepValues){if(t.keepDirtyValues){const e=new Set([...x.mount,...Object.keys(z(y,m))])
for(const t of Array.from(e)){const e=A(d.dirtyFields,t),r=A(m,t),s=A(i,t)
e&&!V(r)?w(i,t,r):e||V(s)||ge(t,s)}}else{if(o&&V(e))for(const e of x.mount){const t=A(f,e)
if(t&&t._f){const e=Array.isArray(t._f.refs)?t._f.refs[0]:t._f.ref
if(B(e)){const t=e.closest("form")
if(t){t.reset()
break}}}}if(t.keepFieldsRef)for(const e of x.mount)ge(e,A(i,e))
else f={}}if(n.shouldUnregister){if(m=t.keepDefaultValues?l(y):{},t.keepFieldsRef)for(const e of x.mount)w(m,e,A(i,e))}else m=l(i)
H.array.next({values:{...i}}),H.state.next({values:{...i}})}x={mount:t.keepDirtyValues?x.mount:new Set,unMount:new Set,array:new Set,registerName:new Set,disabled:new Set,watch:new Set,watchAll:!1,focus:""},g.mount=!N.isValid||!!t.keepIsValid||!!t.keepDirtyValues||!n.shouldUnregister&&!L(i),g.watch=!!n.shouldUnregister,g.keepIsValid=!!t.keepIsValid,g.action=!1,t.keepErrors||(d.errors={}),H.state.next({submitCount:t.keepSubmitCount?d.submitCount:0,isDirty:!a&&(t.keepDirty?d.isDirty:t.keepValues?de():!(!t.keepDefaultValues||E(e,y))),isSubmitted:!!t.keepIsSubmitted&&d.isSubmitted,dirtyFields:a?{}:t.keepDirtyValues?t.keepDefaultValues&&m?z(y,m):d.dirtyFields:t.keepDefaultValues&&e?z(y,e):t.keepDirty?d.dirtyFields:{},touchedFields:t.keepTouched?d.touchedFields:{},errors:t.keepErrors?d.errors:{},isSubmitSuccessful:!!t.keepIsSubmitSuccessful&&d.isSubmitSuccessful,isSubmitting:!1,defaultValues:y})},Ce=(e,t)=>je(k(e)?e(m):e,{...n.resetOptions,...t}),Te=e=>{d={...d,...e}},Ue={control:{register:Oe,unregister:De,getFieldState:Fe,handleSubmit:Ne,setError:we,_subscribe:xe,_runSchema:ee,_updateIsValidating:J,_focusError:Ee,_getWatch:me,_getDirty:de,_setValid:G,_setFieldArray:(e,t=[],r,s,a=!0,i=!0)=>{if(s&&r&&!n.disabled){if(g.action=!0,i&&Array.isArray(A(f,e))){const t=r(A(f,e),s.argA,s.argB)
a&&w(f,e,t)}if(i&&Array.isArray(A(d.errors,e))){const t=r(A(d.errors,e),s.argA,s.argB)
a&&w(d.errors,e,t),((e,t)=>{!j(A(e,t)).length&&q(e,t)})(d.errors,e)}if((N.touchedFields||W.touchedFields)&&i&&Array.isArray(A(d.touchedFields,e))){const t=r(A(d.touchedFields,e),s.argA,s.argB)
a&&w(d.touchedFields,e,t)}(N.dirtyFields||W.dirtyFields)&&K(),H.state.next({name:e,isDirty:de(e,t),dirtyFields:d.dirtyFields,errors:d.errors,isValid:d.isValid})}else w(m,e,t)},_setDisabledField:Se,_setErrors:e=>{d.errors=e,H.state.next({errors:d.errors,isValid:!1})},_getFieldArray:e=>j(A(g.mount?m:y,e,n.shouldUnregister?A(y,e,[]):[])),_reset:je,_resetDefaultValues:()=>k(n.defaultValues)&&n.defaultValues().then(e=>{Ce(e,n.resetOptions),H.state.next({isLoading:!1})}),_removeUnmounted:()=>{for(const e of x.unMount){const t=A(f,e)
t&&(t._f.refs?t._f.refs.every(e=>!I(e)):!I(t._f.ref))&&De(e)}x.unMount=new Set},_disableForm:e=>{F(e)&&(H.state.next({disabled:e}),ne(f,(t,r)=>{const s=A(f,r)
s&&(t.disabled=s._f.disabled||e,Array.isArray(s._f.refs)&&s._f.refs.forEach(t=>{t.disabled=s._f.disabled||e}))},0,!1))},_subjects:H,_proxyFormState:N,get _fields(){return f},get _formValues(){return m},get _state(){return g},set _state(e){g=e},get _defaultValues(){return y},get _names(){return x},set _names(e){x=e},get _formState(){return d},get _options(){return n},set _options(e){n={...n,...e}}},subscribe:e=>(g.mount=!0,W={...W,...e.formState},xe({...e,formState:{...O,...e.formState}})),trigger:_e,register:Oe,handleSubmit:Ne,watch:(e,t)=>k(e)?H.state.subscribe({next:r=>"values"in r&&e(r.values||me(void 0,t),r)}):me(e,t,!0),setValue:ge,setValues:(e,t={})=>{const r=k(e)?e(m):e
if(!E(m,r)){m={...m,...r}
for(const e of x.mount)pe(e,A(r,e),t,!0)
H.state.next({...d,name:void 0,type:void 0,values:m}),t.shouldValidate&&G()}},getValues:Ae,reset:Ce,resetField:(e,t={})=>{A(f,e)&&(V(t.defaultValue)?ge(e,l(A(y,e))):(ge(e,t.defaultValue),w(y,e,l(t.defaultValue))),t.keepTouched||q(d.touchedFields,e),t.keepDirty||(q(d.dirtyFields,e),d.isDirty=t.defaultValue?de(e,l(A(y,e))):de()),t.keepError||(q(d.errors,e),N.isValid&&G()),H.state.next({...d}))},resetDefaultValues:(e,t={})=>{if(y=l(e),!t.keepDirty){const e=z(y,m)
d.dirtyFields=e,d.isDirty=!L(e)}t.keepIsValid||G(),H.state.next({...d,defaultValues:y})},clearErrors:ke,unregister:De,setError:we,setFocus:(e,t={})=>{const r=A(f,e),s=r&&r._f
if(s){const e=s.refs?s.refs[0]:s.ref
e.focus&&setTimeout(()=>{e.focus(),t.shouldSelect&&k(e.select)&&e.select()})}},getFieldState:Fe}
return{...Ue,formControl:Ue}}function ve(t={}){const r=e.useRef(void 0),s=e.useRef(void 0),[a,i]=e.useState(()=>({...l(ye),isLoading:k(t.defaultValues),errors:t.errors||{},disabled:t.disabled||!1,defaultValues:k(t.defaultValues)?void 0:t.defaultValues}))
if(!r.current)if(t.formControl)r.current={...t.formControl,formState:a},t.defaultValues&&!k(t.defaultValues)&&t.formControl.reset(t.defaultValues,t.resetOptions)
else{const{formControl:e,...s}=me(t)
r.current={...s,formState:a}}const n=r.current.control
return n._options=t,x(()=>{const e=n._subscribe({formState:n._proxyFormState,callback:()=>i({...n._formState,defaultValues:n._defaultValues}),reRenderRoot:!0})
return i(e=>({...e,isReady:!0})),n._formState.isReady=!0,e},[n]),e.useEffect(()=>n._disableForm(t.disabled),[n,t.disabled]),e.useEffect(()=>{t.mode&&(n._options.mode=t.mode),t.reValidateMode&&(n._options.reValidateMode=t.reValidateMode)},[n,t.mode,t.reValidateMode]),e.useEffect(()=>{t.errors&&(n._setErrors(t.errors),n._focusError())},[n,t.errors]),e.useEffect(()=>{t.shouldUnregister&&n._subjects.state.next({values:n._getWatch()})},[n,t.shouldUnregister]),e.useEffect(()=>{if(n._proxyFormState.isDirty){const e=n._getDirty()
e!==a.isDirty&&n._subjects.state.next({isDirty:e})}},[n,a.isDirty]),e.useEffect(()=>{var e
t.values&&!E(t.values,s.current)?(n._reset(t.values,{keepFieldsRef:!0,...n._options.resetOptions}),(null===(e=n._options.resetOptions)||void 0===e?void 0:e.keepIsValid)||n._setValid(),s.current=t.values,i(e=>({...e}))):n._resetDefaultValues()},[n,t.values]),e.useEffect(()=>{n._state.mount||(n._setValid(),n._state.mount=!0),n._state.watch&&(n._state.watch=!1,n._subjects.state.next({...n._formState})),n._removeUnmounted()}),r.current.formState=e.useMemo(()=>((e,t,r,s=!0)=>{const a={}
for(const i in e)Object.defineProperty(a,i,{get:()=>{const r=i
return t._proxyFormState[r]!==c&&(t._proxyFormState[r]=!s||c),e[r]}})
return a})(a,n),[n,a]),r.current}const he=(e,t,r)=>{if(e&&"reportValidity"in e){const s=A(r,t)
e.setCustomValidity(s&&s.message||""),e.reportValidity()}},pe=(e,t)=>{for(const r in t.fields){const s=t.fields[r]
s&&s.ref&&"reportValidity"in s.ref?he(s.ref,r,e):s.refs&&s.refs.forEach(t=>he(t,r,e))}},ge=(e,t)=>{t.shouldUseNativeValidation&&pe(e,t)
const r={}
for(const s in e){const a=A(t.fields,s),i=Object.assign(e[s]||{},{ref:a&&a.ref})
if(be(t.names||Object.keys(e),s)){const e=Object.assign({},A(r,s))
w(e,"root",i),w(r,s,e)}else w(r,s,i)}return r},be=(e,t)=>e.some(e=>e.startsWith(t+"."))
var Ve=(e,t)=>{for(var r={};e.length;){var s=e[0],a=s.code,i=s.message,n=s.path.join(".")
if(!r[n])if("unionErrors"in s){var o=s.unionErrors[0].errors[0]
r[n]={message:o.message,type:o.code}}else r[n]={message:i,type:a}
if("unionErrors"in s&&s.unionErrors.forEach(t=>t.errors.forEach(t=>e.push(t))),t){var l=r[n].types,u=l&&l[s.code]
r[n]=N(n,t,r,a,u?[].concat(u,s.message):s.message)}e.shift()}return r},_e=(e,t,r)=>(void 0===r&&(r={}),(s,a,i)=>{try{return Promise.resolve(((a,n)=>{try{var o=Promise.resolve(e["sync"===r.mode?"parse":"parseAsync"](s,t)).then(e=>(i.shouldUseNativeValidation&&pe({},i),{errors:{},values:r.raw?s:e}))}catch(l){return n(l)}return o&&o.then?o.then(void 0,n):o})(0,e=>{if(t=e,Array.isArray(null==t?void 0:t.errors))return{values:{},errors:ge(Ve(e.errors,!i.shouldUseNativeValidation&&"all"===i.criteriaMode),i)}
var t
throw e}))}catch(n){return Promise.reject(n)}})
export{_e as t,ve as u}
