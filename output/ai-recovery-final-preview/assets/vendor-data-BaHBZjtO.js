var e,t,r,n,i,s,a,o,u,l,c,h,d,f,p,y,v,m,b,g,w,_,k,O,x,P,S,E,C,R,K,A,j,M,q,T,I,D,F,B,N,W,U,L,Q,$,V,z,H,G,Y,X,J,Z,ee,te,re,ne,ie,se,ae,oe,ue,le,ce,he,de,fe,pe,ye,ve,me,be,ge,we,_e,ke,Oe,xe,Pe,Se,Ee=e=>{throw TypeError(e)},Ce=(e,t,r)=>t.has(e)||Ee("Cannot "+r),Re=(e,t,r)=>(Ce(e,t,"read from private field"),r?r.call(e):t.get(e)),Ke=(e,t,r)=>t.has(e)?Ee("Cannot add the same private member more than once"):t instanceof WeakSet?t.add(e):t.set(e,r),Ae=(e,t,r,n)=>(Ce(e,t,"write to private field"),n?n.call(e,r):t.set(e,r),r),je=(e,t,r)=>(Ce(e,t,"access private method"),r),Me=(e,t,r,n)=>({set _(n){Ae(e,t,n,r)},get _(){return Re(e,t,n)}})
function qe(e,t){for(var r=0;r<t.length;r++){const n=t[r]
if("string"!=typeof n&&!Array.isArray(n))for(const t in n)if("default"!==t&&!(t in e)){const r=Object.getOwnPropertyDescriptor(n,t)
r&&Object.defineProperty(e,t,r.get?r:{enumerable:!0,get:()=>n[t]})}}return Object.freeze(Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}))}var Te="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof window?window:"undefined"!=typeof global?global:"undefined"!=typeof self?self:{}
function Ie(e){return e&&e.__esModule&&Object.prototype.hasOwnProperty.call(e,"default")?e.default:e}var De,Fe,Be,Ne,We={exports:{}},Ue={},Le={exports:{}},Qe={}
function $e(){if(De)return Qe
De=1
var e=Symbol.for("react.element"),t=Symbol.for("react.portal"),r=Symbol.for("react.fragment"),n=Symbol.for("react.strict_mode"),i=Symbol.for("react.profiler"),s=Symbol.for("react.provider"),a=Symbol.for("react.context"),o=Symbol.for("react.forward_ref"),u=Symbol.for("react.suspense"),l=Symbol.for("react.memo"),c=Symbol.for("react.lazy"),h=Symbol.iterator,d={isMounted:()=>!1,enqueueForceUpdate:()=>{},enqueueReplaceState:()=>{},enqueueSetState:()=>{}},f=Object.assign,p={}
function y(e,t,r){this.props=e,this.context=t,this.refs=p,this.updater=r||d}function v(){}function m(e,t,r){this.props=e,this.context=t,this.refs=p,this.updater=r||d}y.prototype.isReactComponent={},y.prototype.setState=function(e,t){if("object"!=typeof e&&"function"!=typeof e&&null!=e)throw Error("setState(...): takes an object of state variables to update or a function which returns an object of state variables.")
this.updater.enqueueSetState(this,e,t,"setState")},y.prototype.forceUpdate=function(e){this.updater.enqueueForceUpdate(this,e,"forceUpdate")},v.prototype=y.prototype
var b=m.prototype=new v
b.constructor=m,f(b,y.prototype),b.isPureReactComponent=!0
var g=Array.isArray,w=Object.prototype.hasOwnProperty,_={current:null},k={key:!0,ref:!0,__self:!0,__source:!0}
function O(t,r,n){var i,s={},a=null,o=null
if(null!=r)for(i in void 0!==r.ref&&(o=r.ref),void 0!==r.key&&(a=""+r.key),r)w.call(r,i)&&!k.hasOwnProperty(i)&&(s[i]=r[i])
var u=arguments.length-2
if(1===u)s.children=n
else if(1<u){for(var l=Array(u),c=0;c<u;c++)l[c]=arguments[c+2]
s.children=l}if(t&&t.defaultProps)for(i in u=t.defaultProps)void 0===s[i]&&(s[i]=u[i])
return{$$typeof:e,type:t,key:a,ref:o,props:s,_owner:_.current}}function x(t){return"object"==typeof t&&null!==t&&t.$$typeof===e}var P=/\/+/g
function S(e,t){return"object"==typeof e&&null!==e&&null!=e.key?(e=>{var t={"=":"=0",":":"=2"}
return"$"+e.replace(/[=:]/g,e=>t[e])})(""+e.key):t.toString(36)}function E(r,n,i,s,a){var o=typeof r
"undefined"!==o&&"boolean"!==o||(r=null)
var u=!1
if(null===r)u=!0
else switch(o){case"string":case"number":u=!0
break
case"object":switch(r.$$typeof){case e:case t:u=!0}}if(u)return a=a(u=r),r=""===s?"."+S(u,0):s,g(a)?(i="",null!=r&&(i=r.replace(P,"$&/")+"/"),E(a,n,i,"",e=>e)):null!=a&&(x(a)&&(a=((t,r)=>({$$typeof:e,type:t.type,key:r,ref:t.ref,props:t.props,_owner:t._owner}))(a,i+(!a.key||u&&u.key===a.key?"":(""+a.key).replace(P,"$&/")+"/")+r)),n.push(a)),1
if(u=0,s=""===s?".":s+":",g(r))for(var l=0;l<r.length;l++){var c=s+S(o=r[l],l)
u+=E(o,n,i,c,a)}else if(c=(e=>null===e||"object"!=typeof e?null:"function"==typeof(e=h&&e[h]||e["@@iterator"])?e:null)(r),"function"==typeof c)for(r=c.call(r),l=0;!(o=r.next()).done;)u+=E(o=o.value,n,i,c=s+S(o,l++),a)
else if("object"===o)throw n=String(r),Error("Objects are not valid as a React child (found: "+("[object Object]"===n?"object with keys {"+Object.keys(r).join(", ")+"}":n)+"). If you meant to render a collection of children, use an array instead.")
return u}function C(e,t,r){if(null==e)return e
var n=[],i=0
return E(e,n,"","",e=>t.call(r,e,i++)),n}function R(e){if(-1===e._status){var t=e._result;(t=t()).then(t=>{0!==e._status&&-1!==e._status||(e._status=1,e._result=t)},t=>{0!==e._status&&-1!==e._status||(e._status=2,e._result=t)}),-1===e._status&&(e._status=0,e._result=t)}if(1===e._status)return e._result.default
throw e._result}var K={current:null},A={transition:null},j={ReactCurrentDispatcher:K,ReactCurrentBatchConfig:A,ReactCurrentOwner:_}
function M(){throw Error("act(...) is not supported in production builds of React.")}return Qe.Children={map:C,forEach:function(e,t,r){C(e,function(){t.apply(this,arguments)},r)},count:e=>{var t=0
return C(e,()=>{t++}),t},toArray:e=>C(e,e=>e)||[],only:e=>{if(!x(e))throw Error("React.Children.only expected to receive a single React element child.")
return e}},Qe.Component=y,Qe.Fragment=r,Qe.Profiler=i,Qe.PureComponent=m,Qe.StrictMode=n,Qe.Suspense=u,Qe.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=j,Qe.act=M,Qe.cloneElement=function(t,r,n){if(null==t)throw Error("React.cloneElement(...): The argument must be a React element, but you passed "+t+".")
var i=f({},t.props),s=t.key,a=t.ref,o=t._owner
if(null!=r){if(void 0!==r.ref&&(a=r.ref,o=_.current),void 0!==r.key&&(s=""+r.key),t.type&&t.type.defaultProps)var u=t.type.defaultProps
for(l in r)w.call(r,l)&&!k.hasOwnProperty(l)&&(i[l]=void 0===r[l]&&void 0!==u?u[l]:r[l])}var l=arguments.length-2
if(1===l)i.children=n
else if(1<l){u=Array(l)
for(var c=0;c<l;c++)u[c]=arguments[c+2]
i.children=u}return{$$typeof:e,type:t.type,key:s,ref:a,props:i,_owner:o}},Qe.createContext=e=>((e={$$typeof:a,_currentValue:e,_currentValue2:e,_threadCount:0,Provider:null,Consumer:null,_defaultValue:null,_globalName:null}).Provider={$$typeof:s,_context:e},e.Consumer=e),Qe.createElement=O,Qe.createFactory=e=>{var t=O.bind(null,e)
return t.type=e,t},Qe.createRef=()=>({current:null}),Qe.forwardRef=e=>({$$typeof:o,render:e}),Qe.isValidElement=x,Qe.lazy=e=>({$$typeof:c,_payload:{_status:-1,_result:e},_init:R}),Qe.memo=(e,t)=>({$$typeof:l,type:e,compare:void 0===t?null:t}),Qe.startTransition=e=>{var t=A.transition
A.transition={}
try{e()}finally{A.transition=t}},Qe.unstable_act=M,Qe.useCallback=(e,t)=>K.current.useCallback(e,t),Qe.useContext=e=>K.current.useContext(e),Qe.useDebugValue=()=>{},Qe.useDeferredValue=e=>K.current.useDeferredValue(e),Qe.useEffect=(e,t)=>K.current.useEffect(e,t),Qe.useId=()=>K.current.useId(),Qe.useImperativeHandle=(e,t,r)=>K.current.useImperativeHandle(e,t,r),Qe.useInsertionEffect=(e,t)=>K.current.useInsertionEffect(e,t),Qe.useLayoutEffect=(e,t)=>K.current.useLayoutEffect(e,t),Qe.useMemo=(e,t)=>K.current.useMemo(e,t),Qe.useReducer=(e,t,r)=>K.current.useReducer(e,t,r),Qe.useRef=e=>K.current.useRef(e),Qe.useState=e=>K.current.useState(e),Qe.useSyncExternalStore=(e,t,r)=>K.current.useSyncExternalStore(e,t,r),Qe.useTransition=()=>K.current.useTransition(),Qe.version="18.3.1",Qe}function Ve(){return Fe||(Fe=1,Le.exports=$e()),Le.exports}var ze=(Ne||(Ne=1,We.exports=(()=>{if(Be)return Ue
Be=1
var e=Ve(),t=Symbol.for("react.element"),r=Symbol.for("react.fragment"),n=Object.prototype.hasOwnProperty,i=e.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner,s={key:!0,ref:!0,__self:!0,__source:!0}
function a(e,r,a){var o,u={},l=null,c=null
for(o in void 0!==a&&(l=""+a),void 0!==r.key&&(l=""+r.key),void 0!==r.ref&&(c=r.ref),r)n.call(r,o)&&!s.hasOwnProperty(o)&&(u[o]=r[o])
if(e&&e.defaultProps)for(o in r=e.defaultProps)void 0===u[o]&&(u[o]=r[o])
return{$$typeof:t,type:e,key:l,ref:c,props:u,_owner:i.current}}return Ue.Fragment=r,Ue.jsx=a,Ue.jsxs=a,Ue})()),We.exports),He=class{constructor(){this.listeners=new Set,this.subscribe=this.subscribe.bind(this)}subscribe(e){return this.listeners.add(e),this.onSubscribe(),()=>{this.listeners.delete(e),this.onUnsubscribe()}}hasListeners(){return this.listeners.size>0}onSubscribe(){}onUnsubscribe(){}},Ge=new(n=class extends He{constructor(){super(),Ke(this,e),Ke(this,t),Ke(this,r),Ae(this,r,e=>{if("undefined"!=typeof window&&window.addEventListener){const t=()=>e()
return window.addEventListener("visibilitychange",t,!1),()=>{window.removeEventListener("visibilitychange",t)}}})}onSubscribe(){Re(this,t)||this.setEventListener(Re(this,r))}onUnsubscribe(){var e
this.hasListeners()||(null==(e=Re(this,t))||e.call(this),Ae(this,t,void 0))}setEventListener(e){var n
Ae(this,r,e),null==(n=Re(this,t))||n.call(this),Ae(this,t,e(e=>{"boolean"==typeof e?this.setFocused(e):this.onFocus()}))}setFocused(t){Re(this,e)!==t&&(Ae(this,e,t),this.onFocus())}onFocus(){const e=this.isFocused()
this.listeners.forEach(t=>{t(e)})}isFocused(){return"boolean"==typeof Re(this,e)?Re(this,e):"hidden"!==globalThis.document?.visibilityState}},e=new WeakMap,t=new WeakMap,r=new WeakMap,n),Ye={setTimeout:(e,t)=>setTimeout(e,t),clearTimeout:e=>clearTimeout(e),setInterval:(e,t)=>setInterval(e,t),clearInterval:e=>clearInterval(e)},Xe=new(a=class{constructor(){Ke(this,i,Ye),Ke(this,s,!1)}setTimeoutProvider(e){Ae(this,i,e)}setTimeout(e,t){return Re(this,i).setTimeout(e,t)}clearTimeout(e){Re(this,i).clearTimeout(e)}setInterval(e,t){return Re(this,i).setInterval(e,t)}clearInterval(e){Re(this,i).clearInterval(e)}},i=new WeakMap,s=new WeakMap,a),Je="undefined"==typeof window||"Deno"in globalThis
function Ze(){}function et(e){return"number"==typeof e&&e>=0&&e!==1/0}function tt(e,t){return Math.max(e+(t||0)-Date.now(),0)}function rt(e,t){return"function"==typeof e?e(t):e}function nt(e,t){return"function"==typeof e?e(t):e}function it(e,t){const{type:r="all",exact:n,fetchStatus:i,predicate:s,queryKey:a,stale:o}=e
if(a)if(n){if(t.queryHash!==at(a,t.options))return!1}else if(!ut(t.queryKey,a))return!1
if("all"!==r){const e=t.isActive()
if("active"===r&&!e)return!1
if("inactive"===r&&e)return!1}return!("boolean"==typeof o&&t.isStale()!==o||i&&i!==t.state.fetchStatus||s&&!s(t))}function st(e,t){const{exact:r,status:n,predicate:i,mutationKey:s}=e
if(s){if(!t.options.mutationKey)return!1
if(r){if(ot(t.options.mutationKey)!==ot(s))return!1}else if(!ut(t.options.mutationKey,s))return!1}return!(n&&t.state.status!==n||i&&!i(t))}function at(e,t){return(t?.queryKeyHashFn||ot)(e)}function ot(e){return JSON.stringify(e,(e,t)=>ft(t)?Object.keys(t).sort().reduce((e,r)=>(e[r]=t[r],e),{}):t)}function ut(e,t){return e===t||typeof e==typeof t&&!(!e||!t||"object"!=typeof e||"object"!=typeof t)&&Object.keys(t).every(r=>ut(e[r],t[r]))}var lt=Object.prototype.hasOwnProperty
function ct(e,t,r=0){if(e===t)return e
if(r>500)return t
const n=dt(e)&&dt(t)
if(!(n||ft(e)&&ft(t)))return t
const i=(n?e:Object.keys(e)).length,s=n?t:Object.keys(t),a=s.length,o=n?new Array(a):{}
let u=0
for(let l=0;l<a;l++){const a=n?l:s[l],c=e[a],h=t[a]
if(c===h){o[a]=c,(n?l<i:lt.call(e,a))&&u++
continue}if(null===c||null===h||"object"!=typeof c||"object"!=typeof h){o[a]=h
continue}const d=ct(c,h,r+1)
o[a]=d,d===c&&u++}return i===a&&u===i?e:o}function ht(e,t){if(!t||Object.keys(e).length!==Object.keys(t).length)return!1
for(const r in e)if(e[r]!==t[r])return!1
return!0}function dt(e){return Array.isArray(e)&&e.length===Object.keys(e).length}function ft(e){if(!pt(e))return!1
const t=e.constructor
if(void 0===t)return!0
const r=t.prototype
return!!pt(r)&&!!r.hasOwnProperty("isPrototypeOf")&&Object.getPrototypeOf(e)===Object.prototype}function pt(e){return"[object Object]"===Object.prototype.toString.call(e)}function yt(e,t,r){return"function"==typeof r.structuralSharing?r.structuralSharing(e,t):!1!==r.structuralSharing?ct(e,t):t}function vt(e,t,r=0){const n=[...e,t]
return r&&n.length>r?n.slice(1):n}function mt(e,t,r=0){const n=[t,...e]
return r&&n.length>r?n.slice(0,-1):n}var bt=Symbol()
function gt(e,t){return!e.queryFn&&t?.initialPromise?()=>t.initialPromise:e.queryFn&&e.queryFn!==bt?e.queryFn:()=>Promise.reject(new Error(`Missing queryFn: '${e.queryHash}'`))}function wt(e,t){return"function"==typeof e?e(...t):!!e}var _t=(()=>{let e=()=>Je
return{isServer:()=>e(),setIsServer(t){e=t}}})()
function kt(){let e,t
const r=new Promise((r,n)=>{e=r,t=n})
function n(e){Object.assign(r,e),delete r.resolve,delete r.reject}return r.status="pending",r.catch(()=>{}),r.resolve=t=>{n({status:"fulfilled",value:t}),e(t)},r.reject=e=>{n({status:"rejected",reason:e}),t(e)},r}var Ot=e=>{setTimeout(e,0)},xt=(()=>{let e=[],t=0,r=e=>{e()},n=e=>{e()},i=Ot
const s=n=>{t?e.push(n):i(()=>{r(n)})}
return{batch:s=>{let a
t++
try{a=s()}finally{t--,t||(()=>{const t=e
e=[],t.length&&i(()=>{n(()=>{t.forEach(e=>{r(e)})})})})()}return a},batchCalls:e=>(...t)=>{s(()=>{e(...t)})},schedule:s,setNotifyFunction:e=>{r=e},setBatchNotifyFunction:e=>{n=e},setScheduler:e=>{i=e}}})(),Pt=new(c=class extends He{constructor(){super(),Ke(this,o,!0),Ke(this,u),Ke(this,l),Ae(this,l,e=>{if("undefined"!=typeof window&&window.addEventListener){const t=()=>e(!0),r=()=>e(!1)
return window.addEventListener("online",t,!1),window.addEventListener("offline",r,!1),()=>{window.removeEventListener("online",t),window.removeEventListener("offline",r)}}})}onSubscribe(){Re(this,u)||this.setEventListener(Re(this,l))}onUnsubscribe(){var e
this.hasListeners()||(null==(e=Re(this,u))||e.call(this),Ae(this,u,void 0))}setEventListener(e){var t
Ae(this,l,e),null==(t=Re(this,u))||t.call(this),Ae(this,u,e(this.setOnline.bind(this)))}setOnline(e){Re(this,o)!==e&&(Ae(this,o,e),this.listeners.forEach(t=>{t(e)}))}isOnline(){return Re(this,o)}},o=new WeakMap,u=new WeakMap,l=new WeakMap,c)
function St(e){return Math.min(1e3*2**e,3e4)}function Et(e){return"online"!==(e??"online")||Pt.isOnline()}var Ct=class extends Error{constructor(e){super("CancelledError"),this.revert=e?.revert,this.silent=e?.silent}}
function Rt(e){let t,r=!1,n=0
const i=kt(),s=()=>"pending"!==i.status,a=()=>Ge.isFocused()&&("always"===e.networkMode||Pt.isOnline())&&e.canRun(),o=()=>Et(e.networkMode)&&e.canRun(),u=e=>{s()||(t?.(),i.resolve(e))},l=e=>{s()||(t?.(),i.reject(e))},c=()=>new Promise(r=>{t=e=>{(s()||a())&&r(e)},e.onPause?.()}).then(()=>{t=void 0,s()||e.onContinue?.()}),h=()=>{if(s())return
let t
const i=0===n?e.initialPromise:void 0
try{t=i??e.fn()}catch(o){t=Promise.reject(o)}Promise.resolve(t).then(u).catch(t=>{if(s())return
const i=e.retry??(_t.isServer()?0:3),o=e.retryDelay??St,u="function"==typeof o?o(n,t):o,d=!0===i||"number"==typeof i&&n<i||"function"==typeof i&&i(n,t)
var f
!r&&d?(n++,e.onFail?.(n,t),(f=u,new Promise(e=>{Xe.setTimeout(e,f)})).then(()=>a()?void 0:c()).then(()=>{r?l(t):h()})):l(t)})}
return{promise:i,status:()=>i.status,cancel:t=>{if(!s()){const r=new Ct(t)
l(r),e.onCancel?.(r)}},continue:()=>(t?.(),i),cancelRetry:()=>{r=!0},continueRetry:()=>{r=!1},canStart:o,start:()=>(o()?h():c().then(h),i)}}var Kt=(d=class{constructor(){Ke(this,h)}destroy(){this.clearGcTimeout()}scheduleGc(){this.clearGcTimeout(),et(this.gcTime)&&Ae(this,h,Xe.setTimeout(()=>{this.optionalRemove()},this.gcTime))}updateGcTime(e){this.gcTime=Math.max(this.gcTime||0,e??(_t.isServer()?1/0:3e5))}clearGcTimeout(){void 0!==Re(this,h)&&(Xe.clearTimeout(Re(this,h)),Ae(this,h,void 0))}},h=new WeakMap,d)
function At(e,{pages:t,pageParams:r}){const n=t.length-1
return t.length>0?e.getNextPageParam(t[n],t,r[n],r):void 0}function jt(e,{pages:t,pageParams:r}){return t.length>0?e.getPreviousPageParam?.(t[0],t,r[0],r):void 0}function Mt(e,t){return!!t&&null!=At(e,t)}function qt(e,t){return!(!t||!e.getPreviousPageParam)&&null!=jt(e,t)}var Tt=(x=class extends Kt{constructor(e){super(),Ke(this,_),Ke(this,f),Ke(this,p),Ke(this,y),Ke(this,v),Ke(this,m),Ke(this,b),Ke(this,g),Ke(this,w),Ae(this,w,!1),Ae(this,g,e.defaultOptions),this.setOptions(e.options),this.observers=[],Ae(this,m,e.client),Ae(this,v,Re(this,m).getQueryCache()),this.queryKey=e.queryKey,this.queryHash=e.queryHash,Ae(this,p,Ft(this.options)),this.state=e.state??Re(this,p),this.scheduleGc()}get meta(){return this.options.meta}get queryType(){return Re(this,f)}get promise(){return Re(this,b)?.promise}setOptions(e){if(this.options={...Re(this,g),...e},e?._type&&Ae(this,f,e._type),this.updateGcTime(this.options.gcTime),this.state&&void 0===this.state.data){const e=Ft(this.options)
void 0!==e.data&&(this.setState(Dt(e.data,e.dataUpdatedAt)),Ae(this,p,e))}}optionalRemove(){this.observers.length||"idle"!==this.state.fetchStatus||Re(this,v).remove(this)}setData(e,t){const r=yt(this.state.data,e,this.options)
return je(this,_,O).call(this,{data:r,type:"success",dataUpdatedAt:t?.updatedAt,manual:t?.manual}),r}setState(e){je(this,_,O).call(this,{type:"setState",state:e})}cancel(e){const t=Re(this,b)?.promise
return Re(this,b)?.cancel(e),t?t.then(Ze).catch(Ze):Promise.resolve()}destroy(){super.destroy(),this.cancel({silent:!0})}get resetState(){return Re(this,p)}reset(){this.destroy(),this.setState(this.resetState)}isActive(){return this.observers.some(e=>!1!==nt(e.options.enabled,this))}isDisabled(){return this.getObserversCount()>0?!this.isActive():this.options.queryFn===bt||!this.isFetched()}isFetched(){return this.state.dataUpdateCount+this.state.errorUpdateCount>0}isStatic(){return this.getObserversCount()>0&&this.observers.some(e=>"static"===rt(e.options.staleTime,this))}isStale(){return this.getObserversCount()>0?this.observers.some(e=>e.getCurrentResult().isStale):void 0===this.state.data||this.state.isInvalidated}isStaleByTime(e=0){return void 0===this.state.data||"static"!==e&&(!!this.state.isInvalidated||!tt(this.state.dataUpdatedAt,e))}onFocus(){const e=this.observers.find(e=>e.shouldFetchOnWindowFocus())
e?.refetch({cancelRefetch:!1}),Re(this,b)?.continue()}onOnline(){const e=this.observers.find(e=>e.shouldFetchOnReconnect())
e?.refetch({cancelRefetch:!1}),Re(this,b)?.continue()}addObserver(e){this.observers.includes(e)||(this.observers.push(e),this.clearGcTimeout(),Re(this,v).notify({type:"observerAdded",query:this,observer:e}))}removeObserver(e){this.observers.includes(e)&&(this.observers=this.observers.filter(t=>t!==e),this.observers.length||(Re(this,b)&&(Re(this,w)||je(this,_,k).call(this)?Re(this,b).cancel({revert:!0}):Re(this,b).cancelRetry()),this.scheduleGc()),Re(this,v).notify({type:"observerRemoved",query:this,observer:e}))}getObserversCount(){return this.observers.length}invalidate(){this.state.isInvalidated||je(this,_,O).call(this,{type:"invalidate"})}async fetch(e,t){if("idle"!==this.state.fetchStatus&&"rejected"!==Re(this,b)?.status())if(void 0!==this.state.data&&t?.cancelRefetch)this.cancel({silent:!0})
else if(Re(this,b))return Re(this,b).continueRetry(),Re(this,b).promise
if(e&&this.setOptions(e),!this.options.queryFn){const e=this.observers.find(e=>e.options.queryFn)
e&&this.setOptions(e.options)}const r=new AbortController,n=e=>{Object.defineProperty(e,"signal",{enumerable:!0,get:()=>(Ae(this,w,!0),r.signal)})},i=()=>{const e=gt(this.options,t),r=(()=>{const e={client:Re(this,m),queryKey:this.queryKey,meta:this.meta}
return n(e),e})()
return Ae(this,w,!1),this.options.persister?this.options.persister(e,r,this):e(r)},s=(()=>{const e={fetchOptions:t,options:this.options,queryKey:this.queryKey,client:Re(this,m),state:this.state,fetchFn:i}
return n(e),e})(),a="infinite"===Re(this,f)?(o=this.options.pages,{onFetch:(e,t)=>{const r=e.options,n=e.fetchOptions?.meta?.fetchMore?.direction,i=e.state.data?.pages||[],s=e.state.data?.pageParams||[]
let a={pages:[],pageParams:[]},u=0
const l=async()=>{let t=!1
const l=gt(e.options,e.fetchOptions),c=async(r,n,i)=>{if(t)return Promise.reject(e.signal.reason)
if(null==n&&r.pages.length)return Promise.resolve(r)
const s=(()=>{const r={client:e.client,queryKey:e.queryKey,pageParam:n,direction:i?"backward":"forward",meta:e.options.meta}
return((t,r,n)=>{let i,s=!1
Object.defineProperty(t,"signal",{enumerable:!0,get:()=>(i??(i=e.signal),s||(s=!0,i.aborted?n():i.addEventListener("abort",n,{once:!0})),i)})})(r,0,()=>t=!0),r})(),a=await l(s),{maxPages:o}=e.options,u=i?mt:vt
return{pages:u(r.pages,a,o),pageParams:u(r.pageParams,n,o)}}
if(n&&i.length){const e="backward"===n,t={pages:i,pageParams:s},o=(e?jt:At)(r,t)
a=await c(t,o,e)}else{const e=o??i.length
do{const e=0===u?s[0]??r.initialPageParam:At(r,a)
if(u>0&&null==e)break
a=await c(a,e),u++}while(u<e)}return a}
e.options.persister?e.fetchFn=()=>e.options.persister?.(l,{client:e.client,queryKey:e.queryKey,meta:e.options.meta,signal:e.signal},t):e.fetchFn=l}}):this.options.behavior
var o
a?.onFetch(s,this),Ae(this,y,this.state),"idle"!==this.state.fetchStatus&&this.state.fetchMeta===s.fetchOptions?.meta||je(this,_,O).call(this,{type:"fetch",meta:s.fetchOptions?.meta}),Ae(this,b,Rt({initialPromise:t?.initialPromise,fn:s.fetchFn,onCancel:e=>{e instanceof Ct&&e.revert&&this.setState({...Re(this,y),fetchStatus:"idle"}),r.abort()},onFail:(e,t)=>{je(this,_,O).call(this,{type:"failed",failureCount:e,error:t})},onPause:()=>{je(this,_,O).call(this,{type:"pause"})},onContinue:()=>{je(this,_,O).call(this,{type:"continue"})},retry:s.options.retry,retryDelay:s.options.retryDelay,networkMode:s.options.networkMode,canRun:()=>!0}))
try{const e=await Re(this,b).start()
if(void 0===e)throw new Error(`${this.queryHash} data is undefined`)
return this.setData(e),Re(this,v).config.onSuccess?.(e,this),Re(this,v).config.onSettled?.(e,this.state.error,this),e}catch(u){if(u instanceof Ct){if(u.silent)return Re(this,b).promise
if(u.revert){if(void 0===this.state.data)throw u
return this.state.data}}throw je(this,_,O).call(this,{type:"error",error:u}),Re(this,v).config.onError?.(u,this),Re(this,v).config.onSettled?.(this.state.data,u,this),u}finally{this.scheduleGc()}}},f=new WeakMap,p=new WeakMap,y=new WeakMap,v=new WeakMap,m=new WeakMap,b=new WeakMap,g=new WeakMap,w=new WeakMap,_=new WeakSet,k=function(){return"paused"===this.state.fetchStatus&&"pending"===this.state.status},O=function(e){this.state=(t=>{switch(e.type){case"failed":return{...t,fetchFailureCount:e.failureCount,fetchFailureReason:e.error}
case"pause":return{...t,fetchStatus:"paused"}
case"continue":return{...t,fetchStatus:"fetching"}
case"fetch":return{...t,...It(t.data,this.options),fetchMeta:e.meta??null}
case"success":const r={...t,...Dt(e.data,e.dataUpdatedAt),dataUpdateCount:t.dataUpdateCount+1,...!e.manual&&{fetchStatus:"idle",fetchFailureCount:0,fetchFailureReason:null}}
return Ae(this,y,e.manual?r:void 0),r
case"error":const n=e.error
return{...t,error:n,errorUpdateCount:t.errorUpdateCount+1,errorUpdatedAt:Date.now(),fetchFailureCount:t.fetchFailureCount+1,fetchFailureReason:n,fetchStatus:"idle",status:"error",isInvalidated:!0}
case"invalidate":return{...t,isInvalidated:!0}
case"setState":return{...t,...e.state}}})(this.state),xt.batch(()=>{this.observers.forEach(e=>{e.onQueryUpdate()}),Re(this,v).notify({query:this,type:"updated",action:e})})},x)
function It(e,t){return{fetchFailureCount:0,fetchFailureReason:null,fetchStatus:Et(t.networkMode)?"fetching":"paused",...void 0===e&&{error:null,status:"pending"}}}function Dt(e,t){return{data:e,dataUpdatedAt:t??Date.now(),error:null,isInvalidated:!1,status:"success"}}function Ft(e){const t="function"==typeof e.initialData?e.initialData():e.initialData,r=void 0!==t,n=r?"function"==typeof e.initialDataUpdatedAt?e.initialDataUpdatedAt():e.initialDataUpdatedAt:0
return{data:t,dataUpdateCount:0,dataUpdatedAt:r?n??Date.now():0,error:null,errorUpdateCount:0,errorUpdatedAt:0,fetchFailureCount:0,fetchFailureReason:null,fetchMeta:null,isInvalidated:!1,status:r?"success":"pending",fetchStatus:"idle"}}var Bt=(Y=class extends He{constructor(e,t){super(),Ke(this,N),Ke(this,P),Ke(this,S),Ke(this,E),Ke(this,C),Ke(this,R),Ke(this,K),Ke(this,A),Ke(this,j),Ke(this,M),Ke(this,q),Ke(this,T),Ke(this,I),Ke(this,D),Ke(this,F),Ke(this,B,new Set),this.options=t,Ae(this,P,e),Ae(this,j,null),Ae(this,A,kt()),this.bindMethods(),this.setOptions(t)}bindMethods(){this.refetch=this.refetch.bind(this)}onSubscribe(){1===this.listeners.size&&(Re(this,S).addObserver(this),Nt(Re(this,S),this.options)?je(this,N,W).call(this):this.updateResult(),je(this,N,$).call(this))}onUnsubscribe(){this.hasListeners()||this.destroy()}shouldFetchOnReconnect(){return Wt(Re(this,S),this.options,this.options.refetchOnReconnect)}shouldFetchOnWindowFocus(){return Wt(Re(this,S),this.options,this.options.refetchOnWindowFocus)}destroy(){this.listeners=new Set,je(this,N,V).call(this),je(this,N,z).call(this),Re(this,S).removeObserver(this)}setOptions(e){const t=this.options,r=Re(this,S)
if(this.options=Re(this,P).defaultQueryOptions(e),void 0!==this.options.enabled&&"boolean"!=typeof this.options.enabled&&"function"!=typeof this.options.enabled&&"boolean"!=typeof nt(this.options.enabled,Re(this,S)))throw new Error("Expected enabled to be a boolean or a callback that returns a boolean")
je(this,N,H).call(this),Re(this,S).setOptions(this.options),t._defaulted&&!ht(this.options,t)&&Re(this,P).getQueryCache().notify({type:"observerOptionsUpdated",query:Re(this,S),observer:this})
const n=this.hasListeners()
n&&Ut(Re(this,S),r,this.options,t)&&je(this,N,W).call(this),this.updateResult(),!n||Re(this,S)===r&&nt(this.options.enabled,Re(this,S))===nt(t.enabled,Re(this,S))&&rt(this.options.staleTime,Re(this,S))===rt(t.staleTime,Re(this,S))||je(this,N,U).call(this)
const i=je(this,N,L).call(this)
!n||Re(this,S)===r&&nt(this.options.enabled,Re(this,S))===nt(t.enabled,Re(this,S))&&i===Re(this,F)||je(this,N,Q).call(this,i)}getOptimisticResult(e){const t=Re(this,P).getQueryCache().build(Re(this,P),e),r=this.createResult(t,e)
return n=r,!ht(this.getCurrentResult(),n)&&(Ae(this,C,r),Ae(this,K,this.options),Ae(this,R,Re(this,S).state)),r
var n}getCurrentResult(){return Re(this,C)}trackResult(e,t){return new Proxy(e,{get:(e,r)=>(this.trackProp(r),t?.(r),"promise"===r&&(this.trackProp("data"),this.options.experimental_prefetchInRender||"pending"!==Re(this,A).status||Re(this,A).reject(new Error("experimental_prefetchInRender feature flag is not enabled"))),Reflect.get(e,r))})}trackProp(e){Re(this,B).add(e)}getCurrentQuery(){return Re(this,S)}refetch({...e}={}){return this.fetch({...e})}fetchOptimistic(e){const t=Re(this,P).defaultQueryOptions(e),r=Re(this,P).getQueryCache().build(Re(this,P),t)
return r.fetch().then(()=>this.createResult(r,t))}fetch(e){return je(this,N,W).call(this,{...e,cancelRefetch:e.cancelRefetch??!0}).then(()=>(this.updateResult(),Re(this,C)))}createResult(e,t){const r=Re(this,S),n=this.options,i=Re(this,C),s=Re(this,R),a=Re(this,K),o=e!==r?e.state:Re(this,E),{state:u}=e
let l,c={...u},h=!1
if(t._optimisticResults){const i=this.hasListeners(),s=!i&&Nt(e,t),a=i&&Ut(e,r,t,n);(s||a)&&(c={...c,...It(u.data,e.options)}),"isRestoring"===t._optimisticResults&&(c.fetchStatus="idle")}let{error:d,errorUpdatedAt:f,status:p}=c
l=c.data
let y=!1
if(void 0!==t.placeholderData&&void 0===l&&"pending"===p){let e
i?.isPlaceholderData&&t.placeholderData===a?.placeholderData?(e=i.data,y=!0):e="function"==typeof t.placeholderData?t.placeholderData(Re(this,T)?.state.data,Re(this,T)):t.placeholderData,void 0!==e&&(p="success",l=yt(i?.data,e,t),h=!0)}if(t.select&&void 0!==l&&!y)if(i&&l===s?.data&&t.select===Re(this,M))l=Re(this,q)
else try{Ae(this,M,t.select),l=t.select(l),l=yt(i?.data,l,t),Ae(this,q,l),Ae(this,j,null)}catch(k){Ae(this,j,k)}Re(this,j)&&(d=Re(this,j),l=Re(this,q),f=Date.now(),p="error")
const v="fetching"===c.fetchStatus,m="pending"===p,b="error"===p,g=m&&v,w=void 0!==l,_={status:p,fetchStatus:c.fetchStatus,isPending:m,isSuccess:"success"===p,isError:b,isInitialLoading:g,isLoading:g,data:l,dataUpdatedAt:c.dataUpdatedAt,error:d,errorUpdatedAt:f,failureCount:c.fetchFailureCount,failureReason:c.fetchFailureReason,errorUpdateCount:c.errorUpdateCount,isFetched:e.isFetched(),isFetchedAfterMount:c.dataUpdateCount>o.dataUpdateCount||c.errorUpdateCount>o.errorUpdateCount,isFetching:v,isRefetching:v&&!m,isLoadingError:b&&!w,isPaused:"paused"===c.fetchStatus,isPlaceholderData:h,isRefetchError:b&&w,isStale:Lt(e,t),refetch:this.refetch,promise:Re(this,A),isEnabled:!1!==nt(t.enabled,e)}
if(this.options.experimental_prefetchInRender){const t=void 0!==_.data,n="error"===_.status&&!t,i=e=>{n?e.reject(_.error):t&&e.resolve(_.data)},s=()=>{const e=Ae(this,A,_.promise=kt())
i(e)},a=Re(this,A)
switch(a.status){case"pending":e.queryHash===r.queryHash&&i(a)
break
case"fulfilled":(n||_.data!==a.value)&&s()
break
case"rejected":n&&_.error===a.reason||s()}}return _}updateResult(){const e=Re(this,C),t=this.createResult(Re(this,S),this.options)
Ae(this,R,Re(this,S).state),Ae(this,K,this.options),void 0!==Re(this,R).data&&Ae(this,T,Re(this,S)),ht(t,e)||(Ae(this,C,t),je(this,N,G).call(this,{listeners:(()=>{if(!e)return!0
const{notifyOnChangeProps:t}=this.options,r="function"==typeof t?t():t
if("all"===r||!r&&!Re(this,B).size)return!0
const n=new Set(r??Re(this,B))
return this.options.throwOnError&&n.add("error"),Object.keys(Re(this,C)).some(t=>{const r=t
return Re(this,C)[r]!==e[r]&&n.has(r)})})()}))}onQueryUpdate(){this.updateResult(),this.hasListeners()&&je(this,N,$).call(this)}},P=new WeakMap,S=new WeakMap,E=new WeakMap,C=new WeakMap,R=new WeakMap,K=new WeakMap,A=new WeakMap,j=new WeakMap,M=new WeakMap,q=new WeakMap,T=new WeakMap,I=new WeakMap,D=new WeakMap,F=new WeakMap,B=new WeakMap,N=new WeakSet,W=function(e){je(this,N,H).call(this)
let t=Re(this,S).fetch(this.options,e)
return e?.throwOnError||(t=t.catch(Ze)),t},U=function(){je(this,N,V).call(this)
const e=rt(this.options.staleTime,Re(this,S))
if(_t.isServer()||Re(this,C).isStale||!et(e))return
const t=tt(Re(this,C).dataUpdatedAt,e)+1
Ae(this,I,Xe.setTimeout(()=>{Re(this,C).isStale||this.updateResult()},t))},L=function(){return("function"==typeof this.options.refetchInterval?this.options.refetchInterval(Re(this,S)):this.options.refetchInterval)??!1},Q=function(e){je(this,N,z).call(this),Ae(this,F,e),!_t.isServer()&&!1!==nt(this.options.enabled,Re(this,S))&&et(Re(this,F))&&0!==Re(this,F)&&Ae(this,D,Xe.setInterval(()=>{(this.options.refetchIntervalInBackground||Ge.isFocused())&&je(this,N,W).call(this)},Re(this,F)))},$=function(){je(this,N,U).call(this),je(this,N,Q).call(this,je(this,N,L).call(this))},V=function(){void 0!==Re(this,I)&&(Xe.clearTimeout(Re(this,I)),Ae(this,I,void 0))},z=function(){void 0!==Re(this,D)&&(Xe.clearInterval(Re(this,D)),Ae(this,D,void 0))},H=function(){const e=Re(this,P).getQueryCache().build(Re(this,P),this.options)
if(e===Re(this,S))return
const t=Re(this,S)
Ae(this,S,e),Ae(this,E,e.state),this.hasListeners()&&(t?.removeObserver(this),e.addObserver(this))},G=function(e){xt.batch(()=>{e.listeners&&this.listeners.forEach(e=>{e(Re(this,C))}),Re(this,P).getQueryCache().notify({query:Re(this,S),type:"observerResultsUpdated"})})},Y)
function Nt(e,t){return((e,t)=>!1!==nt(t.enabled,e)&&void 0===e.state.data&&!("error"===e.state.status&&!1===nt(t.retryOnMount,e)))(e,t)||void 0!==e.state.data&&Wt(e,t,t.refetchOnMount)}function Wt(e,t,r){if(!1!==nt(t.enabled,e)&&"static"!==rt(t.staleTime,e)){const n="function"==typeof r?r(e):r
return"always"===n||!1!==n&&Lt(e,t)}return!1}function Ut(e,t,r,n){return(e!==t||!1===nt(n.enabled,e))&&(!r.suspense||"error"!==e.state.status)&&Lt(e,r)}function Lt(e,t){return!1!==nt(t.enabled,e)&&e.isStaleByTime(rt(t.staleTime,e))}var Qt=class extends Bt{constructor(e,t){super(e,t)}bindMethods(){super.bindMethods(),this.fetchNextPage=this.fetchNextPage.bind(this),this.fetchPreviousPage=this.fetchPreviousPage.bind(this)}setOptions(e){e._type="infinite",super.setOptions(e)}getOptimisticResult(e){return e._type="infinite",super.getOptimisticResult(e)}fetchNextPage(e){return this.fetch({...e,meta:{fetchMore:{direction:"forward"}}})}fetchPreviousPage(e){return this.fetch({...e,meta:{fetchMore:{direction:"backward"}}})}createResult(e,t){const{state:r}=e,n=super.createResult(e,t),{isFetching:i,isRefetching:s,isError:a,isRefetchError:o}=n,u=r.fetchMeta?.fetchMore?.direction,l=a&&"forward"===u,c=i&&"forward"===u,h=a&&"backward"===u,d=i&&"backward"===u
return{...n,fetchNextPage:this.fetchNextPage,fetchPreviousPage:this.fetchPreviousPage,hasNextPage:Mt(t,r.data),hasPreviousPage:qt(t,r.data),isFetchNextPageError:l,isFetchingNextPage:c,isFetchPreviousPageError:h,isFetchingPreviousPage:d,isRefetchError:o&&!l&&!h,isRefetching:s&&!c&&!d}}},$t=(ne=class extends Kt{constructor(e){super(),Ke(this,te),Ke(this,X),Ke(this,J),Ke(this,Z),Ke(this,ee),Ae(this,X,e.client),this.mutationId=e.mutationId,Ae(this,Z,e.mutationCache),Ae(this,J,[]),this.state=e.state||{context:void 0,data:void 0,error:null,failureCount:0,failureReason:null,isPaused:!1,status:"idle",variables:void 0,submittedAt:0},this.setOptions(e.options),this.scheduleGc()}setOptions(e){this.options=e,this.updateGcTime(this.options.gcTime)}get meta(){return this.options.meta}addObserver(e){Re(this,J).includes(e)||(Re(this,J).push(e),this.clearGcTimeout(),Re(this,Z).notify({type:"observerAdded",mutation:this,observer:e}))}removeObserver(e){Ae(this,J,Re(this,J).filter(t=>t!==e)),this.scheduleGc(),Re(this,Z).notify({type:"observerRemoved",mutation:this,observer:e})}optionalRemove(){Re(this,J).length||("pending"===this.state.status?this.scheduleGc():Re(this,Z).remove(this))}continue(){return Re(this,ee)?.continue()??this.execute(this.state.variables)}async execute(e){const t=()=>{je(this,te,re).call(this,{type:"continue"})},r={client:Re(this,X),meta:this.options.meta,mutationKey:this.options.mutationKey}
Ae(this,ee,Rt({fn:()=>this.options.mutationFn?this.options.mutationFn(e,r):Promise.reject(new Error("No mutationFn found")),onFail:(e,t)=>{je(this,te,re).call(this,{type:"failed",failureCount:e,error:t})},onPause:()=>{je(this,te,re).call(this,{type:"pause"})},onContinue:t,retry:this.options.retry??0,retryDelay:this.options.retryDelay,networkMode:this.options.networkMode,canRun:()=>Re(this,Z).canRun(this)}))
const n="pending"===this.state.status,i=!Re(this,ee).canStart()
try{if(n)t()
else{je(this,te,re).call(this,{type:"pending",variables:e,isPaused:i}),Re(this,Z).config.onMutate&&await Re(this,Z).config.onMutate(e,this,r)
const t=await(this.options.onMutate?.(e,r))
t!==this.state.context&&je(this,te,re).call(this,{type:"pending",context:t,variables:e,isPaused:i})}const s=await Re(this,ee).start()
return await(Re(this,Z).config.onSuccess?.(s,e,this.state.context,this,r)),await(this.options.onSuccess?.(s,e,this.state.context,r)),await(Re(this,Z).config.onSettled?.(s,null,this.state.variables,this.state.context,this,r)),await(this.options.onSettled?.(s,null,e,this.state.context,r)),je(this,te,re).call(this,{type:"success",data:s}),s}catch(s){try{await(Re(this,Z).config.onError?.(s,e,this.state.context,this,r))}catch(a){Promise.reject(a)}try{await(this.options.onError?.(s,e,this.state.context,r))}catch(a){Promise.reject(a)}try{await(Re(this,Z).config.onSettled?.(void 0,s,this.state.variables,this.state.context,this,r))}catch(a){Promise.reject(a)}try{await(this.options.onSettled?.(void 0,s,e,this.state.context,r))}catch(a){Promise.reject(a)}throw je(this,te,re).call(this,{type:"error",error:s}),s}finally{Re(this,Z).runNext(this)}}},X=new WeakMap,J=new WeakMap,Z=new WeakMap,ee=new WeakMap,te=new WeakSet,re=function(e){this.state=(t=>{switch(e.type){case"failed":return{...t,failureCount:e.failureCount,failureReason:e.error}
case"pause":return{...t,isPaused:!0}
case"continue":return{...t,isPaused:!1}
case"pending":return{...t,context:e.context,data:void 0,failureCount:0,failureReason:null,error:null,isPaused:e.isPaused,status:"pending",variables:e.variables,submittedAt:Date.now()}
case"success":return{...t,data:e.data,failureCount:0,failureReason:null,error:null,status:"success",isPaused:!1}
case"error":return{...t,data:void 0,error:e.error,failureCount:t.failureCount+1,failureReason:e.error,isPaused:!1,status:"error"}}})(this.state),xt.batch(()=>{Re(this,J).forEach(t=>{t.onMutationUpdate(e)}),Re(this,Z).notify({mutation:this,type:"updated",action:e})})},ne),Vt=(oe=class extends He{constructor(e={}){super(),Ke(this,ie),Ke(this,se),Ke(this,ae),this.config=e,Ae(this,ie,new Set),Ae(this,se,new Map),Ae(this,ae,0)}build(e,t,r){const n=new $t({client:e,mutationCache:this,mutationId:++Me(this,ae)._,options:e.defaultMutationOptions(t),state:r})
return this.add(n),n}add(e){Re(this,ie).add(e)
const t=zt(e)
if("string"==typeof t){const r=Re(this,se).get(t)
r?r.push(e):Re(this,se).set(t,[e])}this.notify({type:"added",mutation:e})}remove(e){if(Re(this,ie).delete(e)){const t=zt(e)
if("string"==typeof t){const r=Re(this,se).get(t)
if(r)if(r.length>1){const t=r.indexOf(e);-1!==t&&r.splice(t,1)}else r[0]===e&&Re(this,se).delete(t)}}this.notify({type:"removed",mutation:e})}canRun(e){const t=zt(e)
if("string"==typeof t){const r=Re(this,se).get(t),n=r?.find(e=>"pending"===e.state.status)
return!n||n===e}return!0}runNext(e){const t=zt(e)
if("string"==typeof t){const r=Re(this,se).get(t)?.find(t=>t!==e&&t.state.isPaused)
return r?.continue()??Promise.resolve()}return Promise.resolve()}clear(){xt.batch(()=>{Re(this,ie).forEach(e=>{this.notify({type:"removed",mutation:e})}),Re(this,ie).clear(),Re(this,se).clear()})}getAll(){return Array.from(Re(this,ie))}find(e){const t={exact:!0,...e}
return this.getAll().find(e=>st(t,e))}findAll(e={}){return this.getAll().filter(t=>st(e,t))}notify(e){xt.batch(()=>{this.listeners.forEach(t=>{t(e)})})}resumePausedMutations(){const e=this.getAll().filter(e=>e.state.isPaused)
return xt.batch(()=>Promise.all(e.map(e=>e.continue().catch(Ze))))}},ie=new WeakMap,se=new WeakMap,ae=new WeakMap,oe)
function zt(e){return e.options.scope?.id}var Ht=(ye=class extends He{constructor(e,t){super(),Ke(this,de),Ke(this,ue),Ke(this,le),Ke(this,ce),Ke(this,he),Ae(this,ue,e),this.setOptions(t),this.bindMethods(),je(this,de,fe).call(this)}bindMethods(){this.mutate=this.mutate.bind(this),this.reset=this.reset.bind(this)}setOptions(e){const t=this.options
this.options=Re(this,ue).defaultMutationOptions(e),ht(this.options,t)||Re(this,ue).getMutationCache().notify({type:"observerOptionsUpdated",mutation:Re(this,ce),observer:this}),t?.mutationKey&&this.options.mutationKey&&ot(t.mutationKey)!==ot(this.options.mutationKey)?this.reset():"pending"===Re(this,ce)?.state.status&&Re(this,ce).setOptions(this.options)}onUnsubscribe(){this.hasListeners()||Re(this,ce)?.removeObserver(this)}onMutationUpdate(e){je(this,de,fe).call(this),je(this,de,pe).call(this,e)}getCurrentResult(){return Re(this,le)}reset(){Re(this,ce)?.removeObserver(this),Ae(this,ce,void 0),je(this,de,fe).call(this),je(this,de,pe).call(this)}mutate(e,t){return Ae(this,he,t),Re(this,ce)?.removeObserver(this),Ae(this,ce,Re(this,ue).getMutationCache().build(Re(this,ue),this.options)),Re(this,ce).addObserver(this),Re(this,ce).execute(e)}},ue=new WeakMap,le=new WeakMap,ce=new WeakMap,he=new WeakMap,de=new WeakSet,fe=function(){const e=Re(this,ce)?.state??{context:void 0,data:void 0,error:null,failureCount:0,failureReason:null,isPaused:!1,status:"idle",variables:void 0,submittedAt:0}
Ae(this,le,{...e,isPending:"pending"===e.status,isSuccess:"success"===e.status,isError:"error"===e.status,isIdle:"idle"===e.status,mutate:this.mutate,reset:this.reset})},pe=function(e){xt.batch(()=>{if(Re(this,he)&&this.hasListeners()){const r=Re(this,le).variables,n=Re(this,le).context,i={client:Re(this,ue),meta:this.options.meta,mutationKey:this.options.mutationKey}
if("success"===e?.type){try{Re(this,he).onSuccess?.(e.data,r,n,i)}catch(t){Promise.reject(t)}try{Re(this,he).onSettled?.(e.data,null,r,n,i)}catch(t){Promise.reject(t)}}else if("error"===e?.type){try{Re(this,he).onError?.(e.error,r,n,i)}catch(t){Promise.reject(t)}try{Re(this,he).onSettled?.(void 0,e.error,r,n,i)}catch(t){Promise.reject(t)}}}this.listeners.forEach(e=>{e(Re(this,le))})})},ye),Gt=(me=class extends He{constructor(e={}){super(),Ke(this,ve),this.config=e,Ae(this,ve,new Map)}build(e,t,r){const n=t.queryKey,i=t.queryHash??at(n,t)
let s=this.get(i)
return s||(s=new Tt({client:e,queryKey:n,queryHash:i,options:e.defaultQueryOptions(t),state:r,defaultOptions:e.getQueryDefaults(n)}),this.add(s)),s}add(e){Re(this,ve).has(e.queryHash)||(Re(this,ve).set(e.queryHash,e),this.notify({type:"added",query:e}))}remove(e){const t=Re(this,ve).get(e.queryHash)
t&&(e.destroy(),t===e&&Re(this,ve).delete(e.queryHash),this.notify({type:"removed",query:e}))}clear(){xt.batch(()=>{this.getAll().forEach(e=>{this.remove(e)})})}get(e){return Re(this,ve).get(e)}getAll(){return[...Re(this,ve).values()]}find(e){const t={exact:!0,...e}
return this.getAll().find(e=>it(t,e))}findAll(e={}){const t=this.getAll()
return Object.keys(e).length>0?t.filter(t=>it(e,t)):t}notify(e){xt.batch(()=>{this.listeners.forEach(t=>{t(e)})})}onFocus(){xt.batch(()=>{this.getAll().forEach(e=>{e.onFocus()})})}onOnline(){xt.batch(()=>{this.getAll().forEach(e=>{e.onOnline()})})}},ve=new WeakMap,me),Yt=(Se=class{constructor(e={}){Ke(this,be),Ke(this,ge),Ke(this,we),Ke(this,_e),Ke(this,ke),Ke(this,Oe),Ke(this,xe),Ke(this,Pe),Ae(this,be,e.queryCache||new Gt),Ae(this,ge,e.mutationCache||new Vt),Ae(this,we,e.defaultOptions||{}),Ae(this,_e,new Map),Ae(this,ke,new Map),Ae(this,Oe,0)}mount(){Me(this,Oe)._++,1===Re(this,Oe)&&(Ae(this,xe,Ge.subscribe(async e=>{e&&(await this.resumePausedMutations(),Re(this,be).onFocus())})),Ae(this,Pe,Pt.subscribe(async e=>{e&&(await this.resumePausedMutations(),Re(this,be).onOnline())})))}unmount(){var e,t
Me(this,Oe)._--,0===Re(this,Oe)&&(null==(e=Re(this,xe))||e.call(this),Ae(this,xe,void 0),null==(t=Re(this,Pe))||t.call(this),Ae(this,Pe,void 0))}isFetching(e){return Re(this,be).findAll({...e,fetchStatus:"fetching"}).length}isMutating(e){return Re(this,ge).findAll({...e,status:"pending"}).length}getQueryData(e){const t=this.defaultQueryOptions({queryKey:e})
return Re(this,be).get(t.queryHash)?.state.data}ensureQueryData(e){const t=this.defaultQueryOptions(e),r=Re(this,be).build(this,t),n=r.state.data
return void 0===n?this.fetchQuery(e):(e.revalidateIfStale&&r.isStaleByTime(rt(t.staleTime,r))&&this.prefetchQuery(t),Promise.resolve(n))}getQueriesData(e){return Re(this,be).findAll(e).map(({queryKey:e,state:t})=>[e,t.data])}setQueryData(e,t,r){const n=this.defaultQueryOptions({queryKey:e}),i=Re(this,be).get(n.queryHash),s=i?.state.data,a=((e,t)=>"function"==typeof e?e(t):e)(t,s)
if(void 0!==a)return Re(this,be).build(this,n).setData(a,{...r,manual:!0})}setQueriesData(e,t,r){return xt.batch(()=>Re(this,be).findAll(e).map(({queryKey:e})=>[e,this.setQueryData(e,t,r)]))}getQueryState(e){const t=this.defaultQueryOptions({queryKey:e})
return Re(this,be).get(t.queryHash)?.state}removeQueries(e){const t=Re(this,be)
xt.batch(()=>{t.findAll(e).forEach(e=>{t.remove(e)})})}resetQueries(e,t){const r=Re(this,be)
return xt.batch(()=>(r.findAll(e).forEach(e=>{e.reset()}),this.refetchQueries({type:"active",...e},t)))}cancelQueries(e,t={}){const r={revert:!0,...t},n=xt.batch(()=>Re(this,be).findAll(e).map(e=>e.cancel(r)))
return Promise.all(n).then(Ze).catch(Ze)}invalidateQueries(e,t={}){return xt.batch(()=>(Re(this,be).findAll(e).forEach(e=>{e.invalidate()}),"none"===e?.refetchType?Promise.resolve():this.refetchQueries({...e,type:e?.refetchType??e?.type??"active"},t)))}refetchQueries(e,t={}){const r={...t,cancelRefetch:t.cancelRefetch??!0},n=xt.batch(()=>Re(this,be).findAll(e).filter(e=>!e.isDisabled()&&!e.isStatic()).map(e=>{let t=e.fetch(void 0,r)
return r.throwOnError||(t=t.catch(Ze)),"paused"===e.state.fetchStatus?Promise.resolve():t}))
return Promise.all(n).then(Ze)}fetchQuery(e){const t=this.defaultQueryOptions(e)
void 0===t.retry&&(t.retry=!1)
const r=Re(this,be).build(this,t)
return r.isStaleByTime(rt(t.staleTime,r))?r.fetch(t):Promise.resolve(r.state.data)}prefetchQuery(e){return this.fetchQuery(e).then(Ze).catch(Ze)}fetchInfiniteQuery(e){return e._type="infinite",this.fetchQuery(e)}prefetchInfiniteQuery(e){return this.fetchInfiniteQuery(e).then(Ze).catch(Ze)}ensureInfiniteQueryData(e){return e._type="infinite",this.ensureQueryData(e)}resumePausedMutations(){return Pt.isOnline()?Re(this,ge).resumePausedMutations():Promise.resolve()}getQueryCache(){return Re(this,be)}getMutationCache(){return Re(this,ge)}getDefaultOptions(){return Re(this,we)}setDefaultOptions(e){Ae(this,we,e)}setQueryDefaults(e,t){Re(this,_e).set(ot(e),{queryKey:e,defaultOptions:t})}getQueryDefaults(e){const t=[...Re(this,_e).values()],r={}
return t.forEach(t=>{ut(e,t.queryKey)&&Object.assign(r,t.defaultOptions)}),r}setMutationDefaults(e,t){Re(this,ke).set(ot(e),{mutationKey:e,defaultOptions:t})}getMutationDefaults(e){const t=[...Re(this,ke).values()],r={}
return t.forEach(t=>{ut(e,t.mutationKey)&&Object.assign(r,t.defaultOptions)}),r}defaultQueryOptions(e){if(e._defaulted)return e
const t={...Re(this,we).queries,...this.getQueryDefaults(e.queryKey),...e,_defaulted:!0}
return t.queryHash||(t.queryHash=at(t.queryKey,t)),void 0===t.refetchOnReconnect&&(t.refetchOnReconnect="always"!==t.networkMode),void 0===t.throwOnError&&(t.throwOnError=!!t.suspense),!t.networkMode&&t.persister&&(t.networkMode="offlineFirst"),t.queryFn===bt&&(t.enabled=!1),t}defaultMutationOptions(e){return e?._defaulted?e:{...Re(this,we).mutations,...e?.mutationKey&&this.getMutationDefaults(e.mutationKey),...e,_defaulted:!0}}clear(){Re(this,be).clear(),Re(this,ge).clear()}},be=new WeakMap,ge=new WeakMap,we=new WeakMap,_e=new WeakMap,ke=new WeakMap,Oe=new WeakMap,xe=new WeakMap,Pe=new WeakMap,Se),Xt=Ve()
const Jt=Ie(Xt),Zt=qe({__proto__:null,default:Jt},[Xt])
var er=Xt.createContext(void 0),tr=()=>{const e=Xt.useContext(er)
if(!e)throw new Error("No QueryClient set, use QueryClientProvider to set one")
return e},rr=({client:e,children:t})=>(Xt.useEffect(()=>(e.mount(),()=>{e.unmount()}),[e]),ze.jsx(er.Provider,{value:e,children:t})),nr=Xt.createContext(!1)
nr.Provider
var ir=Xt.createContext((()=>{let e=!1
return{clearReset:()=>{e=!1},reset:()=>{e=!0},isReset:()=>e}})()),sr=(e,t,r)=>t.fetchOptimistic(e).catch(()=>{r.clearReset()})
function ar(e,t){const r=Xt.useContext(nr),n=Xt.useContext(ir),i=tr(),s=i.defaultQueryOptions(e)
i.getDefaultOptions().queries?._experimental_beforeQuery?.(s)
const a=i.getQueryCache().get(s.queryHash),o=!1!==e.subscribed
s._optimisticResults=r?"isRestoring":o?"optimistic":void 0,(e=>{if(e.suspense){const t=1e3,r=e=>"static"===e?e:Math.max(e??t,t),n=e.staleTime
e.staleTime="function"==typeof n?(...e)=>r(n(...e)):r(n),"number"==typeof e.gcTime&&(e.gcTime=Math.max(e.gcTime,t))}})(s),((e,t,r)=>{const n=r?.state.error&&"function"==typeof e.throwOnError?wt(e.throwOnError,[r.state.error,r]):e.throwOnError;(e.suspense||e.experimental_prefetchInRender||n)&&(t.isReset()||(e.retryOnMount=!1))})(s,n,a),(e=>{Xt.useEffect(()=>{e.clearReset()},[e])})(n)
const u=!i.getQueryCache().get(s.queryHash),[l]=Xt.useState(()=>new t(i,s)),c=l.getOptimisticResult(s),h=!r&&o
if(Xt.useSyncExternalStore(Xt.useCallback(e=>{const t=h?l.subscribe(xt.batchCalls(e)):Ze
return l.updateResult(),t},[l,h]),()=>l.getCurrentResult(),()=>l.getCurrentResult()),Xt.useEffect(()=>{l.setOptions(s)},[s,l]),((e,t)=>e?.suspense&&t.isPending)(s,c))throw sr(s,l,n)
if((({result:e,errorResetBoundary:t,throwOnError:r,query:n,suspense:i})=>e.isError&&!t.isReset()&&!e.isFetching&&n&&(i&&void 0===e.data||wt(r,[e.error,n])))({result:c,errorResetBoundary:n,throwOnError:s.throwOnError,query:a,suspense:s.suspense}))throw c.error
if(i.getDefaultOptions().queries?._experimental_afterQuery?.(s,c),s.experimental_prefetchInRender&&!_t.isServer()&&((e,t)=>e.isLoading&&e.isFetching&&!t)(c,r)){const e=u?sr(s,l,n):a?.promise
e?.catch(Ze).finally(()=>{l.updateResult()})}return s.notifyOnChangeProps?c:l.trackResult(c)}function or(e){return ar(e,Bt)}function ur(e){const t=tr(),[r]=Xt.useState(()=>new Ht(t,e))
Xt.useEffect(()=>{r.setOptions(e)},[r,e])
const n=Xt.useSyncExternalStore(Xt.useCallback(e=>r.subscribe(xt.batchCalls(e)),[r]),()=>r.getCurrentResult(),()=>r.getCurrentResult()),i=Xt.useCallback((e,t)=>{r.mutate(e,t).catch(Ze)},[r])
if(n.error&&wt(r.options.throwOnError,[n.error]))throw n.error
return{...n,mutate:i,mutateAsync:n.mutate}}function lr(e){return ar(e,Qt)}var cr,hr={exports:{}}
const dr=Ie((cr||(cr=1,hr.exports=function(){var e=(t,r)=>(e=Object.setPrototypeOf||({__proto__:[]}instanceof Array?(e,t)=>{e.__proto__=t}:(e,t)=>{for(var r in t)Object.prototype.hasOwnProperty.call(t,r)&&(e[r]=t[r])}))(t,r),t=function(){return(t=Object.assign||function(e){for(var t,r=1,n=arguments.length;r<n;r++)for(var i in t=arguments[r])Object.prototype.hasOwnProperty.call(t,i)&&(e[i]=t[i])
return e}).apply(this,arguments)}
function r(e,t){for(var r,n=0,i=t.length;n<i;n++)!r&&n in t||((r=r||Array.prototype.slice.call(t,0,n))[n]=t[n])
return e.concat(r||Array.prototype.slice.call(t))}var n="undefined"!=typeof globalThis?globalThis:"undefined"!=typeof self?self:"undefined"!=typeof window?window:Te,i=Object.keys,s=Array.isArray
function a(e,t){return"object"==typeof t&&i(t).forEach(r=>{e[r]=t[r]}),e}"undefined"==typeof Promise||n.Promise||(n.Promise=Promise)
var o=Object.getPrototypeOf,u={}.hasOwnProperty
function l(e,t){return u.call(e,t)}function c(e,t){"function"==typeof t&&(t=t(o(e))),("undefined"==typeof Reflect?i:Reflect.ownKeys)(t).forEach(r=>{d(e,r,t[r])})}var h=Object.defineProperty
function d(e,t,r,n){h(e,t,a(r&&l(r,"get")&&"function"==typeof r.get?{get:r.get,set:r.set,configurable:!0}:{value:r,configurable:!0,writable:!0},n))}function f(e){return{from:t=>(e.prototype=Object.create(t.prototype),d(e.prototype,"constructor",e),{extend:c.bind(null,e.prototype)})}}var p=Object.getOwnPropertyDescriptor,y=[].slice
function v(e,t,r){return y.call(e,t,r)}function m(e,t){return t(e)}function b(e){if(!e)throw new Error("Assertion Failed")}function g(e){n.setImmediate?setImmediate(e):setTimeout(e,0)}function w(e,t){if("string"==typeof t&&l(e,t))return e[t]
if(!t)return e
if("string"!=typeof t){for(var r=[],n=0,i=t.length;n<i;++n){var s=w(e,t[n])
r.push(s)}return r}var a,o=t.indexOf(".")
return-1===o||null==(a=e[t.substr(0,o)])?void 0:w(a,t.substr(o+1))}function _(e,t,r){if(e&&void 0!==t&&(!("isFrozen"in Object)||!Object.isFrozen(e)))if("string"!=typeof t&&"length"in t){b("string"!=typeof r&&"length"in r)
for(var n=0,i=t.length;n<i;++n)_(e,t[n],r[n])}else if(-1!==(a=t.indexOf("."))){var a,o=t.substr(0,a)
if(""===(a=t.substr(a+1)))void 0===r?s(e)&&!isNaN(parseInt(o))?e.splice(o,1):delete e[o]:e[o]=r
else{var u=e[o]
if(!u||!l(e,o)){if(void 0===r)return
u=e[o]={}}_(u,a,r)}}else void 0===r?s(e)&&!isNaN(parseInt(t))?e.splice(t,1):delete e[t]:e[t]=r}function k(e){var t,r={}
for(t in e)l(e,t)&&(r[t]=e[t])
return r}var O=[].concat
function x(e){return O.apply([],e)}var P="BigUint64Array,BigInt64Array,Array,Boolean,String,Date,RegExp,Blob,File,FileList,FileSystemFileHandle,FileSystemDirectoryHandle,ArrayBuffer,DataView,Uint8ClampedArray,ImageBitmap,ImageData,Map,Set,CryptoKey".split(",").concat(x([8,16,32,64].map(e=>["Int","Uint","Float"].map(t=>t+e+"Array")))).filter(e=>n[e]),S=new Set(P.map(e=>n[e])),E=null
function C(e){return E=new WeakMap,e=function e(t){if(!t||"object"!=typeof t)return t
var r=E.get(t)
if(r)return r
if(s(t)){r=[],E.set(t,r)
for(var n=0,i=t.length;n<i;++n)r.push(e(t[n]))}else if(S.has(t.constructor))r=t
else{var a,u=o(t)
for(a in r=u===Object.prototype?{}:Object.create(u),E.set(t,r),t)l(t,a)&&(r[a]=e(t[a]))}return r}(e),E=null,e}var R={}.toString
function K(e){return R.call(e).slice(8,-1)}var A="undefined"!=typeof Symbol?Symbol.iterator:"@@iterator",j="symbol"==typeof A?e=>{var t
return null!=e&&(t=e[A])&&t.apply(e)}:()=>null
function M(e,t){0<=(t=e.indexOf(t))&&e.splice(t,1)}var q={}
function T(e){var t,r,n,i
if(1===arguments.length){if(s(e))return e.slice()
if(this===q&&"string"==typeof e)return[e]
if(i=j(e))for(r=[];!(n=i.next()).done;)r.push(n.value)
else{if(null==e)return[e]
if("number"!=typeof(t=e.length))return[e]
for(r=new Array(t);t--;)r[t]=e[t]}}else for(t=arguments.length,r=new Array(t);t--;)r[t]=arguments[t]
return r}var I="undefined"!=typeof Symbol?e=>"AsyncFunction"===e[Symbol.toStringTag]:()=>!1,D=["Modify","Bulk","OpenFailed","VersionChange","Schema","Upgrade","InvalidTable","MissingAPI","NoSuchDatabase","InvalidArgument","SubTransaction","Unsupported","Internal","DatabaseClosed","PrematureCommit","ForeignAwait"].concat(P=["Unknown","Constraint","Data","TransactionInactive","ReadOnly","Version","NotFound","InvalidState","InvalidAccess","Abort","Timeout","QuotaExceeded","Syntax","DataClone"]),F={VersionChanged:"Database version changed by other database connection",DatabaseClosed:"Database has been closed",Abort:"Transaction aborted",TransactionInactive:"Transaction has already completed or failed",MissingAPI:"IndexedDB API missing. Please visit https://tinyurl.com/y2uuvskb"}
function B(e,t){this.name=e,this.message=t}function N(e,t){return e+". Errors: "+Object.keys(t).map(e=>t[e].toString()).filter((e,t,r)=>r.indexOf(e)===t).join("\n")}function W(e,t,r,n){this.failures=t,this.failedKeys=n,this.successCount=r,this.message=N(e,t)}function U(e,t){this.name="BulkError",this.failures=Object.keys(t).map(e=>t[e]),this.failuresByPos=t,this.message=N(e,this.failures)}f(B).from(Error).extend({toString:function(){return this.name+": "+this.message}}),f(W).from(B),f(U).from(B)
var L=D.reduce((e,t)=>(e[t]=t+"Error",e),{}),Q=B,$=D.reduce(function(e,t){var r=t+"Error"
function n(e,n){this.name=r,e?"string"==typeof e?(this.message="".concat(e).concat(n?"\n "+n:""),this.inner=n||null):"object"==typeof e&&(this.message="".concat(e.name," ").concat(e.message),this.inner=e):(this.message=F[t]||r,this.inner=null)}return f(n).from(Q),e[t]=n,e},{}),V=($.Syntax=SyntaxError,$.Type=TypeError,$.Range=RangeError,P.reduce((e,t)=>(e[t+"Error"]=$[t],e),{}))
function z(){}function H(e){return e}function G(e,t){return null==e||e===H?t:r=>t(e(r))}function Y(e,t){return function(){e.apply(this,arguments),t.apply(this,arguments)}}function X(e,t){return e===z?t:function(){var r=e.apply(this,arguments),n=(void 0!==r&&(arguments[0]=r),this.onsuccess),i=this.onerror,s=(this.onsuccess=null,this.onerror=null,t.apply(this,arguments))
return n&&(this.onsuccess=this.onsuccess?Y(n,this.onsuccess):n),i&&(this.onerror=this.onerror?Y(i,this.onerror):i),void 0!==s?s:r}}function J(e,t){return e===z?t:function(){e.apply(this,arguments)
var r=this.onsuccess,n=this.onerror
this.onsuccess=this.onerror=null,t.apply(this,arguments),r&&(this.onsuccess=this.onsuccess?Y(r,this.onsuccess):r),n&&(this.onerror=this.onerror?Y(n,this.onerror):n)}}function Z(e,t){return e===z?t:function(r){var n=e.apply(this,arguments),i=(a(r,n),r=this.onsuccess,this.onerror),s=(this.onsuccess=null,this.onerror=null,t.apply(this,arguments))
return r&&(this.onsuccess=this.onsuccess?Y(r,this.onsuccess):r),i&&(this.onerror=this.onerror?Y(i,this.onerror):i),void 0===n?void 0===s?void 0:s:a(n,s)}}function ee(e,t){return e===z?t:function(){return!1!==t.apply(this,arguments)&&e.apply(this,arguments)}}function te(e,t){return e===z?t:function(){var r=e.apply(this,arguments)
if(r&&"function"==typeof r.then){for(var n=this,i=arguments.length,s=new Array(i);i--;)s[i]=arguments[i]
return r.then(()=>t.apply(n,s))}return t.apply(this,arguments)}}P=D.reduce((e,t)=>(-1===["Syntax","Type","Range"].indexOf(t)&&(e[t+"Error"]=$[t]),e),{}),P.ModifyError=W,P.DexieError=B,P.BulkError=U
var re="undefined"!=typeof location&&/^(http|https):\/\/(localhost|127\.0\.0\.1)/.test(location.href)
function ne(e){re=e}var ie={},se="undefined"==typeof Promise?[]:(D=Promise.resolve(),"undefined"!=typeof crypto&&crypto.subtle?[se=crypto.subtle.digest("SHA-512",new Uint8Array([0])),o(se),D]:[D,o(D),D]),ae=(D=se[0],(ae=se[1])&&ae.then),oe=D&&D.constructor,ue=!!se[2],le=(e,t)=>{me.push([e,t]),he&&(queueMicrotask(Ee),he=!1)},ce=!0,he=!0,de=[],fe=[],pe=H,ye={id:"global",global:!0,ref:0,unhandleds:[],onunhandled:z,pgp:!1,env:{},finalize:z},ve=ye,me=[],be=0,ge=[]
function we(e){if("object"!=typeof this)throw new TypeError("Promises must be constructed via new")
this._listeners=[],this._lib=!1
var t=this._PSD=ve
if("function"!=typeof e){if(e!==ie)throw new TypeError("Not a function")
this._state=arguments[1],this._value=arguments[2],!1===this._state&&Oe(this,this._value)}else this._state=null,this._value=null,++t.ref,function e(t,r){try{r(r=>{if(null===t._state){if(r===t)throw new TypeError("A promise cannot be resolved with itself.")
var n=t._lib&&Ce()
r&&"function"==typeof r.then?e(t,(e,t)=>{r instanceof we?r._then(e,t):r.then(e,t)}):(t._state=!0,t._value=r,xe(t)),n&&Re()}},Oe.bind(null,t))}catch(n){Oe(t,n)}}(this,e)}var _e={get:function(){var e=ve,t=Fe
function r(r,n){var i=this,s=!e.global&&(e!==ve||t!==Fe),a=s&&!Ue(),o=new we((t,o)=>{Pe(i,new ke(He(r,e,s,a),He(n,e,s,a),t,o,e))})
return this._consoleTask&&(o._consoleTask=this._consoleTask),o}return r.prototype=ie,r},set:function(e){d(this,"then",e&&e.prototype===ie?_e:{get:()=>e,set:_e.set})}}
function ke(e,t,r,n,i){this.onFulfilled="function"==typeof e?e:null,this.onRejected="function"==typeof t?t:null,this.resolve=r,this.reject=n,this.psd=i}function Oe(e,t){var r,n
fe.push(t),null===e._state&&(r=e._lib&&Ce(),t=pe(t),e._state=!1,e._value=t,n=e,de.some(e=>e._value===n._value)||de.push(n),xe(e),r)&&Re()}function xe(e){var t=e._listeners
e._listeners=[]
for(var r=0,n=t.length;r<n;++r)Pe(e,t[r])
var i=e._PSD;--i.ref||i.finalize(),0===be&&(++be,le(()=>{0==--be&&Ke()},[]))}function Pe(e,t){if(null===e._state)e._listeners.push(t)
else{var r=e._state?t.onFulfilled:t.onRejected
if(null===r)return(e._state?t.resolve:t.reject)(e._value);++t.psd.ref,++be,le(Se,[r,e,t])}}function Se(e,t,r){try{var n,i=t._value
!t._state&&fe.length&&(fe=[]),n=re&&t._consoleTask?t._consoleTask.run(()=>e(i)):e(i),t._state||-1!==fe.indexOf(i)||(e=>{for(var t=de.length;t;)if(de[--t]._value===e._value)return de.splice(t,1)})(t),r.resolve(n)}catch(s){r.reject(s)}finally{0==--be&&Ke(),--r.psd.ref||r.psd.finalize()}}function Ee(){ze(ye,()=>{Ce()&&Re()})}function Ce(){var e=ce
return he=ce=!1,e}function Re(){var e,t,r
do{for(;0<me.length;)for(e=me,me=[],r=e.length,t=0;t<r;++t){var n=e[t]
n[0].apply(null,n[1])}}while(0<me.length)
he=ce=!0}function Ke(){for(var e=de,t=(de=[],e.forEach(e=>{e._PSD.onunhandled.call(null,e._value,e)}),ge.slice(0)),r=t.length;r;)t[--r]()}function Ae(e){return new we(ie,!1,e)}function je(e,t){var r=ve
return function(){var n=Ce(),i=ve
try{return $e(r,!0),e.apply(this,arguments)}catch(s){t&&t(s)}finally{$e(i,!1),n&&Re()}}}c(we.prototype,{then:_e,_then:function(e,t){Pe(this,new ke(null,null,e,t,ve))},catch:function(e){var t,r
return 1===arguments.length?this.then(null,e):(r=arguments[1],"function"==typeof(t=e)?this.then(null,e=>(e instanceof t?r:Ae)(e)):this.then(null,e=>(e&&e.name===t?r:Ae)(e)))},finally:function(e){return this.then(t=>we.resolve(e()).then(()=>t),t=>we.resolve(e()).then(()=>Ae(t)))},timeout:function(e,t){var r=this
return e<1/0?new we((n,i)=>{var s=setTimeout(()=>i(new $.Timeout(t)),e)
r.then(n,i).finally(clearTimeout.bind(null,s))}):this}}),"undefined"!=typeof Symbol&&Symbol.toStringTag&&d(we.prototype,Symbol.toStringTag,"Dexie.Promise"),ye.env=Ve(),c(we,{all:function(){var e=T.apply(null,arguments).map(Le)
return new we((t,r)=>{0===e.length&&t([])
var n=e.length
e.forEach((i,s)=>we.resolve(i).then(r=>{e[s]=r,--n||t(e)},r))})},resolve:e=>e instanceof we?e:e&&"function"==typeof e.then?new we((t,r)=>{e.then(t,r)}):new we(ie,!0,e),reject:Ae,race:function(){var e=T.apply(null,arguments).map(Le)
return new we((t,r)=>{e.map(e=>we.resolve(e).then(t,r))})},PSD:{get:()=>ve,set:e=>ve=e},totalEchoes:{get:()=>Fe},newPSD:Ne,usePSD:ze,scheduler:{get:()=>le,set:e=>{le=e}},rejectionMapper:{get:()=>pe,set:e=>{pe=e}},follow:function(e,t){return new we(function(r,n){return Ne(function(t,r){var n=ve
n.unhandleds=[],n.onunhandled=r,n.finalize=Y(function(){var e,n=this
e=()=>{0===n.unhandleds.length?t():r(n.unhandleds[0])},ge.push(function t(){e(),ge.splice(ge.indexOf(t),1)}),++be,le(()=>{0==--be&&Ke()},[])},n.finalize),e()},t,r,n)})}}),oe&&(oe.allSettled&&d(we,"allSettled",function(){var e=T.apply(null,arguments).map(Le)
return new we(t=>{0===e.length&&t([])
var r=e.length,n=new Array(r)
e.forEach((e,i)=>we.resolve(e).then(e=>n[i]={status:"fulfilled",value:e},e=>n[i]={status:"rejected",reason:e}).then(()=>--r||t(n)))})}),oe.any&&"undefined"!=typeof AggregateError&&d(we,"any",function(){var e=T.apply(null,arguments).map(Le)
return new we((t,r)=>{0===e.length&&r(new AggregateError([]))
var n=e.length,i=new Array(n)
e.forEach((e,s)=>we.resolve(e).then(e=>t(e),e=>{i[s]=e,--n||r(new AggregateError(i))}))})}),oe.withResolvers)&&(we.withResolvers=oe.withResolvers)
var Me={awaits:0,echoes:0,id:0},qe=0,Ie=[],De=0,Fe=0,Be=0
function Ne(e,t,r,n){var i=ve,s=Object.create(i)
return s.parent=i,s.ref=0,s.global=!1,s.id=++Be,ye.env,s.env=ue?{Promise:we,PromiseProp:{value:we,configurable:!0,writable:!0},all:we.all,race:we.race,allSettled:we.allSettled,any:we.any,resolve:we.resolve,reject:we.reject}:{},t&&a(s,t),++i.ref,s.finalize=function(){--this.parent.ref||this.parent.finalize()},t=ze(s,e,r,n),0===s.ref&&s.finalize(),t}function We(){return Me.id||(Me.id=++qe),++Me.awaits,Me.echoes+=100,Me.id}function Ue(){return!!Me.awaits&&(0==--Me.awaits&&(Me.id=0),Me.echoes=100*Me.awaits,!0)}function Le(e){return Me.echoes&&e&&e.constructor===oe?(We(),e.then(e=>(Ue(),e),e=>(Ue(),Ye(e)))):e}function Qe(){var e=Ie[Ie.length-1]
Ie.pop(),$e(e,!1)}function $e(e,t){var r,i,s=ve;(t?!Me.echoes||De++&&e===ve:!De||--De&&e===ve)||queueMicrotask(t?(e=>{++Fe,Me.echoes&&0!=--Me.echoes||(Me.echoes=Me.awaits=Me.id=0),Ie.push(ve),$e(e,!0)}).bind(null,e):Qe),e!==ve&&(ve=e,s===ye&&(ye.env=Ve()),ue)&&(r=ye.env.Promise,i=e.env,s.global||e.global)&&(Object.defineProperty(n,"Promise",i.PromiseProp),r.all=i.all,r.race=i.race,r.resolve=i.resolve,r.reject=i.reject,i.allSettled&&(r.allSettled=i.allSettled),i.any)&&(r.any=i.any)}function Ve(){var e=n.Promise
return ue?{Promise:e,PromiseProp:Object.getOwnPropertyDescriptor(n,"Promise"),all:e.all,race:e.race,allSettled:e.allSettled,any:e.any,resolve:e.resolve,reject:e.reject}:{}}function ze(e,t,r,n,i){var s=ve
try{return $e(e,!0),t(r,n,i)}finally{$e(s,!1)}}function He(e,t,r,n){return"function"!=typeof e?e:function(){var i=ve
r&&We(),$e(t,!0)
try{return e.apply(this,arguments)}finally{$e(i,!1),n&&queueMicrotask(Ue)}}}function Ge(e){Promise===oe&&0===Me.echoes?0===De?e():enqueueNativeMicroTask(e):setTimeout(e,0)}-1===(""+ae).indexOf("[native code]")&&(We=Ue=z)
var Ye=we.reject,Xe=String.fromCharCode(65535),Je="Invalid key provided. Keys must be of type string, number, Date or Array<string | number | Date>.",Ze="String expected.",et="__dbnames",tt="readonly",rt="readwrite"
function nt(e,t){return e?t?function(){return e.apply(this,arguments)&&t.apply(this,arguments)}:e:t}var it={type:3,lower:-1/0,lowerOpen:!1,upper:[[]],upperOpen:!1}
function st(e){return"string"!=typeof e||/\./.test(e)?e=>e:t=>(void 0===t[e]&&e in t&&delete(t=C(t))[e],t)}function at(){throw $.Type("Entity instances must never be new:ed. Instances are generated by the framework bypassing the constructor.")}function ot(e,t){try{var r=ut(e),n=ut(t)
if(r!==n)return"Array"===r?1:"Array"===n?-1:"binary"===r?1:"binary"===n?-1:"string"===r?1:"string"===n?-1:"Date"===r?1:"Date"!==n?NaN:-1
switch(r){case"number":case"Date":case"string":return t<e?1:e<t?-1:0
case"binary":for(var i=lt(e),s=lt(t),a=i.length,o=s.length,u=a<o?a:o,l=0;l<u;++l)if(i[l]!==s[l])return i[l]<s[l]?-1:1
return a===o?0:a<o?-1:1
case"Array":for(var c=e,h=t,d=c.length,f=h.length,p=d<f?d:f,y=0;y<p;++y){var v=ot(c[y],h[y])
if(0!==v)return v}return d===f?0:d<f?-1:1}}catch(m){}return NaN}function ut(e){var t=typeof e
return"object"!=t||!ArrayBuffer.isView(e)&&"ArrayBuffer"!==(t=K(e))?t:"binary"}function lt(e){return e instanceof Uint8Array?e:ArrayBuffer.isView(e)?new Uint8Array(e.buffer,e.byteOffset,e.byteLength):new Uint8Array(e)}function ct(e,t,r){var n=e.schema.yProps
return n?(t&&0<r.numFailures&&(t=t.filter((e,t)=>!r.failures[t])),Promise.all(n.map(r=>(r=r.updatesTable,t?e.db.table(r).where("k").anyOf(t).delete():e.db.table(r).clear()))).then(()=>r)):r}dt.prototype.execute=function(e){var t=this["@@propmod"]
if(void 0!==t.add){var n=t.add
if(s(n))return r(r([],s(e)?e:[]),n).sort()
if("number"==typeof n)return(Number(e)||0)+n
if("bigint"==typeof n)try{return BigInt(e)+n}catch(a){return BigInt(0)+n}throw new TypeError("Invalid term ".concat(n))}if(void 0!==t.remove){var i=t.remove
if(s(i))return s(e)?e.filter(e=>!i.includes(e)).sort():[]
if("number"==typeof i)return Number(e)-i
if("bigint"==typeof i)try{return BigInt(e)-i}catch(a){return BigInt(0)-i}throw new TypeError("Invalid subtrahend ".concat(i))}return(n=null==(n=t.replacePrefix)?void 0:n[0])&&"string"==typeof e&&e.startsWith(n)?t.replacePrefix[1]+e.substring(n.length):e}
var ht=dt
function dt(e){this["@@propmod"]=e}function ft(e,t){for(var r=i(t),n=r.length,s=!1,a=0;a<n;++a){var o=r[a],u=t[o],l=w(e,o)
u instanceof ht?(_(e,o,u.execute(l)),s=!0):l!==u&&(_(e,o,u),s=!0)}return s}yt.prototype._trans=function(e,t,r){var n=this._tx||ve.trans,i=this.name,s=re&&"undefined"!=typeof console&&console.createTask&&void 0
function a(e,r,n){if(n.schema[i])return t(n.idbtrans,n)
throw new $.NotFound("Table "+i+" not part of transaction")}var o=Ce()
try{var u=n&&n.db._novip===this.db._novip?n===ve.trans?n._promise(e,a,r):Ne(()=>n._promise(e,a,r),{trans:n,transless:ve.transless||ve}):function e(t,r,n,i){if(t.idbdb&&(t._state.openComplete||ve.letThrough||t._vip)){var s=t._createTransaction(r,n,t._dbSchema)
try{s.create(),t._state.PR1398_maxLoop=3}catch(a){return a.name===L.InvalidState&&t.isOpen()&&0<--t._state.PR1398_maxLoop?(t.close({disableAutoOpen:!1}),t.open().then(()=>e(t,r,n,i))):Ye(a)}return s._promise(r,(e,t)=>Ne(()=>(ve.trans=s,i(e,t,s)))).then(e=>{if("readwrite"===r)try{s.idbtrans.commit()}catch(t){}return"readonly"===r?e:s._completion.then(()=>e)})}if(t._state.openComplete)return Ye(new $.DatabaseClosed(t._state.dbOpenError))
if(!t._state.isBeingOpened){if(!t._state.autoOpen)return Ye(new $.DatabaseClosed)
t.open().catch(z)}return t._state.dbReadyPromise.then(()=>e(t,r,n,i))}(this.db,e,[this.name],a)
return s&&(u._consoleTask=s,u=u.catch(e=>Ye(e))),u}finally{o&&Re()}},yt.prototype.get=function(e,t){var r=this
return e&&e.constructor===Object?this.where(e).first(t):null==e?Ye(new $.Type("Invalid argument to Table.get()")):this._trans("readonly",t=>r.core.get({trans:t,key:e}).then(e=>r.hook.reading.fire(e))).then(t)},yt.prototype.where=function(e){if("string"==typeof e)return new this.db.WhereClause(this,e)
if(s(e))return new this.db.WhereClause(this,"[".concat(e.join("+"),"]"))
var t=i(e)
if(1===t.length)return this.where(t[0]).equals(e[t[0]])
var r=this.schema.indexes.concat(this.schema.primKey).filter(e=>{if(e.compound&&t.every(t=>0<=e.keyPath.indexOf(t))){for(var r=0;r<t.length;++r)if(-1===t.indexOf(e.keyPath[r]))return!1
return!0}return!1}).sort((e,t)=>e.keyPath.length-t.keyPath.length)[0]
if(r&&this.db._maxKey!==Xe)return u=r.keyPath.slice(0,t.length),this.where(u).equals(u.map(t=>e[t]))
var n=this.schema.idxByName
function a(e,t){return 0===ot(e,t)}var o=(u=t.reduce((t,r)=>{var i=t[0],o=(t=t[1],n[r]),u=e[r]
return[i||o,i||!o?nt(t,o&&o.multi?e=>(e=w(e,r),s(e)&&e.some(e=>a(u,e))):e=>a(u,w(e,r))):t]},[null,null]))[0],u=u[1]
return o?this.where(o.name).equals(e[o.keyPath]).filter(u):r?this.filter(u):this.where(t).equals("")},yt.prototype.filter=function(e){return this.toCollection().and(e)},yt.prototype.count=function(e){return this.toCollection().count(e)},yt.prototype.offset=function(e){return this.toCollection().offset(e)},yt.prototype.limit=function(e){return this.toCollection().limit(e)},yt.prototype.each=function(e){return this.toCollection().each(e)},yt.prototype.toArray=function(e){return this.toCollection().toArray(e)},yt.prototype.toCollection=function(){return new this.db.Collection(new this.db.WhereClause(this))},yt.prototype.orderBy=function(e){return new this.db.Collection(new this.db.WhereClause(this,s(e)?"[".concat(e.join("+"),"]"):e))},yt.prototype.reverse=function(){return this.toCollection().reverse()},yt.prototype.mapToClass=function(t){for(var r=this.db,n=this.name,i=((this.schema.mappedClass=t).prototype instanceof at&&(t=(t=>{var i=o,s=t
if("function"!=typeof s&&null!==s)throw new TypeError("Class extends value "+String(s)+" is not a constructor or null")
function a(){this.constructor=i}function o(){return null!==t&&t.apply(this,arguments)||this}return e(i,s),i.prototype=null===s?Object.create(s):(a.prototype=s.prototype,new a),Object.defineProperty(o.prototype,"db",{get:()=>r,enumerable:!1,configurable:!0}),o.prototype.table=()=>n,o})(t)),new Set),s=t.prototype;s;s=o(s))Object.getOwnPropertyNames(s).forEach(e=>i.add(e))
function a(e){if(!e)return e
var r,n=Object.create(t.prototype)
for(r in e)if(!i.has(r))try{n[r]=e[r]}catch(s){}return n}return this.schema.readHook&&this.hook.reading.unsubscribe(this.schema.readHook),this.schema.readHook=a,this.hook("reading",a),t},yt.prototype.defineClass=function(){return this.mapToClass(function(e){a(this,e)})},yt.prototype.add=function(e,t){var r=this,n=this.schema.primKey,i=n.auto,s=n.keyPath,a=e
return s&&i&&(a=st(s)(e)),this._trans("readwrite",e=>r.core.mutate({trans:e,type:"add",keys:null!=t?[t]:null,values:[a]})).then(e=>e.numFailures?we.reject(e.failures[0]):e.lastResult).then(t=>{if(s)try{_(e,s,t)}catch(r){}return t})},yt.prototype.upsert=function(e,t){var r=this,n=this.schema.primKey.keyPath
return this._trans("readwrite",i=>r.core.get({trans:i,key:e}).then(s=>{var a=null!=s?s:{}
return ft(a,t),n&&_(a,n,e),r.core.mutate({trans:i,type:"put",values:[a],keys:[e],upsert:!0,updates:{keys:[e],changeSpecs:[t]}}).then(e=>e.numFailures?we.reject(e.failures[0]):!!s)}))},yt.prototype.update=function(e,t){return"object"!=typeof e||s(e)?this.where(":id").equals(e).modify(t):void 0===(e=w(e,this.schema.primKey.keyPath))?Ye(new $.InvalidArgument("Given object does not contain its primary key")):this.where(":id").equals(e).modify(t)},yt.prototype.put=function(e,t){var r=this,n=this.schema.primKey,i=n.auto,s=n.keyPath,a=e
return s&&i&&(a=st(s)(e)),this._trans("readwrite",e=>r.core.mutate({trans:e,type:"put",values:[a],keys:null!=t?[t]:null})).then(e=>e.numFailures?we.reject(e.failures[0]):e.lastResult).then(t=>{if(s)try{_(e,s,t)}catch(r){}return t})},yt.prototype.delete=function(e){var t=this
return this._trans("readwrite",r=>t.core.mutate({trans:r,type:"delete",keys:[e]}).then(r=>ct(t,[e],r)).then(e=>e.numFailures?we.reject(e.failures[0]):void 0))},yt.prototype.clear=function(){var e=this
return this._trans("readwrite",t=>e.core.mutate({trans:t,type:"deleteRange",range:it}).then(t=>ct(e,null,t))).then(e=>e.numFailures?we.reject(e.failures[0]):void 0)},yt.prototype.bulkGet=function(e){var t=this
return this._trans("readonly",r=>t.core.getMany({keys:e,trans:r}).then(e=>e.map(e=>t.hook.reading.fire(e))))},yt.prototype.bulkAdd=function(e,t,r){var n=this,i=Array.isArray(t)?t:void 0,s=(r=r||(i?void 0:t))?r.allKeys:void 0
return this._trans("readwrite",t=>{var r,a=(r=n.schema.primKey).auto
if((r=r.keyPath)&&i)throw new $.InvalidArgument("bulkAdd(): keys argument invalid on tables with inbound keys")
if(i&&i.length!==e.length)throw new $.InvalidArgument("Arguments objects and keys must have the same length")
var o=e.length
return a=r&&a?e.map(st(r)):e,n.core.mutate({trans:t,type:"add",keys:i,values:a,wantResults:s}).then(e=>{var t=e.numFailures,r=e.failures
if(0===t)return s?e.results:e.lastResult
throw new U("".concat(n.name,".bulkAdd(): ").concat(t," of ").concat(o," operations failed"),r)})})},yt.prototype.bulkPut=function(e,t,r){var n=this,i=Array.isArray(t)?t:void 0,s=(r=r||(i?void 0:t))?r.allKeys:void 0
return this._trans("readwrite",t=>{var r,a=(r=n.schema.primKey).auto
if((r=r.keyPath)&&i)throw new $.InvalidArgument("bulkPut(): keys argument invalid on tables with inbound keys")
if(i&&i.length!==e.length)throw new $.InvalidArgument("Arguments objects and keys must have the same length")
var o=e.length
return a=r&&a?e.map(st(r)):e,n.core.mutate({trans:t,type:"put",keys:i,values:a,wantResults:s}).then(e=>{var t=e.numFailures,r=e.failures
if(0===t)return s?e.results:e.lastResult
throw new U("".concat(n.name,".bulkPut(): ").concat(t," of ").concat(o," operations failed"),r)})})},yt.prototype.bulkUpdate=function(e){var t=this,r=this.core,n=e.map(e=>e.key),i=e.map(e=>e.changes),s=[]
return this._trans("readwrite",a=>r.getMany({trans:a,keys:n,cache:"clone"}).then(o=>{var u=[],l=[],c=(e.forEach((e,r)=>{var n=e.key,i=e.changes,a=o[r]
if(a){for(var c=0,h=Object.keys(i);c<h.length;c++){var d=h[c],f=i[d]
if(d===t.schema.primKey.keyPath){if(0!==ot(f,n))throw new $.Constraint("Cannot update primary key in bulkUpdate()")}else _(a,d,f)}s.push(r),u.push(n),l.push(a)}}),u.length)
return r.mutate({trans:a,type:"put",keys:u,values:l,updates:{keys:n,changeSpecs:i}}).then(e=>{var r=e.numFailures,n=e.failures
if(0===r)return c
for(var i=0,a=Object.keys(n);i<a.length;i++){var o,u=a[i],l=s[Number(u)]
null!=l&&(o=n[u],delete n[u],n[l]=o)}throw new U("".concat(t.name,".bulkUpdate(): ").concat(r," of ").concat(c," operations failed"),n)})}))},yt.prototype.bulkDelete=function(e){var t=this,r=e.length
return this._trans("readwrite",r=>t.core.mutate({trans:r,type:"delete",keys:e}).then(r=>ct(t,e,r))).then(e=>{var n=e.numFailures,i=e.failures
if(0===n)return e.lastResult
throw new U("".concat(t.name,".bulkDelete(): ").concat(n," of ").concat(r," operations failed"),i)})}
var pt=yt
function yt(){}function vt(e){function t(t,n){if(n){for(var i=arguments.length,s=new Array(i-1);--i;)s[i-1]=arguments[i]
return r[t].subscribe.apply(null,s),e}if("string"==typeof t)return r[t]}var r={}
t.addEventType=o
for(var n=1,a=arguments.length;n<a;++n)o(arguments[n])
return t
function o(e,n,a){var u,l
if("object"!=typeof e)return n=n||ee,l={subscribers:[],fire:a=a||z,subscribe:e=>{-1===l.subscribers.indexOf(e)&&(l.subscribers.push(e),l.fire=n(l.fire,e))},unsubscribe:e=>{l.subscribers=l.subscribers.filter(t=>t!==e),l.fire=l.subscribers.reduce(n,a)}},r[e]=t[e]=l
i(u=e).forEach(e=>{var t=u[e]
if(s(t))o(e,u[e][0],u[e][1])
else{if("asap"!==t)throw new $.InvalidArgument("Invalid event config")
var r=o(e,H,function(){for(var e=arguments.length,t=new Array(e);e--;)t[e]=arguments[e]
r.subscribers.forEach(e=>{g(()=>{e.apply(null,t)})})})}})}}function mt(e,t){return f(t).from({prototype:e}),t}function bt(e,t){return!(e.filter||e.algorithm||e.or)&&(t?e.justLimit:!e.replayFilter)}function gt(e,t){e.filter=nt(e.filter,t)}function wt(e,t,r){var n=e.replayFilter
e.replayFilter=n?()=>nt(n(),t()):t,e.justLimit=r&&!n}function _t(e,t){if(e.isPrimKey)return t.primaryKey
var r=t.getIndexByKeyPath(e.index)
if(r)return r
throw new $.Schema("KeyPath "+e.index+" on object store "+t.name+" is not indexed")}function kt(e,t,r){var n=_t(e,t.schema)
return t.openCursor({trans:r,values:!e.keysOnly,reverse:"prev"===e.dir,unique:!!e.unique,query:{index:n,range:e.range}})}function Ot(e,t,r,n){var i,s,a=e.replayFilter?nt(e.filter,e.replayFilter()):e.filter
return e.or?(i={},s=(e,r,n)=>{var s,o
a&&!a(r,n,e=>r.stop(e),e=>r.fail(e))||("[object ArrayBuffer]"==(o=""+(s=r.primaryKey))&&(o=""+new Uint8Array(s)),l(i,o))||(i[o]=!0,t(e,r,n))},Promise.all([e.or._iterate(s,r),xt(kt(e,n,r),e.algorithm,s,!e.keysOnly&&e.valueMapper)])):xt(kt(e,n,r),nt(e.algorithm,a),t,!e.keysOnly&&e.valueMapper)}function xt(e,t,r,n){var i=je(n?(e,t,i)=>r(n(e),t,i):r)
return e.then(e=>{if(e)return e.start(()=>{var r=()=>e.continue()
t&&!t(e,e=>r=e,t=>{e.stop(t),r=z},t=>{e.fail(t),r=z})||i(e.value,e,e=>r=e),r()})})}St.prototype._read=function(e,t){var r=this._ctx
return r.error?r.table._trans(null,Ye.bind(null,r.error)):r.table._trans("readonly",e).then(t)},St.prototype._write=function(e){var t=this._ctx
return t.error?t.table._trans(null,Ye.bind(null,t.error)):t.table._trans("readwrite",e,"locked")},St.prototype._addAlgorithm=function(e){var t=this._ctx
t.algorithm=nt(t.algorithm,e)},St.prototype._iterate=function(e,t){return Ot(this._ctx,e,t,this._ctx.table.core)},St.prototype.clone=function(e){var t=Object.create(this.constructor.prototype),r=Object.create(this._ctx)
return e&&a(r,e),t._ctx=r,t},St.prototype.raw=function(){return this._ctx.valueMapper=null,this},St.prototype.each=function(e){var t=this._ctx
return this._read(r=>Ot(t,e,r,t.table.core))},St.prototype.count=function(e){var t=this
return this._read(e=>{var r,n=t._ctx,i=n.table.core
return bt(n,!0)?i.count({trans:e,query:{index:_t(n,i.schema),range:n.range}}).then(e=>Math.min(e,n.limit)):(r=0,Ot(n,()=>(++r,!1),e,i).then(()=>r))}).then(e)},St.prototype.sortBy=function(e,t){var r=e.split(".").reverse(),n=r[0],i=r.length-1
function s(e,t){return t?s(e[r[t]],t-1):e[n]}var a="next"===this._ctx.dir?1:-1
function o(e,t){return ot(s(e,i),s(t,i))*a}return this.toArray(e=>e.slice().sort(o)).then(t)},St.prototype.toArray=function(e){var t=this
return this._read(e=>{var r,n,i,s=t._ctx
return bt(s,!0)&&0<s.limit?(r=s.valueMapper,n=_t(s,s.table.core.schema),s.table.core.query({trans:e,limit:s.limit,values:!0,direction:"prev"===s.dir?"prev":void 0,query:{index:n,range:s.range}}).then(e=>(e=e.result,r?e.map(r):e))):(i=[],Ot(s,e=>i.push(e),e,s.table.core).then(()=>i))},e)},St.prototype.offset=function(e){var t=this._ctx
return e<=0||(t.offset+=e,bt(t)?wt(t,()=>{var t=e
return(e,r)=>0===t||(1===t?--t:r(()=>{e.advance(t),t=0}),!1)}):wt(t,()=>{var t=e
return()=>--t<0})),this},St.prototype.limit=function(e){return this._ctx.limit=Math.min(this._ctx.limit,e),wt(this._ctx,()=>{var t=e
return(e,r,n)=>(--t<=0&&r(n),0<=t)},!0),this},St.prototype.until=function(e,t){return gt(this._ctx,(r,n,i)=>!e(r.value)||(n(i),t)),this},St.prototype.first=function(e){return this.limit(1).toArray(e=>e[0]).then(e)},St.prototype.last=function(e){return this.reverse().first(e)},St.prototype.filter=function(e){var t
return gt(this._ctx,t=>e(t.value)),(t=this._ctx).isMatch=nt(t.isMatch,e),this},St.prototype.and=function(e){return this.filter(e)},St.prototype.or=function(e){return new this.db.WhereClause(this._ctx.table,e,this)},St.prototype.reverse=function(){return this._ctx.dir="prev"===this._ctx.dir?"next":"prev",this._ondirectionchange&&this._ondirectionchange(this._ctx.dir),this},St.prototype.desc=function(){return this.reverse()},St.prototype.eachKey=function(e){var t=this._ctx
return t.keysOnly=!t.isMatch,this.each((t,r)=>{e(r.key,r)})},St.prototype.eachUniqueKey=function(e){return this._ctx.unique="unique",this.eachKey(e)},St.prototype.eachPrimaryKey=function(e){var t=this._ctx
return t.keysOnly=!t.isMatch,this.each((t,r)=>{e(r.primaryKey,r)})},St.prototype.keys=function(e){var t=this._ctx,r=(t.keysOnly=!t.isMatch,[])
return this.each((e,t)=>{r.push(t.key)}).then(()=>r).then(e)},St.prototype.primaryKeys=function(e){var t=this._ctx
if(bt(t,!0)&&0<t.limit)return this._read(e=>{var r=_t(t,t.table.core.schema)
return t.table.core.query({trans:e,values:!1,limit:t.limit,direction:"prev"===t.dir?"prev":void 0,query:{index:r,range:t.range}})}).then(e=>e.result).then(e)
t.keysOnly=!t.isMatch
var r=[]
return this.each((e,t)=>{r.push(t.primaryKey)}).then(()=>r).then(e)},St.prototype.uniqueKeys=function(e){return this._ctx.unique="unique",this.keys(e)},St.prototype.firstKey=function(e){return this.limit(1).keys(e=>e[0]).then(e)},St.prototype.lastKey=function(e){return this.reverse().firstKey(e)},St.prototype.distinct=function(){var e,t
return(t=(t=this._ctx).index&&t.table.schema.idxByName[t.index])&&t.multi&&(e={},gt(this._ctx,t=>{t=t.primaryKey.toString()
var r=l(e,t)
return e[t]=!0,!r})),this},St.prototype.modify=function(e){var t=this,r=this._ctx
return this._write(n=>{function s(e,t){var r=t.failures
f+=e-t.numFailures
for(var n=0,s=i(r);n<s.length;n++){var a=s[n]
d.push(r[a])}}var a,o="function"==typeof e?e:t=>ft(t,e),u=r.table.core,l=(a=u.schema.primaryKey).outbound,c=a.extractKey,h=200,d=((a=t.db._options.modifyChunkSize)&&(h="object"==typeof a?a[u.name]||a["*"]||200:a),[]),f=0,p=[],y=e===Et
return t.clone().primaryKeys().then(t=>{var i=bt(r)&&r.limit===1/0&&("function"!=typeof e||y)&&{index:r.index,range:r.range}
return function a(d){var f=Math.min(h,t.length-d),p=t.slice(d,d+f)
return(y?Promise.resolve([]):u.getMany({trans:n,keys:p,cache:"immutable"})).then(v=>{var m=[],b=[],g=l?[]:null,w=y?p:[]
if(!y)for(var _=0;_<f;++_){var k=v[_],O={value:C(k),primKey:t[d+_]}
!1!==o.call(O,O.value,O)&&(null==O.value?w.push(t[d+_]):l||0===ot(c(k),c(O.value))?(b.push(O.value),l&&g.push(t[d+_])):(w.push(t[d+_]),m.push(O.value)))}return Promise.resolve(0<m.length&&u.mutate({trans:n,type:"add",values:m}).then(e=>{for(var t in e.failures)w.splice(parseInt(t),1)
s(m.length,e)})).then(()=>(0<b.length||i&&"object"==typeof e)&&u.mutate({trans:n,type:"put",keys:g,values:b,criteria:i,changeSpec:"function"!=typeof e&&e,isAdditionalChunk:0<d}).then(e=>s(b.length,e))).then(()=>(0<w.length||i&&y)&&u.mutate({trans:n,type:"delete",keys:w,criteria:i,isAdditionalChunk:0<d}).then(e=>ct(r.table,w,e)).then(e=>s(w.length,e))).then(()=>t.length>d+f&&a(d+h))})}(0).then(()=>{if(0<d.length)throw new W("Error modifying one or more objects",d,f,p)
return t.length})})})},St.prototype.delete=function(){var e=this._ctx,t=e.range
return!bt(e)||e.table.schema.yProps||!e.isPrimKey&&3!==t.type?this.modify(Et):this._write(r=>{var n=e.table.core.schema.primaryKey,i=t
return e.table.core.count({trans:r,query:{index:n,range:i}}).then(t=>e.table.core.mutate({trans:r,type:"deleteRange",range:i}).then(e=>{var r=e.failures
if(e=e.numFailures)throw new W("Could not delete some values",Object.keys(r).map(e=>r[e]),t-e)
return t-e}))})}
var Pt=St
function St(){}var Et=(e,t)=>t.value=null
function Ct(e,t){return e<t?-1:e===t?0:1}function Rt(e,t){return t<e?-1:e===t?0:1}function Kt(e,t,r){return(e=e instanceof Tt?new e.Collection(e):e)._ctx.error=new(r||TypeError)(t),e}function At(e){return new e.Collection(e,()=>qt("")).limit(0)}function jt(e,t,r,n){var i,s,a,o,u,l,c,h=r.length
if(!r.every(e=>"string"==typeof e))return Kt(e,Ze)
function d(e){i="next"===e?e=>e.toUpperCase():e=>e.toLowerCase(),s="next"===e?e=>e.toLowerCase():e=>e.toUpperCase(),a="next"===e?Ct:Rt
var t=r.map(e=>({lower:s(e),upper:i(e)})).sort((e,t)=>a(e.lower,t.lower))
o=t.map(e=>e.upper),u=t.map(e=>e.lower),c="next"===(l=e)?"":n}d("next")
var f=((e=new e.Collection(e,()=>Mt(o[0],u[h-1]+n)))._ondirectionchange=e=>{d(e)},0)
return e._addAlgorithm((e,r,n)=>{var i=e.key
if("string"==typeof i){var d=s(i)
if(t(d,u,f))return!0
for(var p=null,y=f;y<h;++y){var v=((e,t,r,n,i,s)=>{for(var a=Math.min(e.length,n.length),o=-1,u=0;u<a;++u){var l=t[u]
if(l!==n[u])return i(e[u],r[u])<0?e.substr(0,u)+r[u]+r.substr(u+1):i(e[u],n[u])<0?e.substr(0,u)+n[u]+r.substr(u+1):0<=o?e.substr(0,o)+t[o]+r.substr(o+1):null
i(e[u],l)<0&&(o=u)}return a<n.length&&"next"===s?e+r.substr(e.length):a<e.length&&"prev"===s?e.substr(0,r.length):o<0?null:e.substr(0,o)+n[o]+r.substr(o+1)})(i,d,o[y],u[y],a,l)
null===v&&null===p?f=y+1:(null===p||0<a(p,v))&&(p=v)}r(null!==p?()=>{e.continue(p+c)}:n)}return!1}),e}function Mt(e,t,r,n){return{type:2,lower:e,upper:t,lowerOpen:r,upperOpen:n}}function qt(e){return{type:1,lower:e,upper:e}}Object.defineProperty(It.prototype,"Collection",{get:function(){return this._ctx.table.db.Collection},enumerable:!1,configurable:!0}),It.prototype.between=function(e,t,r,n){r=!1!==r,n=!0===n
try{return 0<this._cmp(e,t)||0===this._cmp(e,t)&&(r||n)&&(!r||!n)?At(this):new this.Collection(this,()=>Mt(e,t,!r,!n))}catch(i){return Kt(this,Je)}},It.prototype.equals=function(e){return null==e?Kt(this,Je):new this.Collection(this,()=>qt(e))},It.prototype.above=function(e){return null==e?Kt(this,Je):new this.Collection(this,()=>Mt(e,void 0,!0))},It.prototype.aboveOrEqual=function(e){return null==e?Kt(this,Je):new this.Collection(this,()=>Mt(e,void 0,!1))},It.prototype.below=function(e){return null==e?Kt(this,Je):new this.Collection(this,()=>Mt(void 0,e,!1,!0))},It.prototype.belowOrEqual=function(e){return null==e?Kt(this,Je):new this.Collection(this,()=>Mt(void 0,e))},It.prototype.startsWith=function(e){return"string"!=typeof e?Kt(this,Ze):this.between(e,e+Xe,!0,!0)},It.prototype.startsWithIgnoreCase=function(e){return""===e?this.startsWith(e):jt(this,(e,t)=>0===e.indexOf(t[0]),[e],Xe)},It.prototype.equalsIgnoreCase=function(e){return jt(this,(e,t)=>e===t[0],[e],"")},It.prototype.anyOfIgnoreCase=function(){var e=T.apply(q,arguments)
return 0===e.length?At(this):jt(this,(e,t)=>-1!==t.indexOf(e),e,"")},It.prototype.startsWithAnyOfIgnoreCase=function(){var e=T.apply(q,arguments)
return 0===e.length?At(this):jt(this,(e,t)=>t.some(t=>0===e.indexOf(t)),e,Xe)},It.prototype.anyOf=function(){var e,t,r=this,n=T.apply(q,arguments),i=this._cmp
try{n.sort(i)}catch(s){return Kt(this,Je)}return 0===n.length?At(this):((e=new this.Collection(this,()=>Mt(n[0],n[n.length-1])))._ondirectionchange=e=>{i="next"===e?r._ascending:r._descending,n.sort(i)},t=0,e._addAlgorithm((e,r,s)=>{for(var a=e.key;0<i(a,n[t]);)if(++t===n.length)return r(s),!1
return 0===i(a,n[t])||(r(()=>{e.continue(n[t])}),!1)}),e)},It.prototype.notEqual=function(e){return this.inAnyRange([[-1/0,e],[e,this.db._maxKey]],{includeLowers:!1,includeUppers:!1})},It.prototype.noneOf=function(){var e=T.apply(q,arguments)
if(0===e.length)return new this.Collection(this)
try{e.sort(this._ascending)}catch(r){return Kt(this,Je)}var t=e.reduce((e,t)=>e?e.concat([[e[e.length-1][1],t]]):[[-1/0,t]],null)
return t.push([e[e.length-1],this.db._maxKey]),this.inAnyRange(t,{includeLowers:!1,includeUppers:!1})},It.prototype.inAnyRange=function(e,t){var r=this,n=this._cmp,i=this._ascending,s=this._descending,a=this._min,o=this._max
if(0===e.length)return At(this)
if(!e.every(e=>void 0!==e[0]&&void 0!==e[1]&&i(e[0],e[1])<=0))return Kt(this,"First argument to inAnyRange() must be an Array of two-value Arrays [lower,upper] where upper must not be lower than lower",$.InvalidArgument)
var u,l=!t||!1!==t.includeLowers,c=t&&!0===t.includeUppers,h=i
function d(e,t){return h(e[0],t[0])}try{(u=e.reduce((e,t)=>{for(var r=0,i=e.length;r<i;++r){var s=e[r]
if(n(t[0],s[1])<0&&0<n(t[1],s[0])){s[0]=a(s[0],t[0]),s[1]=o(s[1],t[1])
break}}return r===i&&e.push(t),e},[])).sort(d)}catch(m){return Kt(this,Je)}var f=0,p=c?e=>0<i(e,u[f][1]):e=>0<=i(e,u[f][1]),y=l?e=>0<s(e,u[f][0]):e=>0<=s(e,u[f][0]),v=p
return(t=new this.Collection(this,()=>Mt(u[0][0],u[u.length-1][1],!l,!c)))._ondirectionchange=e=>{h="next"===e?(v=p,i):(v=y,s),u.sort(d)},t._addAlgorithm((e,t,n)=>{for(var s,a=e.key;v(a);)if(++f===u.length)return t(n),!1
return!p(s=a)&&!y(s)||(0===r._cmp(a,u[f][1])||0===r._cmp(a,u[f][0])||t(()=>{h===i?e.continue(u[f][0]):e.continue(u[f][1])}),!1)}),t},It.prototype.startsWithAnyOf=function(){var e=T.apply(q,arguments)
return e.every(e=>"string"==typeof e)?0===e.length?At(this):this.inAnyRange(e.map(e=>[e,e+Xe])):Kt(this,"startsWithAnyOf() only works with strings")}
var Tt=It
function It(){}function Dt(e){return je(t=>(Ft(t),e(t.target.error),!1))}function Ft(e){e.stopPropagation&&e.stopPropagation(),e.preventDefault&&e.preventDefault()}var Bt="storagemutated",Nt="x-storagemutated-1",Wt=vt(null,Bt),Ut=(Lt.prototype._lock=function(){return b(!ve.global),++this._reculock,1!==this._reculock||ve.global||(ve.lockOwnerFor=this),this},Lt.prototype._unlock=function(){if(b(!ve.global),0==--this._reculock)for(ve.global||(ve.lockOwnerFor=null);0<this._blockedFuncs.length&&!this._locked();){var e=this._blockedFuncs.shift()
try{ze(e[1],e[0])}catch(t){}}return this},Lt.prototype._locked=function(){return this._reculock&&ve.lockOwnerFor!==this},Lt.prototype.create=function(e){var t=this
if(this.mode){var r=this.db.idbdb,n=this.db._state.dbOpenError
if(b(!this.idbtrans),!e&&!r)switch(n&&n.name){case"DatabaseClosedError":throw new $.DatabaseClosed(n)
case"MissingAPIError":throw new $.MissingAPI(n.message,n)
default:throw new $.OpenFailed(n)}if(!this.active)throw new $.TransactionInactive
b(null===this._completion._state),(e=this.idbtrans=e||(this.db.core||r).transaction(this.storeNames,this.mode,{durability:this.chromeTransactionDurability})).onerror=je(r=>{Ft(r),t._reject(e.error)}),e.onabort=je(r=>{Ft(r),t.active&&t._reject(new $.Abort(e.error)),t.active=!1,t.on("abort").fire(r)}),e.oncomplete=je(()=>{t.active=!1,t._resolve(),"mutatedParts"in e&&Wt.storagemutated.fire(e.mutatedParts)})}return this},Lt.prototype._promise=function(e,t,r){var n,i=this
return"readwrite"===e&&"readwrite"!==this.mode?Ye(new $.ReadOnly("Transaction is readonly")):this.active?this._locked()?new we((n,s)=>{i._blockedFuncs.push([()=>{i._promise(e,t,r).then(n,s)},ve])}):r?Ne(()=>{var e=new we((e,r)=>{i._lock()
var n=t(e,r,i)
n&&n.then&&n.then(e,r)})
return e.finally(()=>i._unlock()),e._lib=!0,e}):((n=new we((e,r)=>{var n=t(e,r,i)
n&&n.then&&n.then(e,r)}))._lib=!0,n):Ye(new $.TransactionInactive)},Lt.prototype._root=function(){return this.parent?this.parent._root():this},Lt.prototype.waitFor=function(e){var t,r=this._root(),n=we.resolve(e),i=(r._waitingFor?r._waitingFor=r._waitingFor.then(()=>n):(r._waitingFor=n,r._waitingQueue=[],t=r.idbtrans.objectStore(r.storeNames[0]),function e(){for(++r._spinCount;r._waitingQueue.length;)r._waitingQueue.shift()()
r._waitingFor&&(t.get(-1/0).onsuccess=e)}()),r._waitingFor)
return new we((e,t)=>{n.then(t=>r._waitingQueue.push(je(e.bind(null,t))),e=>r._waitingQueue.push(je(t.bind(null,e)))).finally(()=>{r._waitingFor===i&&(r._waitingFor=null)})})},Lt.prototype.abort=function(){this.active&&(this.active=!1,this.idbtrans&&this.idbtrans.abort(),this._reject(new $.Abort))},Lt.prototype.table=function(e){var t=this._memoizedTables||(this._memoizedTables={})
if(l(t,e))return t[e]
var r=this.schema[e]
if(r)return(r=new this.db.Table(e,r,this)).core=this.db.core.table(e),t[e]=r
throw new $.NotFound("Table "+e+" not part of transaction")},Lt)
function Lt(){}function Qt(e,t,r,n,i,s,a,o){return{name:e,keyPath:t,unique:r,multi:n,auto:i,compound:s,src:(r&&!a?"&":"")+(n?"*":"")+(i?"++":"")+$t(t),type:o}}function $t(e){return"string"==typeof e?e:e?"["+[].join.call(e,"+")+"]":""}function Vt(e,t,r){return{name:e,primKey:t,indexes:r,mappedClass:null,idxByName:(n=e=>[e.name,e],r.reduce((e,t)=>((t=n(t))&&(e[t[0]]=t[1]),e),{}))}
var n}var zt=e=>{try{return e.only([[]]),zt=()=>[[]],[[]]}catch(t){return zt=()=>Xe,Xe}}
function Ht(e){return null==e?()=>{}:"string"==typeof e?1===(t=e).split(".").length?e=>e[t]:e=>w(e,t):t=>w(t,e)
var t}function Gt(e){return[].slice.call(e)}var Yt=0
function Xt(e){return null==e?":id":"string"==typeof e?e:"[".concat(e.join("+"),"]")}function Jt(e,r){var n=r.db
n=function(e,r,n,i){return r=function(e,t,r){function n(e){if(3===e.type)return null
if(4===e.type)throw new Error("Cannot convert never type to IDBKeyRange")
var r=e.lower,n=e.upper,i=e.lowerOpen
return e=e.upperOpen,void 0===r?void 0===n?null:t.upperBound(n,!!e):void 0===n?t.lowerBound(r,!!i):t.bound(r,n,!!i,!!e)}i=r,l=0<(a=Gt((r=e).objectStoreNames)).length?i.objectStore(a[0]):{}
var i,a=(r={schema:{name:r.name,tables:a.map(e=>i.objectStore(e)).map(e=>{var t=e.keyPath,r=e.autoIncrement,n=s(t),i={}
return n={name:e.name,primaryKey:{name:null,isPrimaryKey:!0,outbound:null==t,compound:n,keyPath:t,autoIncrement:r,unique:!0,extractKey:Ht(t)},indexes:Gt(e.indexNames).map(t=>e.index(t)).map(e=>{var t=e.name,r=e.unique,n=e.multiEntry
return e=e.keyPath,t={name:t,compound:s(e),keyPath:e,unique:r,multiEntry:n,extractKey:Ht(e)},i[Xt(e)]=t}),getIndexByKeyPath:e=>i[Xt(e)]},i[":id"]=n.primaryKey,null!=t&&(i[Xt(t)]=n.primaryKey),n})},hasGetAll:0<a.length&&"getAll"in l&&!("undefined"!=typeof navigator&&/Safari/.test(navigator.userAgent)&&!/(Chrome\/|Edge\/)/.test(navigator.userAgent)&&[].concat(navigator.userAgent.match(/Safari\/(\d*)/))[1]<604),hasIdb3Features:"getAllRecords"in l}).schema,o=r.hasGetAll,u=r.hasIdb3Features,l=a.tables.map(function(e){var t,r,i=e.name
return{name:i,schema:e,mutate:e=>{var t=e.trans,r=e.type,s=e.keys,a=e.values,o=e.range
return new Promise(e=>{e=je(e)
var u=t.objectStore(i),l=null==u.keyPath,c="put"===r||"add"===r
if(!c&&"delete"!==r&&"deleteRange"!==r)throw new Error("Invalid operation type: "+r)
var h,d=(s||a||{length:1}).length
if(s&&a&&s.length!==a.length)throw new Error("Given keys array must have same length as given values array.")
if(0===d)return e({numFailures:0,failures:{},results:[],lastResult:void 0})
function f(e){++v,Ft(e)}var p=[],y=[],v=0
if("deleteRange"===r){if(4===o.type)return e({numFailures:v,failures:y,results:[],lastResult:void 0})
3===o.type?p.push(h=u.clear()):p.push(h=u.delete(n(o)))}else{var m=(l=c?l?[a,s]:[a,null]:[s,null])[0],b=l[1]
if(c)for(var g=0;g<d;++g)p.push(h=b&&void 0!==b[g]?u[r](m[g],b[g]):u[r](m[g])),h.onerror=f
else for(g=0;g<d;++g)p.push(h=u[r](m[g])),h.onerror=f}function w(t){t=t.target.result,p.forEach((e,t)=>null!=e.error&&(y[t]=e.error)),e({numFailures:v,failures:y,results:"delete"===r?s:p.map(e=>e.result),lastResult:t})}h.onerror=e=>{f(e),w(e)},h.onsuccess=w})},getMany:e=>{var t=e.trans,r=e.keys
return new Promise((e,n)=>{e=je(e)
for(var s,a=t.objectStore(i),o=r.length,u=new Array(o),l=0,c=0,h=t=>{t=t.target,u[t._pos]=t.result,++c===l&&e(u)},d=Dt(n),f=0;f<o;++f)null!=r[f]&&((s=a.get(r[f]))._pos=f,s.onsuccess=h,s.onerror=d,++l)
0===l&&e(u)})},get:e=>{var t=e.trans,r=e.key
return new Promise((e,n)=>{e=je(e)
var s=t.objectStore(i).get(r)
s.onsuccess=t=>e(t.target.result),s.onerror=Dt(n)})},query:(t=o,r=u,e=>new Promise((s,a)=>{s=je(s)
var o,u,l,c,h=e.trans,d=e.values,f=e.limit,p=e.query,y=null!=(y=e.direction)?y:"next",v=f===1/0?void 0:f,m=p.index
if(p=p.range,h=h.objectStore(i),h=m.isPrimaryKey?h:h.index(m.name),m=n(p),0===f)return s({result:[]})
r?(p={query:m,count:v,direction:y},(o=d?h.getAll(p):h.getAllKeys(p)).onsuccess=e=>s({result:e.target.result}),o.onerror=Dt(a)):t&&"next"===y?((o=d?h.getAll(m,v):h.getAllKeys(m,v)).onsuccess=e=>s({result:e.target.result}),o.onerror=Dt(a)):(u=0,l=!d&&"openKeyCursor"in h?h.openKeyCursor(m,y):h.openCursor(m,y),c=[],l.onsuccess=()=>{var e=l.result
return e&&(c.push(d?e.value:e.primaryKey),++u!==f)?void e.continue():s({result:c})},l.onerror=Dt(a))})),openCursor:function(e){var t=e.trans,r=e.values,s=e.query,a=e.reverse,o=e.unique
return new Promise(function(e,u){e=je(e)
var l=s.index,c=s.range,h=t.objectStore(i),d=(h=l.isPrimaryKey?h:h.index(l.name),l=a?o?"prevunique":"prev":o?"nextunique":"next",!r&&"openKeyCursor"in h?h.openKeyCursor(n(c),l):h.openCursor(n(c),l))
d.onerror=Dt(u),d.onsuccess=je(function(){var r,n,i,s,a=d.result
a?(a.___id=++Yt,a.done=!1,r=a.continue.bind(a),n=(n=a.continuePrimaryKey)&&n.bind(a),i=a.advance.bind(a),s=()=>{throw new Error("Cursor not stopped")},a.trans=t,a.stop=a.continue=a.continuePrimaryKey=a.advance=()=>{throw new Error("Cursor not started")},a.fail=je(u),a.next=function(){var e=this,t=1
return this.start(()=>t--?e.continue():e.stop()).then(()=>e)},a.start=e=>{function t(){if(d.result)try{e()}catch(t){a.fail(t)}else a.done=!0,a.start=()=>{throw new Error("Cursor behind last entry")},a.stop()}var o=new Promise((e,t)=>{e=je(e),d.onerror=Dt(t),a.fail=t,a.stop=t=>{a.stop=a.continue=a.continuePrimaryKey=a.advance=s,e(t)}})
return d.onsuccess=je(()=>{d.onsuccess=t,t()}),a.continue=r,a.continuePrimaryKey=n,a.advance=i,t(),o},e(a)):e(null)},u)})},count:e=>{var t=e.query,r=e.trans,s=t.index,a=t.range
return new Promise((e,t)=>{var o,u=r.objectStore(i)
u=s.isPrimaryKey?u:u.index(s.name),(o=(o=n(a))?u.count(o):u.count()).onsuccess=je(t=>e(t.target.result)),o.onerror=Dt(t)})}}}),c={}
return l.forEach(e=>c[e.name]=e),{stack:"dbcore",transaction:e.transaction.bind(e),table:e=>{if(c[e])return c[e]
throw new Error("Table '".concat(e,"' not found"))},MIN_KEY:-1/0,MAX_KEY:zt(t),schema:a}}(r,n=n.IDBKeyRange,i),{dbcore:e.dbcore.reduce((e,r)=>(r=r.create,t(t({},e),r(e))),r)}}(e._middlewares,n,e._deps,r),e.core=n.dbcore,e.tables.forEach(t=>{var r=t.name
e.core.schema.tables.some(e=>e.name===r)&&(t.core=e.core.table(r),e[r]instanceof e.Table)&&(e[r].core=t.core)})}function Zt(e,t,r,n){r.forEach(function(r){var i=n[r]
t.forEach(function(t){var n=function e(t,r){return p(t,r)||(t=o(t))&&e(t,r)}(t,r);(!n||"value"in n&&void 0===n.value)&&(t===e.Transaction.prototype||t instanceof e.Transaction?d(t,r,{get:function(){return this.table(r)},set:function(e){h(this,r,{value:e,writable:!0,configurable:!0,enumerable:!0})}}):t[r]=new e.Table(r,i))})})}function er(e,t){t.forEach(t=>{for(var r in t)t[r]instanceof e.Table&&delete t[r]})}function tr(e,t){return e._cfg.version-t._cfg.version}function rr(e,t){var r,n={del:[],add:[],change:[]}
for(r in e)t[r]||n.del.push(r)
for(r in t){var i=e[r],s=t[r]
if(i){var a={name:r,def:s,recreate:!1,del:[],add:[],change:[]}
if(""+(i.primKey.keyPath||"")!=""+(s.primKey.keyPath||"")||i.primKey.auto!==s.primKey.auto)a.recreate=!0,n.change.push(a)
else{var o=i.idxByName,u=s.idxByName,l=void 0
for(l in o)u[l]||a.del.push(l)
for(l in u){var c=o[l],h=u[l]
c?c.src!==h.src&&a.change.push(h):a.add.push(h)}(0<a.del.length||0<a.add.length||0<a.change.length)&&n.change.push(a)}}else n.add.push([r,s])}return n}function nr(e,t,r,n){var i=e.db.createObjectStore(t,r.keyPath?{keyPath:r.keyPath,autoIncrement:r.auto}:{autoIncrement:r.auto})
n.forEach(e=>sr(i,e))}function ir(e,t){i(e).forEach(r=>{t.db.objectStoreNames.contains(r)||nr(t,r,e[r].primKey,e[r].indexes)})}function sr(e,t){e.createIndex(t.name,t.keyPath,{unique:t.unique,multiEntry:t.multi})}function ar(e,t,r){var n={}
return v(t.objectStoreNames,0).forEach(e=>{for(var t=r.objectStore(e),i=Qt($t(o=t.keyPath),o||"",!0,!1,!!t.autoIncrement,o&&"string"!=typeof o,!0),s=[],a=0;a<t.indexNames.length;++a){var o=(u=t.index(t.indexNames[a])).keyPath,u=Qt(u.name,o,!!u.unique,!!u.multiEntry,!1,o&&"string"!=typeof o,!1)
s.push(u)}n[e]=Vt(e,i,s)}),n}function or(e,t,r){for(var i=r.db.objectStoreNames,s=0;s<i.length;++s){var a=i[s],o=r.objectStore(a)
e._hasGetAll="getAll"in o
for(var u=0;u<o.indexNames.length;++u){var l,c=o.indexNames[u],h="string"==typeof(h=o.index(c).keyPath)?h:"["+v(h).join("+")+"]"
t[a]&&(l=t[a].idxByName[h])&&(l.name=c,delete t[a].idxByName[h],t[a].idxByName[c]=l)}}"undefined"!=typeof navigator&&/Safari/.test(navigator.userAgent)&&!/(Chrome\/|Edge\/)/.test(navigator.userAgent)&&n.WorkerGlobalScope&&n instanceof n.WorkerGlobalScope&&[].concat(navigator.userAgent.match(/Safari\/(\d*)/))[1]<604&&(e._hasGetAll=!1)}function ur(e){return e.split(",").map((e,t)=>{var r=null==(r=(n=e.split(":"))[1])?void 0:r.trim(),n=(e=n[0].trim()).replace(/([&*]|\+\+)/g,""),i=/^\[/.test(n)?n.match(/^\[(.*)\]$/)[1].split("+"):n
return Qt(n,i||null,/\&/.test(e),/\*/.test(e),/\+\+/.test(e),s(i),0===t,r)})}cr.prototype._createTableSchema=Vt,cr.prototype._parseIndexSyntax=ur,cr.prototype._parseStoresSpec=function(e,t){var r=this
i(e).forEach(n=>{if(null!==e[n]){var i=r._parseIndexSyntax(e[n]),s=i.shift()
if(!s)throw new $.Schema("Invalid schema for table "+n+": "+e[n])
if(s.unique=!0,s.multi)throw new $.Schema("Primary key cannot be multiEntry*")
i.forEach(e=>{if(e.auto)throw new $.Schema("Only primary key can be marked as autoIncrement (++)")
if(!e.keyPath)throw new $.Schema("Index must have a name and cannot be an empty string")}),s=r._createTableSchema(n,s,i),t[n]=s}})},cr.prototype.stores=function(e){var t=this.db,r=(this._cfg.storesSource=this._cfg.storesSource?a(this._cfg.storesSource,e):e,e=t._versions,{}),n={}
return e.forEach(e=>{a(r,e._cfg.storesSource),n=e._cfg.dbschema={},e._parseStoresSpec(r,n)}),t._dbSchema=n,er(t,[t._allTables,t,t.Transaction.prototype]),Zt(t,[t._allTables,t,t.Transaction.prototype,this._cfg.tables],i(n),n),t._storeNames=i(n),this},cr.prototype.upgrade=function(e){return this._cfg.contentUpgrade=te(this._cfg.contentUpgrade||z,e),this}
var lr=cr
function cr(){}var hr,dr,fr,pr="undefined"!=typeof FinalizationRegistry&&"undefined"!=typeof WeakRef?(hr=new Set,dr=new FinalizationRegistry(e=>{hr.delete(e)}),{toArray:()=>Array.from(hr).map(e=>e.deref()).filter(e=>void 0!==e),add:e=>{var t=new WeakRef(e._novip)
hr.add(t),dr.register(e._novip,t,t),hr.size>e._options.maxConnections&&(t=hr.values().next().value,hr.delete(t),dr.unregister(t))},remove:e=>{if(e)for(var t=hr.values(),r=t.next();!r.done;){var n=r.value
if(n.deref()===e._novip)return hr.delete(n),void dr.unregister(n)
r=t.next()}}}):(fr=[],{toArray:()=>fr,add:e=>{fr.push(e._novip)},remove:e=>{e&&-1!==(e=fr.indexOf(e._novip))&&fr.splice(e,1)}})
function yr(e,t){var r=e._dbNamesDB
return r||(r=e._dbNamesDB=new Xr(et,{addons:[],indexedDB:e,IDBKeyRange:t})).version(1).stores({dbnames:"name"}),r.table("dbnames")}function vr(e){return e&&"function"==typeof e.databases}function mr(e){return Ne(()=>(ve.letThrough=!0,e()))}function br(e){return!("from"in e)}var gr=function(e,t){var r
if(!this)return r=new gr,e&&"d"in e&&a(r,e),r
a(this,arguments.length?{d:1,from:e,to:1<arguments.length?t:e}:{d:0})}
function wr(e,t,r){var n=ot(t,r)
if(!isNaN(n)){if(0<n)throw RangeError()
if(br(e))return a(e,{from:t,to:r,d:1})
n=e.l
var i=e.r
if(ot(r,e.from)<0)return n?wr(n,t,r):e.l={from:t,to:r,d:1,l:null,r:null},xr(e)
if(0<ot(t,e.to))return i?wr(i,t,r):e.r={from:t,to:r,d:1,l:null,r:null},xr(e)
ot(t,e.from)<0&&(e.from=t,e.l=null,e.d=i?i.d+1:1),0<ot(r,e.to)&&(e.to=r,e.r=null,e.d=e.l?e.l.d+1:1),t=!e.r,n&&!e.l&&_r(e,n),i&&t&&_r(e,i)}}function _r(e,t){br(t)||function e(t,r){var n=r.from,i=r.l,s=r.r
wr(t,n,r.to),i&&e(t,i),s&&e(t,s)}(e,t)}function kr(e,t){var r=Or(t),n=r.next()
if(!n.done)for(var i=n.value,s=Or(e),a=s.next(i.from),o=a.value;!n.done&&!a.done;){if(ot(o.from,i.to)<=0&&0<=ot(o.to,i.from))return!0
ot(i.from,o.from)<0?i=(n=r.next(o.from)).value:o=(a=s.next(i.from)).value}return!1}function Or(e){var t=br(e)?null:{s:0,n:e}
return{next:function(e){for(var r=0<arguments.length;t;)switch(t.s){case 0:if(t.s=1,r)for(;t.n.l&&ot(e,t.n.from)<0;)t={up:t,n:t.n.l,s:1}
else for(;t.n.l;)t={up:t,n:t.n.l,s:1}
case 1:if(t.s=2,!r||ot(e,t.n.to)<=0)return{value:t.n,done:!1}
case 2:if(t.n.r){t.s=3,t={up:t,n:t.n.r,s:0}
continue}case 3:t=t.up}return{done:!0}}}}function xr(e){var r,n,i,s;(s=1<(s=((null==(s=e.r)?void 0:s.d)||0)-((null==(s=e.l)?void 0:s.d)||0))?"r":s<-1?"l":"")&&(r="r"==s?"l":"r",n=t({},e),i=e[s],e.from=i.from,e.to=i.to,e[s]=i[s],n[s]=i[r],(e[r]=n).d=Pr(n)),e.d=Pr(e)}function Pr(e){var t=e.r
return e=e.l,(t?e?Math.max(t.d,e.d):t.d:e?e.d:0)+1}function Sr(e,t){return i(t).forEach(r=>{e[r]?_r(e[r],t[r]):e[r]=function e(t){var r,n,i={}
for(r in t)l(t,r)&&(n=t[r],i[r]=!n||"object"!=typeof n||S.has(n.constructor)?n:e(n))
return i}(t[r])}),e}function Er(e,t){return e.all||t.all||Object.keys(e).some(r=>t[r]&&kr(t[r],e[r]))}c(gr.prototype,((D={add:function(e){return _r(this,e),this},addKey:function(e){return wr(this,e,e),this},addKeys:function(e){var t=this
return e.forEach(e=>wr(t,e,e)),this},hasKey:function(e){var t=Or(this).next(e).value
return t&&ot(t.from,e)<=0&&0<=ot(t.to,e)}})[A]=function(){return Or(this)},D))
var Cr={},Rr={},Kr=!1
function Ar(e){Sr(Rr,e),Kr||(Kr=!0,setTimeout(()=>{Kr=!1,jr(Rr,!(Rr={}))},0))}function jr(e,t){void 0===t&&(t=!1)
var r=new Set
if(e.all)for(var n=0,i=Object.values(Cr);n<i.length;n++)Mr(o=i[n],e,r,t)
else for(var s in e){var a,o;(s=/^idb\:\/\/(.*)\/(.*)\//.exec(s))&&(a=s[1],s=s[2],o=Cr["idb://".concat(a,"/").concat(s)])&&Mr(o,e,r,t)}r.forEach(e=>e())}function Mr(e,t,r,n){for(var i=[],s=0,a=Object.entries(e.queries.query);s<a.length;s++){for(var o=a[s],u=o[0],l=[],c=0,h=o[1];c<h.length;c++){var d=h[c]
Er(t,d.obsSet)?d.subscribers.forEach(e=>r.add(e)):n&&l.push(d)}n&&i.push([u,l])}if(n)for(var f=0,p=i;f<p.length;f++){var y=p[f]
u=y[0],l=y[1],e.queries.query[u]=l}}function qr(e){function t(t){return e.next(t)}var r=i(t),n=i(t=>e.throw(t))
function i(e){return t=>{var i=(t=e(t)).value
return t.done?i:i&&"function"==typeof i.then?i.then(r,n):s(i)?Promise.all(i).then(r,n):r(i)}}return i(t)()}function Tr(e,t,r){for(var n=s(e)?e.slice():[e],i=0;i<r;++i)n.push(t)
return n}var Ir={stack:"dbcore",name:"VirtualIndexMiddleware",level:1,create:e=>t(t({},e),{table:r=>{var n=e.table(r),i=(r=n.schema,{}),s=[]
function a(e,r,n){var o=Xt(e),u=i[o]=i[o]||[],l=null==e?0:"string"==typeof e?1:e.length,c=0<r
return o=t(t({},n),{name:c?"".concat(o,"(virtual-from:").concat(n.name,")"):n.name,lowLevelIndex:n,isVirtual:c,keyTail:r,keyLength:l,extractKey:Ht(e),unique:!c&&n.unique}),u.push(o),o.isPrimaryKey||s.push(o),1<l&&a(2===l?e[0]:e.slice(0,l-1),r+1,n),u.sort((e,t)=>e.keyTail-t.keyTail),o}var o=a(r.primaryKey.keyPath,0,r.primaryKey)
i[":id"]=[o]
for(var u=0,l=r.indexes;u<l.length;u++){var c=l[u]
a(c.keyPath,0,c)}function h(r){var n,i=r.query.index
return i.isVirtual?t(t({},r),{query:{index:i.lowLevelIndex,range:(n=r.query.range,i=i.keyTail,{type:1===n.type?2:n.type,lower:Tr(n.lower,n.lowerOpen?e.MAX_KEY:e.MIN_KEY,i),lowerOpen:!0,upper:Tr(n.upper,n.upperOpen?e.MIN_KEY:e.MAX_KEY,i),upperOpen:!0})}}):r}return t(t({},n),{schema:t(t({},r),{primaryKey:o,indexes:s,getIndexByKeyPath:e=>(e=i[Xt(e)])&&e[0]}),count:e=>n.count(h(e)),query:e=>n.query(h(e)),openCursor:t=>{var r=t.query.index,i=r.keyTail,s=r.keyLength
return r.isVirtual?n.openCursor(h(t)).then(r=>{return r&&(n=r,Object.create(n,{continue:{value:r=>{null!=r?n.continue(Tr(r,t.reverse?e.MAX_KEY:e.MIN_KEY,i)):t.unique?n.continue(n.key.slice(0,s).concat(t.reverse?e.MIN_KEY:e.MAX_KEY,i)):n.continue()}},continuePrimaryKey:{value:(t,r)=>{n.continuePrimaryKey(Tr(t,e.MAX_KEY,i),r)}},primaryKey:{get:()=>n.primaryKey},key:{get:()=>{var e=n.key
return 1===s?e[0]:e.slice(0,s)}},value:{get:()=>n.value}}))
var n}):n.openCursor(t)}})}})}
function Dr(e,t,r,n){return r=r||{},n=n||"",i(e).forEach(i=>{var s,a,o
l(t,i)?(s=e[i],a=t[i],"object"==typeof s&&"object"==typeof a&&s&&a?(o=K(s))!==K(a)?r[n+i]=t[i]:"Object"===o?Dr(s,a,r,n+i+"."):s!==a&&(r[n+i]=t[i]):s!==a&&(r[n+i]=t[i])):r[n+i]=void 0}),i(t).forEach(i=>{l(e,i)||(r[n+i]=t[i])}),r}function Fr(e,t){return"delete"===t.type?t.keys:t.keys||t.values.map(e.extractKey)}var Br={stack:"dbcore",name:"HooksMiddleware",level:2,create:e=>t(t({},e),{table:n=>{var i=e.table(n),s=i.schema.primaryKey
return t(t({},i),{mutate:e=>{var a=ve.trans,o=a.table(n).hook,u=o.deleting,c=o.creating,h=o.updating
switch(e.type){case"add":if(c.fire===z)break
return a._promise("readwrite",()=>d(e),!0)
case"put":if(c.fire===z&&h.fire===z)break
return a._promise("readwrite",()=>d(e),!0)
case"delete":if(u.fire===z)break
return a._promise("readwrite",()=>d(e),!0)
case"deleteRange":if(u.fire===z)break
return a._promise("readwrite",()=>function e(r,n,a){return i.query({trans:r,values:!1,query:{index:s,range:n},limit:a}).then(i=>{var s=i.result
return d({type:"delete",keys:s,trans:r}).then(i=>0<i.numFailures?Promise.reject(i.failures[0]):s.length<a?{failures:[],numFailures:0,lastResult:void 0}:e(r,t(t({},n),{lower:s[s.length-1],lowerOpen:!0}),a))})}(e.trans,e.range,1e4),!0)}return i.mutate(e)
function d(e){var n,a,o,d=ve.trans,f=e.keys||Fr(s,e)
if(f)return"delete"!==(e="add"===e.type||"put"===e.type?t(t({},e),{keys:f}):t({},e)).type&&(e.values=r([],e.values)),e.keys&&(e.keys=r([],e.keys)),n=i,o=f,("add"===(a=e).type?Promise.resolve([]):n.getMany({trans:a.trans,keys:o,cache:"immutable"})).then(t=>{var r=f.map((r,n)=>{var i,a,o,f=t[n],p={onerror:null,onsuccess:null}
return"delete"===e.type?u.fire.call(p,r,f,d):"add"===e.type||void 0===f?(i=c.fire.call(p,r,e.values[n],d),null==r&&null!=i&&(e.keys[n]=r=i,s.outbound||_(e.values[n],s.keyPath,r))):(i=Dr(f,e.values[n]),(a=h.fire.call(p,i,r,f,d))&&(o=e.values[n],Object.keys(a).forEach(e=>{l(o,e)?o[e]=a[e]:_(o,e,a[e])}))),p})
return i.mutate(e).then(n=>{for(var i=n.failures,s=n.results,a=n.numFailures,o=(n=n.lastResult,0);o<f.length;++o){var u=(s||f)[o],l=r[o]
null==u?l.onerror&&l.onerror(i[o]):l.onsuccess&&l.onsuccess("put"===e.type&&t[o]?e.values[o]:u)}return{failures:i,results:s,numFailures:a,lastResult:n}}).catch(e=>(r.forEach(t=>t.onerror&&t.onerror(e)),Promise.reject(e)))})
throw new Error("Keys missing")}}})}})}
function Nr(e,t,r){try{if(!t)return null
if(t.keys.length<e.length)return null
for(var n=[],i=0,s=0;i<t.keys.length&&s<e.length;++i)0===ot(t.keys[i],e[s])&&(n.push(r?C(t.values[i]):t.values[i]),++s)
return n.length===e.length?n:null}catch(a){return null}}var Wr={stack:"dbcore",level:-1,create:e=>({table:r=>{var n=e.table(r)
return t(t({},n),{getMany:e=>{var t
return e.cache?(t=Nr(e.keys,e.trans._cache,"clone"===e.cache))?we.resolve(t):n.getMany(e).then(t=>(e.trans._cache={keys:e.keys,values:"clone"===e.cache?C(t):t},t)):n.getMany(e)},mutate:e=>("add"!==e.type&&(e.trans._cache=null),n.mutate(e))})}})}
function Ur(e,t){return"readonly"===e.trans.mode&&!!e.subscr&&!e.trans.explicit&&"disabled"!==e.trans.db._options.cache&&!t.schema.primaryKey.outbound}function Lr(e,t){switch(e){case"query":return t.values&&!t.unique
case"get":case"getMany":case"count":case"openCursor":return!1}}var Qr={stack:"dbcore",level:0,name:"Observability",create:function(e){var r=e.schema.name,n=new gr(e.MIN_KEY,e.MAX_KEY)
return t(t({},e),{transaction:(t,r,n)=>{if(ve.subscr&&"readonly"!==r)throw new $.ReadOnly("Readwrite transaction in liveQuery context. Querier source: ".concat(ve.querier))
return e.transaction(t,r,n)},table:function(a){function o(t){var r
return[r=(t=t.query).index,new gr(null!=(r=(t=t.range).lower)?r:e.MIN_KEY,null!=(r=t.upper)?r:e.MAX_KEY)]}var u=e.table(a),l=u.schema,c=l.primaryKey,h=l.indexes,d=c.extractKey,f=c.outbound,p=c.autoIncrement&&h.filter(e=>e.compound&&e.keyPath.includes(c.keyPath)),y=t(t({},u),{mutate:t=>{function i(e){return e="idb://".concat(r,"/").concat(a,"/").concat(e),y[e]||(y[e]=new gr)}var o,h,d,f=t.trans,y=t.mutatedParts||(t.mutatedParts={}),v=i(""),m=i(":dels"),b=t.type,g=(w="deleteRange"===t.type?[t.range]:"delete"===t.type?[t.keys]:t.values.length<50?[Fr(c,t).filter(e=>e),t.values]:[])[0],w=w[1],_=t.trans._cache
return s(g)?(v.addKeys(g),(b="delete"===b||g.length===w.length?Nr(g,_):null)||m.addKeys(g),(b||w)&&(o=i,h=b,d=w,l.indexes.forEach(e=>{var t=o(e.name||"")
function r(t){return null!=t?e.extractKey(t):null}function n(r){e.multiEntry&&s(r)?r.forEach(e=>t.addKey(e)):t.addKey(r)}(h||d).forEach((e,t)=>{var i=h&&r(h[t])
0!==ot(i,t=d&&r(d[t]))&&(null!=i&&n(i),null!=t)&&n(t)})}))):g?(w={from:null!=(_=g.lower)?_:e.MIN_KEY,to:null!=(b=g.upper)?b:e.MAX_KEY},m.add(w),v.add(w)):(v.add(n),m.add(n),l.indexes.forEach(e=>i(e.name).add(n))),u.mutate(t).then(e=>(!g||"add"!==t.type&&"put"!==t.type||(v.addKeys(e.results),p&&p.forEach(r=>{for(var n=t.values.map(e=>r.extractKey(e)),s=r.keyPath.findIndex(e=>e===c.keyPath),a=0,o=e.results.length;a<o;++a)n[a][s]=e.results[a]
i(r.name).addKeys(n)})),f.mutatedParts=Sr(f.mutatedParts||{},y),e))}}),v={get:e=>[c,new gr(e.key)],getMany:e=>[c,(new gr).addKeys(e.keys)],count:o,query:o,openCursor:o}
return i(v).forEach(function(e){y[e]=function(i){var s=!!(c=ve.subscr),o=Ur(ve,u)&&Lr(e,i)?i.obsSet={}:c
if(s){var l,c,h=(c=e=>(e="idb://".concat(r,"/").concat(a,"/").concat(e),o[e]||(o[e]=new gr)))(""),p=c(":dels"),y=(s=v[e](i))[0]
if(s=s[1],("query"===e&&y.isPrimaryKey&&!i.values?p:c(y.name||"")).add(s),!y.isPrimaryKey){if("count"!==e)return l="query"===e&&f&&i.values&&u.query(t(t({},i),{values:!1})),u[e].apply(this,arguments).then(t=>{if("query"===e){if(f&&i.values)return l.then(e=>(e=e.result,h.addKeys(e),t))
var r=i.values?t.result.map(d):t.result;(i.values?h:p).addKeys(r)}else{var n,s
if("openCursor"===e)return s=i.values,(n=t)&&Object.create(n,{key:{get:()=>(p.addKey(n.primaryKey),n.key)},primaryKey:{get:()=>{var e=n.primaryKey
return p.addKey(e),e}},value:{get:()=>(s&&h.addKey(n.primaryKey),n.value)}})}return t})
p.add(n)}}return u[e].apply(this,arguments)}}),y}})}}
function $r(e,r,n){var i
return 0===n.numFailures?r:"deleteRange"===r.type||(i=r.keys?r.keys.length:"values"in r&&r.values?r.values.length:1,n.numFailures===i)?null:(i=t({},r),s(i.keys)&&(i.keys=i.keys.filter((e,t)=>!(t in n.failures))),"values"in i&&s(i.values)&&(i.values=i.values.filter((e,t)=>!(t in n.failures))),i)}function Vr(e,t){return r=e,(void 0===(n=t).lower||(n.lowerOpen?0<ot(r,n.lower):0<=ot(r,n.lower)))&&(r=e,void 0===(n=t).upper||(n.upperOpen?ot(r,n.upper)<0:ot(r,n.upper)<=0))
var r,n}function zr(e,t,r,n,i,a){var o,u,l,c,h,d,f
return r&&0!==r.length&&(o=t.query.index,u=o.multiEntry,l=t.query.range,c=n.schema.primaryKey.extractKey,h=o.extractKey,d=(o.lowLevelIndex||o).extractKey,(n=r.reduce((e,r)=>{var n=e,i=[]
if("add"===r.type||"put"===r.type)for(var a=new gr,o=r.values.length-1;0<=o;--o){var d,f=r.values[o],p=c(f)
!a.hasKey(p)&&(d=h(f),u&&s(d)?d.some(e=>Vr(e,l)):Vr(d,l))&&(a.addKey(p),i.push(f))}switch(r.type){case"add":var y=(new gr).addKeys(t.values?e.map(e=>c(e)):e)
n=e.concat(t.values?i.filter(e=>(e=c(e),!y.hasKey(e)&&(y.addKey(e),!0))):i.map(e=>c(e)).filter(e=>!y.hasKey(e)&&(y.addKey(e),!0)))
break
case"put":var v=(new gr).addKeys(r.values.map(e=>c(e)))
n=e.filter(e=>!v.hasKey(t.values?c(e):e)).concat(t.values?i:i.map(e=>c(e)))
break
case"delete":var m=(new gr).addKeys(r.keys)
n=e.filter(e=>!m.hasKey(t.values?c(e):e))
break
case"deleteRange":var b=r.range
n=e.filter(e=>!Vr(c(e),b))}return n},e))!==e)?(f=(e,t)=>ot(d(e),d(t))||ot(c(e),c(t)),n.sort("prev"===t.direction||"prevunique"===t.direction?(e,t)=>f(t,e):f),t.limit&&t.limit<1/0&&(n.length>t.limit?n.length=t.limit:e.length===t.limit&&n.length<t.limit&&(i.dirty=!0)),a?Object.freeze(n):n):e}function Hr(e,t){return 0===ot(e.lower,t.lower)&&0===ot(e.upper,t.upper)&&!!e.lowerOpen==!!t.lowerOpen&&!!e.upperOpen==!!t.upperOpen}var Gr={stack:"dbcore",level:0,name:"Cache",create:e=>{var r=e.schema.name
return t(t({},e),{transaction:(t,n,i)=>{var s,a,o=e.transaction(t,n,i)
return"readwrite"===n&&(i=(s=new AbortController).signal,o.addEventListener("abort",(a=i=>()=>{if(s.abort(),"readwrite"===n){for(var a=new Set,u=0,l=t;u<l.length;u++){var c=l[u],h=Cr["idb://".concat(r,"/").concat(c)]
if(h){var d=e.table(c),f=h.optimisticOps.filter(e=>e.trans===o)
if(o._explicit&&i&&o.mutatedParts)for(var p=0,y=Object.values(h.queries.query);p<y.length;p++)for(var v=0,m=(w=y[p]).slice();v<m.length;v++)Er((_=m[v]).obsSet,o.mutatedParts)&&(M(w,_),_.subscribers.forEach(e=>a.add(e)))
else if(0<f.length){h.optimisticOps=h.optimisticOps.filter(e=>e.trans!==o)
for(var b=0,g=Object.values(h.queries.query);b<g.length;b++)for(var w,_,k,O=0,x=(w=g[b]).slice();O<x.length;O++)null!=(_=x[O]).res&&o.mutatedParts&&(i&&!_.dirty?(k=Object.isFrozen(_.res),k=zr(_.res,_.req,f,d,_,k),_.dirty?(M(w,_),_.subscribers.forEach(e=>a.add(e))):k!==_.res&&(_.res=k,_.promise=we.resolve({result:k}))):(_.dirty&&M(w,_),_.subscribers.forEach(e=>a.add(e))))}}}a.forEach(e=>e())}})(!1),{signal:i}),o.addEventListener("error",a(!1),{signal:i}),o.addEventListener("complete",a(!0),{signal:i})),o},table:n=>{var i=e.table(n),s=i.schema.primaryKey
return t(t({},i),{mutate:e=>{var a,o=ve.trans
return s.outbound||"disabled"===o.db._options.cache||o.explicit||"readwrite"!==o.idbtrans.mode||!(a=Cr["idb://".concat(r,"/").concat(n)])?i.mutate(e):(o=i.mutate(e),"add"!==e.type&&"put"!==e.type||!(50<=e.values.length||Fr(s,e).some(e=>null==e))?(a.optimisticOps.push(e),e.mutatedParts&&Ar(e.mutatedParts),o.then(t=>{0<t.numFailures&&(M(a.optimisticOps,e),(t=$r(0,e,t))&&a.optimisticOps.push(t),e.mutatedParts)&&Ar(e.mutatedParts)}),o.catch(()=>{M(a.optimisticOps,e),e.mutatedParts&&Ar(e.mutatedParts)})):o.then(r=>{var n=$r(0,t(t({},e),{values:e.values.map((e,n)=>{var i
return r.failures[n]?e:(_(i=null!=(i=s.keyPath)&&i.includes(".")?C(e):t({},e),s.keyPath,r.results[n]),i)})}),r)
a.optimisticOps.push(n),queueMicrotask(()=>e.mutatedParts&&Ar(e.mutatedParts))}),o)},query:e=>{var t,s,a,o,u,l,c
return Ur(ve,i)&&Lr("query",e)?(t="immutable"===(null==(a=ve.trans)?void 0:a.db._options.cache),s=(a=ve).requery,a=a.signal,l=((e,t,r,n)=>{var i=Cr["idb://".concat(e,"/").concat(t)]
if(!i)return[]
if(!(e=i.queries[r]))return[null,!1,i,null]
var s=e[(n.query?n.query.index.name:null)||""]
if(!s)return[null,!1,i,null]
switch(r){case"query":var a=null!=(o=n.direction)?o:"next",o=s.find(e=>{var t
return e.req.limit===n.limit&&e.req.values===n.values&&(null!=(t=e.req.direction)?t:"next")===a&&Hr(e.req.query.range,n.query.range)})
return o?[o,!0,i,s]:[s.find(e=>{var t
return("limit"in e.req?e.req.limit:1/0)>=n.limit&&(null!=(t=e.req.direction)?t:"next")===a&&(!n.values||e.req.values)&&((e,t)=>((e,t,r,n)=>{if(void 0===e)return void 0!==t?-1:0
if(void 0===t)return 1
if(0===(e=ot(e,t))){if(r&&n)return 0
if(r)return 1
if(n)return-1}return e})(e.lower,t.lower,e.lowerOpen,t.lowerOpen)<=0&&0<=((e,t,r,n)=>{if(void 0===e)return void 0!==t?1:0
if(void 0===t)return-1
if(0===(e=ot(e,t))){if(r&&n)return 0
if(r)return-1
if(n)return 1}return e})(e.upper,t.upper,e.upperOpen,t.upperOpen))(e.req.query.range,n.query.range)}),!1,i,s]
case"count":return[o=s.find(e=>Hr(e.req.query.range,n.query.range)),!!o,i,s]}})(r,n,"query",e),c=l[0],o=l[2],u=l[3],c&&l[1]?c.obsSet=e.obsSet:(l=i.query(e).then(e=>{var r=e.result
if(c&&(c.res=r),t){for(var n=0,i=r.length;n<i;++n)Object.freeze(r[n])
Object.freeze(r)}else e.result=C(r)
return e}).catch(e=>(u&&c&&M(u,c),Promise.reject(e))),c={obsSet:e.obsSet,promise:l,subscribers:new Set,type:"query",req:e,dirty:!1},u?u.push(c):(u=[c],(o=o||(Cr["idb://".concat(r,"/").concat(n)]={queries:{query:{},count:{}},objs:new Map,optimisticOps:[],unsignaledParts:{}})).queries.query[e.query.index.name||""]=u)),((e,t,r,n)=>{e.subscribers.add(r),n.addEventListener("abort",()=>{var n,i
e.subscribers.delete(r),0===e.subscribers.size&&(n=e,i=t,setTimeout(()=>{0===n.subscribers.size&&M(i,n)},3e3))})})(c,u,s,a),c.promise.then(r=>({result:zr(r.result,e,null==o?void 0:o.optimisticOps,i,c,t)}))):i.query(e)}})}})}}
function Yr(e,t){return new Proxy(e,{get:(e,r,n)=>"db"===r?t:Reflect.get(e,r,n)})}Jr.prototype.version=function(e){if(isNaN(e)||e<.1)throw new $.Type("Given version is not a positive number")
if(e=Math.round(10*e)/10,this.idbdb||this._state.isBeingOpened)throw new $.Schema("Cannot add version when database is open")
this.verno=Math.max(this.verno,e)
var t=this._versions,r=t.filter(t=>t._cfg.version===e)[0]
return r||(r=new this.Version(e),t.push(r),t.sort(tr),r.stores({}),this._state.autoSchema=!1),r},Jr.prototype._whenReady=function(e){var t=this
return this.idbdb&&(this._state.openComplete||ve.letThrough||this._vip)?e():new we((e,r)=>{if(t._state.openComplete)return r(new $.DatabaseClosed(t._state.dbOpenError))
if(!t._state.isBeingOpened){if(!t._state.autoOpen)return void r(new $.DatabaseClosed)
t.open().catch(z)}t._state.dbReadyPromise.then(e,r)}).then(e)},Jr.prototype.use=function(e){var t=e.stack,r=e.create,n=e.level,i=((e=e.name)&&this.unuse({stack:t,name:e}),this._middlewares[t]||(this._middlewares[t]=[]))
return i.push({stack:t,create:r,level:n??10,name:e}),i.sort((e,t)=>e.level-t.level),this},Jr.prototype.unuse=function(e){var t=e.stack,r=e.name,n=e.create
return t&&this._middlewares[t]&&(this._middlewares[t]=this._middlewares[t].filter(e=>n?e.create!==n:!!r&&e.name!==r)),this},Jr.prototype.open=function(){var e=this
return ze(ye,()=>(e=>{var t=e._state,r=e._deps.indexedDB
if(t.isBeingOpened||e.idbdb)return t.dbReadyPromise.then(()=>t.dbOpenError?Ye(t.dbOpenError):e)
t.isBeingOpened=!0,t.dbOpenError=null,t.openComplete=!1
var n=t.openCanceller,s=Math.round(10*e.verno),a=!1
function o(){if(t.openCanceller!==n)throw new $.DatabaseClosed("db.open() was cancelled")}var u,l=t.dbReadyResolve,c=null,h=!1
return we.race([n,("undefined"==typeof navigator?we.resolve():!navigator.userAgentData&&/Safari\//.test(navigator.userAgent)&&!/Chrom(e|ium)\//.test(navigator.userAgent)&&indexedDB.databases?new Promise(e=>{function t(){return indexedDB.databases().finally(e)}u=setInterval(t,100),t()}).finally(()=>clearInterval(u)):Promise.resolve()).then(function n(){return new we((u,l)=>{if(o(),!r)throw new $.MissingAPI
var d=e.name,f=t.autoSchema||!s?r.open(d):r.open(d,s)
if(!f)throw new $.MissingAPI
f.onerror=Dt(l),f.onblocked=je(e._fireOnBlocked),f.onupgradeneeded=je(n=>{var s
c=f.transaction,t.autoSchema&&!e._options.allowEmptyDB?(f.onerror=Ft,c.abort(),f.result.close(),(s=r.deleteDatabase(d)).onsuccess=s.onerror=je(()=>{l(new $.NoSuchDatabase("Database ".concat(d," doesnt exist")))})):(c.onerror=Dt(l),s=n.oldVersion>Math.pow(2,62)?0:n.oldVersion,h=s<1,e.idbdb=f.result,a&&((e,t)=>{ir(e._dbSchema,t),t.db.version%10!=0||t.objectStoreNames.contains("$meta")||t.db.createObjectStore("$meta").add(Math.ceil(t.db.version/10-1),"version")
var r=ar(0,e.idbdb,t)
or(e,e._dbSchema,t)
for(var n=0,i=rr(r,e._dbSchema).change;n<i.length;n++){var s=(e=>{if(e.change.length||e.recreate)return{value:void 0}
var r=t.objectStore(e.name)
e.add.forEach(e=>{sr(r,e)})})(i[n])
if("object"==typeof s)return s.value}})(e,c),((e,t,r,n)=>{var s=e._dbSchema,a=(r.objectStoreNames.contains("$meta")&&!s.$meta&&(s.$meta=Vt("$meta",ur("")[0],[]),e._storeNames.push("$meta")),e._createTransaction("readwrite",e._storeNames,s)),o=(a.create(r),a._completion.catch(n),a._reject.bind(a)),u=ve.transless||ve
Ne(()=>{if(ve.trans=a,ve.transless=u,0!==t)return Jt(e,r),l=t,((n=a).storeNames.includes("$meta")?n.table("$meta").get("version").then(e=>null!=e?e:l):we.resolve(l)).then(t=>{var n=e,s=t,o=a,u=r,l=[],c=(t=n._versions,n._dbSchema=ar(0,n.idbdb,u))
return 0===(t=t.filter(e=>e._cfg.version>=s)).length?we.resolve():(t.forEach(e=>{l.push(()=>{var t,r,a,l=c,h=e._cfg.dbschema,d=(or(n,l,u),or(n,h,u),c=n._dbSchema=h,rr(l,h)),f=(d.add.forEach(e=>{nr(u,e[0],e[1].primKey,e[1].indexes)}),d.change.forEach(e=>{if(e.recreate)throw new $.Upgrade("Not yet support for changing primary key")
var t=u.objectStore(e.name)
e.add.forEach(e=>sr(t,e)),e.change.forEach(e=>{t.deleteIndex(e.name),sr(t,e)}),e.del.forEach(e=>t.deleteIndex(e))}),e._cfg.contentUpgrade)
if(f&&e._cfg.version>s)return Jt(n,u),o._memoizedTables={},t=k(h),d.del.forEach(e=>{t[e]=l[e]}),er(n,[n.Transaction.prototype]),Zt(n,[n.Transaction.prototype],i(t),t),o.schema=t,(r=I(f))&&We(),h=we.follow(()=>{var e;(a=f(o))&&r&&(e=Ue.bind(null,null),a.then(e,e))}),a&&"function"==typeof a.then?we.resolve(a):h.then(()=>a)}),l.push(t=>{var r,i,s=e._cfg.dbschema
r=s,i=t,[].slice.call(i.db.objectStoreNames).forEach(e=>null==r[e]&&i.db.deleteObjectStore(e)),er(n,[n.Transaction.prototype]),Zt(n,[n.Transaction.prototype],n._storeNames,n._dbSchema),o.schema=n._dbSchema}),l.push(t=>{n.idbdb.objectStoreNames.contains("$meta")&&(Math.ceil(n.idbdb.version/10)===e._cfg.version?(n.idbdb.deleteObjectStore("$meta"),delete n._dbSchema.$meta,n._storeNames=n._storeNames.filter(e=>"$meta"!==e)):t.objectStore("$meta").put(e._cfg.version,"version"))})}),function e(){return l.length?we.resolve(l.shift()(o.idbtrans)).then(e):we.resolve()}().then(()=>{ir(c,u)}))}).catch(o)
var n,l
i(s).forEach(e=>{nr(r,e,s[e].primKey,s[e].indexes)}),Jt(e,r),we.follow(()=>e.on.populate.fire(a)).catch(o)})})(e,s/10,c,l))},l),f.onsuccess=je(()=>{c=null
var r,o,l,p,y,m,b=e.idbdb=f.result,g=v(b.objectStoreNames)
if(0<g.length)try{var w=b.transaction(1===(y=g).length?y[0]:y,"readonly")
if(t.autoSchema)m=b,p=w,(l=e).verno=m.version/10,p=l._dbSchema=ar(0,m,p),l._storeNames=v(m.objectStoreNames,0),Zt(l,[l._allTables],i(p),p)
else if(or(e,e._dbSchema,w),o=w,((o=rr(ar(0,(r=e).idbdb,o),r._dbSchema)).add.length||o.change.some(e=>e.add.length||e.change.length))&&!a)return b.close(),s=b.version+1,a=!0,u(n())
Jt(e,w)}catch(_){}pr.add(e),b.onversionchange=je(r=>{t.vcFired=!0,e.on("versionchange").fire(r)}),b.onclose=je(()=>{e.close({disableAutoOpen:!1})}),h&&(g=e._deps,y=d,vr(m=g.indexedDB)||y===et||yr(m,g.IDBKeyRange).put({name:y}).catch(z)),u()},l)}).catch(e=>{switch(null==e?void 0:e.name){case"UnknownError":if(0<t.PR1398_maxLoop)return t.PR1398_maxLoop--,n()
break
case"VersionError":if(0<s)return s=0,n()}return we.reject(e)})})]).then(()=>(o(),t.onReadyBeingFired=[],we.resolve(mr(()=>e.on.ready.fire(e.vip))).then(function r(){var n
if(0<t.onReadyBeingFired.length)return n=t.onReadyBeingFired.reduce(te,z),t.onReadyBeingFired=[],we.resolve(mr(()=>n(e.vip))).then(r)}))).finally(()=>{t.openCanceller===n&&(t.onReadyBeingFired=null,t.isBeingOpened=!1)}).catch(r=>{t.dbOpenError=r
try{c&&c.abort()}catch(i){}return n===t.openCanceller&&e._close(),Ye(r)}).finally(()=>{t.openComplete=!0,l()}).then(()=>{var t
return h&&(t={},e.tables.forEach(r=>{r.schema.indexes.forEach(n=>{n.name&&(t["idb://".concat(e.name,"/").concat(r.name,"/").concat(n.name)]=new gr(-1/0,[[[]]]))}),t["idb://".concat(e.name,"/").concat(r.name,"/")]=t["idb://".concat(e.name,"/").concat(r.name,"/:dels")]=new gr(-1/0,[[[]]])}),Wt(Bt).fire(t),jr(t,!0)),e})})(e))},Jr.prototype._close=function(){this.on.close.fire(new CustomEvent("close"))
var e=this._state
if(pr.remove(this),this.idbdb){try{this.idbdb.close()}catch(t){}this.idbdb=null}e.isBeingOpened||(e.dbReadyPromise=new we(t=>{e.dbReadyResolve=t}),e.openCanceller=new we((t,r)=>{e.cancelOpen=r}))},Jr.prototype.close=function(e){e=(void 0===e?{disableAutoOpen:!0}:e).disableAutoOpen
var t=this._state
e?(t.isBeingOpened&&t.cancelOpen(new $.DatabaseClosed),this._close(),t.autoOpen=!1,t.dbOpenError=new $.DatabaseClosed):(this._close(),t.autoOpen=this._options.autoOpen||t.isBeingOpened,t.openComplete=!1,t.dbOpenError=null)},Jr.prototype.delete=function(e){var t=this,r=(void 0===e&&(e={disableAutoOpen:!0}),0<arguments.length&&"object"!=typeof arguments[0]),n=this._state
return new we((i,s)=>{function a(){t.close(e)
var r=t._deps.indexedDB.deleteDatabase(t.name)
r.onsuccess=je(()=>{var e,r,n
e=t._deps,r=t.name,vr(n=e.indexedDB)||r===et||yr(n,e.IDBKeyRange).delete(r).catch(z),i()}),r.onerror=Dt(s),r.onblocked=t._fireOnBlocked}if(r)throw new $.InvalidArgument("Invalid closeOptions argument to db.delete()")
n.isBeingOpened?n.dbReadyPromise.then(a):a()})},Jr.prototype.backendDB=function(){return this.idbdb},Jr.prototype.isOpen=function(){return null!==this.idbdb},Jr.prototype.hasBeenClosed=function(){var e=this._state.dbOpenError
return e&&"DatabaseClosed"===e.name},Jr.prototype.hasFailed=function(){return null!==this._state.dbOpenError},Jr.prototype.dynamicallyOpened=function(){return this._state.autoSchema},Object.defineProperty(Jr.prototype,"tables",{get:function(){var e=this
return i(this._allTables).map(t=>e._allTables[t])},enumerable:!1,configurable:!0}),Jr.prototype.transaction=function(){var e=function(e,t,r){var n=arguments.length
if(n<2)throw new $.InvalidArgument("Too few arguments")
for(var i=new Array(n-1);--n;)i[n-1]=arguments[n]
return r=i.pop(),[e,x(i),r]}.apply(this,arguments)
return this._transaction.apply(this,e)},Jr.prototype._transaction=function(e,t,r){var n,i,s=this,a=ve.trans,o=(a&&a.db===this&&-1===e.indexOf("!")||(a=null),-1!==e.indexOf("?"))
e=e.replace("!","").replace("?","")
try{if(i=t.map(e=>{if("string"!=typeof(e=e instanceof s.Table?e.name:e))throw new TypeError("Invalid table argument to Dexie.transaction(). Only Table or String are allowed")
return e}),"r"==e||e===tt)n=tt
else{if("rw"!=e&&e!=rt)throw new $.InvalidArgument("Invalid transaction mode: "+e)
n=rt}if(a){if(a.mode===tt&&n===rt){if(!o)throw new $.SubTransaction("Cannot enter a sub-transaction with READWRITE mode when parent transaction is READONLY")
a=null}a&&i.forEach(e=>{if(a&&-1===a.storeNames.indexOf(e)){if(!o)throw new $.SubTransaction("Table "+e+" not included in parent transaction.")
a=null}}),o&&a&&!a.active&&(a=null)}}catch(l){return a?a._promise(null,(e,t)=>{t(l)}):Ye(l)}var u=function e(t,r,n,i,s){return we.resolve().then(()=>{var a=ve.transless||ve,o=t._createTransaction(r,n,t._dbSchema,i)
if(o.explicit=!0,a={trans:o,transless:a},i)o.idbtrans=i.idbtrans
else try{o.create(),o.idbtrans._explicit=!0,t._state.PR1398_maxLoop=3}catch(c){return c.name===L.InvalidState&&t.isOpen()&&0<--t._state.PR1398_maxLoop?(t.close({disableAutoOpen:!1}),t.open().then(()=>e(t,r,n,null,s))):Ye(c)}var u,l=I(s)
return l&&We(),a=we.follow(()=>{var e;(u=s.call(o,o))&&(l?(e=Ue.bind(null,null),u.then(e,e)):"function"==typeof u.next&&"function"==typeof u.throw&&(u=qr(u)))},a),(u&&"function"==typeof u.then?we.resolve(u).then(e=>o.active?e:Ye(new $.PrematureCommit("Transaction committed too early. See http://bit.ly/2kdckMn"))):a.then(()=>u)).then(e=>(i&&o._resolve(),o._completion.then(()=>e))).catch(e=>(o._reject(e),Ye(e)))})}.bind(null,this,n,i,a,r)
return a?a._promise(n,u,"lock"):ve.trans?ze(ve.transless,()=>s._whenReady(u)):this._whenReady(u)},Jr.prototype.table=function(e){if(l(this._allTables,e))return this._allTables[e]
throw new $.InvalidTable("Table ".concat(e," does not exist"))}
var Xr=Jr
function Jr(e,r){var n,i,s,a,o,u=this,l=(this._middlewares={},this.verno=0,Jr.dependencies),c=(this._options=r=t({addons:Jr.addons,autoOpen:!0,indexedDB:l.indexedDB,IDBKeyRange:l.IDBKeyRange,cache:"cloned",maxConnections:1e3},r),this._deps={indexedDB:r.indexedDB,IDBKeyRange:r.IDBKeyRange},l=r.addons,this._dbSchema={},this._versions=[],this._storeNames=[],this._allTables={},this.idbdb=null,this._novip=this,{dbOpenError:null,isBeingOpened:!1,onReadyBeingFired:null,openComplete:!1,dbReadyResolve:z,dbReadyPromise:null,cancelOpen:z,openCanceller:null,autoSchema:!0,PR1398_maxLoop:3,autoOpen:r.autoOpen}),h=(c.dbReadyPromise=new we(e=>{c.dbReadyResolve=e}),c.openCanceller=new we((e,t)=>{c.cancelOpen=t}),this._state=c,this.name=e,this.on=vt(this,"populate","blocked","versionchange","close",{ready:[te,z]}),this.once=(e,t)=>{var r=function(){for(var n=[],i=0;i<arguments.length;i++)n[i]=arguments[i]
u.on(e).unsubscribe(r),t.apply(u,n)}
return u.on(e,r)},this.on.ready.subscribe=m(this.on.ready.subscribe,e=>(t,r)=>{Jr.vip(()=>{var n,i=u._state
i.openComplete?(i.dbOpenError||we.resolve().then(t),r&&e(t)):i.onReadyBeingFired?(i.onReadyBeingFired.push(t),r&&e(t)):(e(t),n=u,r||e(function e(){n.on.ready.unsubscribe(t),n.on.ready.unsubscribe(e)}))})}),this.Collection=(n=this,mt(Pt.prototype,function(e,t){this.db=n
var r=it,i=null
if(t)try{r=t()}catch(a){i=a}var s=(e=(t=e._ctx).table).hook.reading.fire
this._ctx={table:e,index:t.index,isPrimKey:!t.index||e.schema.primKey.keyPath&&t.index===e.schema.primKey.name,range:r,keysOnly:!1,dir:"next",unique:"",algorithm:null,filter:null,replayFilter:null,justLimit:!0,isMatch:null,offset:0,limit:1/0,error:i,or:t.or,valueMapper:s!==H?s:null}})),this.Table=(i=this,mt(pt.prototype,function(e,t,r){this.db=i,this._tx=r,this.name=e,this.schema=t,this.hook=i._allTables[e]?i._allTables[e].hook:vt(null,{creating:[X,z],reading:[G,H],updating:[Z,z],deleting:[J,z]})})),this.Transaction=(s=this,mt(Ut.prototype,function(e,t,r,n,i){var a=this
"readonly"!==e&&t.forEach(e=>{(e=null==(e=r[e])?void 0:e.yProps)&&(t=t.concat(e.map(e=>e.updatesTable)))}),this.db=s,this.mode=e,this.storeNames=t,this.schema=r,this.chromeTransactionDurability=n,this.idbtrans=null,this.on=vt(this,"complete","error","abort"),this.parent=i||null,this.active=!0,this._reculock=0,this._blockedFuncs=[],this._resolve=null,this._reject=null,this._waitingFor=null,this._waitingQueue=null,this._spinCount=0,this._completion=new we((e,t)=>{a._resolve=e,a._reject=t}),this._completion.then(()=>{a.active=!1,a.on.complete.fire()},e=>{var t=a.active
return a.active=!1,a.on.error.fire(e),a.parent?a.parent._reject(e):t&&a.idbtrans&&a.idbtrans.abort(),Ye(e)})})),this.Version=(a=this,mt(lr.prototype,function(e){this.db=a,this._cfg={version:e,storesSource:null,dbschema:{},tables:{},contentUpgrade:null}})),this.WhereClause=(o=this,mt(Tt.prototype,function(e,t,r){if(this.db=o,this._ctx={table:e,index:":id"===t?null:t,or:r},this._cmp=this._ascending=ot,this._descending=(e,t)=>ot(t,e),this._max=(e,t)=>0<ot(e,t)?e:t,this._min=(e,t)=>ot(e,t)<0?e:t,this._IDBKeyRange=o._deps.IDBKeyRange,!this._IDBKeyRange)throw new $.MissingAPI})),this.on("versionchange",e=>{e.newVersion,u.close({disableAutoOpen:!1})}),this.on("blocked",e=>{!e.newVersion||(e.newVersion,e.oldVersion)}),this._maxKey=zt(r.IDBKeyRange),this._createTransaction=(e,t,r,n)=>new u.Transaction(e,t,r,u._options.chromeTransactionDurability,n),this._fireOnBlocked=e=>{u.on("blocked").fire(e),pr.toArray().filter(e=>e.name===u.name&&e!==u&&!e._state.vcFired).map(t=>t.on("versionchange").fire(e))},this.use(Wr),this.use(Gr),this.use(Qr),this.use(Ir),this.use(Br),new Proxy(this,{get:function(e,t,r){var n
return"_vip"===t||("table"===t?e=>Yr(u.table(e),h):(n=Reflect.get(e,t,r))instanceof pt?Yr(n,h):"tables"===t?n.map(e=>Yr(e,h)):"_createTransaction"===t?function(){return Yr(n.apply(this,arguments),h)}:n)}}))
this.vip=h,l.forEach(e=>e(u))}ae="undefined"!=typeof Symbol&&"observable"in Symbol?Symbol.observable:"@@observable"
var Zr,en=(tn.prototype.subscribe=function(e,t,r){return this._subscribe(e&&"function"!=typeof e?e:{next:e,error:t,complete:r})},tn.prototype[ae]=function(){return this},tn)
function tn(e){this._subscribe=e}try{Zr={indexedDB:n.indexedDB||n.mozIndexedDB||n.webkitIndexedDB||n.msIndexedDB,IDBKeyRange:n.IDBKeyRange||n.webkitIDBKeyRange}}catch(ln){Zr={indexedDB:null,IDBKeyRange:null}}function rn(e){var t,r=!1,n=new en(n=>{var i,s=I(e),a=!1,o={},u={},l={get closed(){return a},unsubscribe:()=>{a||(a=!0,i&&i.abort(),c&&Wt.storagemutated.unsubscribe(f))}},c=(n.start&&n.start(l),!1),h=()=>Ge(p)
function d(){return Er(u,o)}var f=e=>{Sr(o,e),d()&&h()},p=()=>{var l,p,y
!a&&Zr.indexedDB&&(o={},l={},i&&i.abort(),i=new AbortController,y=(t=>{var r=Ce()
try{s&&We()
var n=Ne(e,t)
return n=s?n.finally(Ue):n}finally{r&&Re()}})(p={subscr:l,signal:i.signal,requery:h,querier:e,trans:null}),c||(Wt.storagemutated.subscribe(f),c=!0),Promise.resolve(y).then(e=>{r=!0,t=e,a||p.signal.aborted||(d()||(u=l,d())?h():(o={},Ge(()=>!a&&n.next&&n.next(e))))},e=>{r=!1,["DatabaseClosedError","AbortError"].includes(null==e?void 0:e.name)||a||Ge(()=>{a||n.error&&n.error(e)})}))}
return setTimeout(h,0),l})
return n.hasValue=()=>r,n.getValue=()=>t,n}var nn=Xr
function sn(e){var t=on
try{on=!0,Wt.storagemutated.fire(e),jr(e,!0)}finally{on=t}}c(nn,t(t({},P),{delete:e=>new nn(e,{addons:[]}).delete(),exists:e=>new nn(e,{addons:[]}).open().then(e=>(e.close(),!0)).catch("NoSuchDatabaseError",()=>!1),getDatabaseNames:e=>{try{return r=(t=nn.dependencies).indexedDB,t=t.IDBKeyRange,(vr(r)?Promise.resolve(r.databases()).then(e=>e.map(e=>e.name).filter(e=>e!==et)):yr(r,t).toCollection().primaryKeys()).then(e)}catch(n){return Ye(new $.MissingAPI)}var t,r},defineClass:function(){return function(e){a(this,e)}},ignoreTransaction:e=>ve.trans?ze(ve.transless||ye,e):e(),vip:mr,async:function(e){return function(){try{var t=qr(e.apply(this,arguments))
return t&&"function"==typeof t.then?t:we.resolve(t)}catch(r){return Ye(r)}}},spawn:(e,t,r)=>{try{var n=qr(e.apply(r,t||[]))
return n&&"function"==typeof n.then?n:we.resolve(n)}catch(i){return Ye(i)}},currentTransaction:{get:()=>ve.trans||null},waitFor:(e,t)=>(e=we.resolve("function"==typeof e?nn.ignoreTransaction(e):e).timeout(t||6e4),ve.trans?ve.trans.waitFor(e):e),Promise:we,debug:{get:()=>re,set:e=>{ne(e)}},derive:f,extend:a,props:c,override:m,Events:vt,on:Wt,liveQuery:rn,extendObservabilitySet:Sr,getByKeyPath:w,setByKeyPath:_,delByKeyPath:(e,t)=>{"string"==typeof t?_(e,t,void 0):"length"in t&&[].map.call(t,t=>{_(e,t,void 0)})},shallowClone:k,deepClone:C,getObjectDiff:Dr,cmp:ot,asap:g,minKey:-1/0,addons:[],connections:{get:pr.toArray},errnames:L,dependencies:Zr,cache:Cr,semVer:"4.4.3",version:"4.4.3".split(".").map(e=>parseInt(e)).reduce((e,t,r)=>e+t/Math.pow(10,2*r))})),nn.maxKey=zt(nn.dependencies.IDBKeyRange),"undefined"!=typeof dispatchEvent&&"undefined"!=typeof addEventListener&&(Wt(Bt,e=>{on||(e=new CustomEvent(Nt,{detail:e}),on=!0,dispatchEvent(e),on=!1)}),addEventListener(Nt,e=>{e=e.detail,on||sn(e)}))
var an,on=!1,un=()=>{}
return"undefined"!=typeof BroadcastChannel&&((un=()=>{(an=new BroadcastChannel(Nt)).onmessage=e=>e.data&&sn(e.data)})(),"function"==typeof an.unref&&an.unref(),Wt(Bt,e=>{on||an.postMessage(e)})),"undefined"!=typeof addEventListener&&(addEventListener("pagehide",e=>{if(!Xr.disableBfCache&&e.persisted){null!=an&&an.close()
for(var t=0,r=pr.toArray();t<r.length;t++)r[t].close({disableAutoOpen:!1})}}),addEventListener("pageshow",e=>{!Xr.disableBfCache&&e.persisted&&(un(),sn({all:new gr(-1/0,[[]])}))})),we.rejectionMapper=function(e,t){return!e||e instanceof B||e instanceof TypeError||e instanceof SyntaxError||!e.name||!V[e.name]?e:(t=new V[e.name](t||e.message,e),"stack"in e&&d(t,"stack",{get:function(){return this.inner.stack}}),t)},ne(re),t(Xr,Object.freeze({__proto__:null,DEFAULT_MAX_CONNECTIONS:1e3,Dexie:Xr,Entity:at,PropModification:ht,RangeSet:gr,add:e=>new ht({add:e}),cmp:ot,default:Xr,liveQuery:rn,mergeRanges:_r,rangesOverlap:kr,remove:e=>new ht({remove:e}),replacePrefix:(e,t)=>new ht({replacePrefix:[e,t]})}),{default:Xr}),Xr}()),hr.exports)),fr=Symbol.for("Dexie"),pr=globalThis[fr]||(globalThis[fr]=dr)
if(dr.semVer!==pr.semVer)throw new Error(`Two different versions of Dexie loaded in the same app: ${dr.semVer} and ${pr.semVer}`)
const{liveQuery:yr,mergeRanges:vr,rangesOverlap:mr,RangeSet:br,cmp:gr,Entity:wr,PropModification:_r,replacePrefix:kr,add:Or,remove:xr,DexieYProvider:Pr}=pr
export{pr as D,Yt as Q,Zt as R,Xt as a,rr as b,or as c,ur as d,lr as e,Jt as f,Te as g,Ie as h,ze as j,Ve as r,tr as u}
