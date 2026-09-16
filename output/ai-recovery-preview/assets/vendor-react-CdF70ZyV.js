import{r as e,a as n,R as t}from"./vendor-data-BaHBZjtO.js"
var r,l,a,o,u={exports:{}},i={},s={exports:{}},c={}
function f(){if(a)return i
a=1
var n=e(),t=(l||(l=1,s.exports=(r||(r=1,function(e){function n(e,n){var t=e.length
e.push(n)
e:for(;0<t;){var r=t-1>>>1,a=e[r]
if(!(0<l(a,n)))break e
e[r]=n,e[t]=a,t=r}}function t(e){return 0===e.length?null:e[0]}function r(e){if(0===e.length)return null
var n=e[0],t=e.pop()
if(t!==n){e[0]=t
e:for(var r=0,a=e.length,o=a>>>1;r<o;){var u=2*(r+1)-1,i=e[u],s=u+1,c=e[s]
if(0>l(i,t))s<a&&0>l(c,i)?(e[r]=c,e[s]=t,r=s):(e[r]=i,e[u]=t,r=u)
else{if(!(s<a&&0>l(c,t)))break e
e[r]=c,e[s]=t,r=s}}}return n}function l(e,n){var t=e.sortIndex-n.sortIndex
return 0!==t?t:e.id-n.id}if("object"==typeof performance&&"function"==typeof performance.now){var a=performance
e.unstable_now=()=>a.now()}else{var o=Date,u=o.now()
e.unstable_now=()=>o.now()-u}var i=[],s=[],c=1,f=null,d=3,p=!1,h=!1,m=!1,g="function"==typeof setTimeout?setTimeout:null,v="function"==typeof clearTimeout?clearTimeout:null,y="undefined"!=typeof setImmediate?setImmediate:null
function b(e){for(var l=t(s);null!==l;){if(null===l.callback)r(s)
else{if(!(l.startTime<=e))break
r(s),l.sortIndex=l.expirationTime,n(i,l)}l=t(s)}}function k(e){if(m=!1,b(e),!h)if(null!==t(i))h=!0,M(w)
else{var n=t(s)
null!==n&&F(k,n.startTime-e)}}function w(n,l){h=!1,m&&(m=!1,v(C),C=-1),p=!0
var a=d
try{for(b(l),f=t(i);null!==f&&(!(f.expirationTime>l)||n&&!P());){var o=f.callback
if("function"==typeof o){f.callback=null,d=f.priorityLevel
var u=o(f.expirationTime<=l)
l=e.unstable_now(),"function"==typeof u?f.callback=u:f===t(i)&&r(i),b(l)}else r(i)
f=t(i)}if(null!==f)var c=!0
else{var g=t(s)
null!==g&&F(k,g.startTime-l),c=!1}return c}finally{f=null,d=a,p=!1}}"undefined"!=typeof navigator&&void 0!==navigator.scheduling&&void 0!==navigator.scheduling.isInputPending&&navigator.scheduling.isInputPending.bind(navigator.scheduling)
var S,x=!1,E=null,C=-1,_=5,N=-1
function P(){return!(e.unstable_now()-N<_)}function z(){if(null!==E){var n=e.unstable_now()
N=n
var t=!0
try{t=E(!0,n)}finally{t?S():(x=!1,E=null)}}else x=!1}if("function"==typeof y)S=()=>{y(z)}
else if("undefined"!=typeof MessageChannel){var L=new MessageChannel,T=L.port2
L.port1.onmessage=z,S=()=>{T.postMessage(null)}}else S=()=>{g(z,0)}
function M(e){E=e,x||(x=!0,S())}function F(n,t){C=g(()=>{n(e.unstable_now())},t)}e.unstable_IdlePriority=5,e.unstable_ImmediatePriority=1,e.unstable_LowPriority=4,e.unstable_NormalPriority=3,e.unstable_Profiling=null,e.unstable_UserBlockingPriority=2,e.unstable_cancelCallback=e=>{e.callback=null},e.unstable_continueExecution=()=>{h||p||(h=!0,M(w))},e.unstable_forceFrameRate=e=>{0>e||125<e||(_=0<e?Math.floor(1e3/e):5)},e.unstable_getCurrentPriorityLevel=()=>d,e.unstable_getFirstCallbackNode=()=>t(i),e.unstable_next=e=>{switch(d){case 1:case 2:case 3:var n=3
break
default:n=d}var t=d
d=n
try{return e()}finally{d=t}},e.unstable_pauseExecution=()=>{},e.unstable_requestPaint=()=>{},e.unstable_runWithPriority=(e,n)=>{switch(e){case 1:case 2:case 3:case 4:case 5:break
default:e=3}var t=d
d=e
try{return n()}finally{d=t}},e.unstable_scheduleCallback=(r,l,a)=>{var o=e.unstable_now()
switch(a="object"==typeof a&&null!==a&&"number"==typeof(a=a.delay)&&0<a?o+a:o,r){case 1:var u=-1
break
case 2:u=250
break
case 5:u=1073741823
break
case 4:u=1e4
break
default:u=5e3}return r={id:c++,callback:l,priorityLevel:r,startTime:a,expirationTime:u=a+u,sortIndex:-1},a>o?(r.sortIndex=a,n(s,r),null===t(i)&&r===t(s)&&(m?(v(C),C=-1):m=!0,F(k,a-o))):(r.sortIndex=u,n(i,r),h||p||(h=!0,M(w))),r},e.unstable_shouldYield=P,e.unstable_wrapCallback=function(e){var n=d
return function(){var t=d
d=n
try{return e.apply(this,arguments)}finally{d=t}}}}(c)),c)),s.exports)
function o(e){for(var n="https://reactjs.org/docs/error-decoder.html?invariant="+e,t=1;t<arguments.length;t++)n+="&args[]="+encodeURIComponent(arguments[t])
return"Minified React error #"+e+"; visit "+n+" for the full message or use the non-minified dev environment for full errors and additional helpful warnings."}var u=new Set,f={}
function d(e,n){p(e,n),p(e+"Capture",n)}function p(e,n){for(f[e]=n,e=0;e<n.length;e++)u.add(n[e])}var h=!("undefined"==typeof window||void 0===window.document||void 0===window.document.createElement),m=Object.prototype.hasOwnProperty,g=/^[:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD][:A-Z_a-z\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD\-.0-9\u00B7\u0300-\u036F\u203F-\u2040]*$/,v={},y={}
function b(e,n,t,r,l,a,o){this.acceptsBooleans=2===n||3===n||4===n,this.attributeName=r,this.attributeNamespace=l,this.mustUseProperty=t,this.propertyName=e,this.type=n,this.sanitizeURL=a,this.removeEmptyString=o}var k={}
"children dangerouslySetInnerHTML defaultValue defaultChecked innerHTML suppressContentEditableWarning suppressHydrationWarning style".split(" ").forEach(e=>{k[e]=new b(e,0,!1,e,null,!1,!1)}),[["acceptCharset","accept-charset"],["className","class"],["htmlFor","for"],["httpEquiv","http-equiv"]].forEach(e=>{var n=e[0]
k[n]=new b(n,1,!1,e[1],null,!1,!1)}),["contentEditable","draggable","spellCheck","value"].forEach(e=>{k[e]=new b(e,2,!1,e.toLowerCase(),null,!1,!1)}),["autoReverse","externalResourcesRequired","focusable","preserveAlpha"].forEach(e=>{k[e]=new b(e,2,!1,e,null,!1,!1)}),"allowFullScreen async autoFocus autoPlay controls default defer disabled disablePictureInPicture disableRemotePlayback formNoValidate hidden loop noModule noValidate open playsInline readOnly required reversed scoped seamless itemScope".split(" ").forEach(e=>{k[e]=new b(e,3,!1,e.toLowerCase(),null,!1,!1)}),["checked","multiple","muted","selected"].forEach(e=>{k[e]=new b(e,3,!0,e,null,!1,!1)}),["capture","download"].forEach(e=>{k[e]=new b(e,4,!1,e,null,!1,!1)}),["cols","rows","size","span"].forEach(e=>{k[e]=new b(e,6,!1,e,null,!1,!1)}),["rowSpan","start"].forEach(e=>{k[e]=new b(e,5,!1,e.toLowerCase(),null,!1,!1)})
var w=/[\-:]([a-z])/g
function S(e){return e[1].toUpperCase()}function x(e,n,t,r){var l=k.hasOwnProperty(n)?k[n]:null;(null!==l?0!==l.type:r||!(2<n.length)||"o"!==n[0]&&"O"!==n[0]||"n"!==n[1]&&"N"!==n[1])&&(((e,n,t,r)=>{if(null==n||((e,n,t,r)=>{if(null!==t&&0===t.type)return!1
switch(typeof n){case"function":case"symbol":return!0
case"boolean":return!r&&(null!==t?!t.acceptsBooleans:"data-"!==(e=e.toLowerCase().slice(0,5))&&"aria-"!==e)
default:return!1}})(e,n,t,r))return!0
if(r)return!1
if(null!==t)switch(t.type){case 3:return!n
case 4:return!1===n
case 5:return isNaN(n)
case 6:return isNaN(n)||1>n}return!1})(n,t,l,r)&&(t=null),r||null===l?(e=>!!m.call(y,e)||!m.call(v,e)&&(g.test(e)?y[e]=!0:(v[e]=!0,!1)))(n)&&(null===t?e.removeAttribute(n):e.setAttribute(n,""+t)):l.mustUseProperty?e[l.propertyName]=null===t?3!==l.type&&"":t:(n=l.attributeName,r=l.attributeNamespace,null===t?e.removeAttribute(n):(t=3===(l=l.type)||4===l&&!0===t?"":""+t,r?e.setAttributeNS(r,n,t):e.setAttribute(n,t))))}"accent-height alignment-baseline arabic-form baseline-shift cap-height clip-path clip-rule color-interpolation color-interpolation-filters color-profile color-rendering dominant-baseline enable-background fill-opacity fill-rule flood-color flood-opacity font-family font-size font-size-adjust font-stretch font-style font-variant font-weight glyph-name glyph-orientation-horizontal glyph-orientation-vertical horiz-adv-x horiz-origin-x image-rendering letter-spacing lighting-color marker-end marker-mid marker-start overline-position overline-thickness paint-order panose-1 pointer-events rendering-intent shape-rendering stop-color stop-opacity strikethrough-position strikethrough-thickness stroke-dasharray stroke-dashoffset stroke-linecap stroke-linejoin stroke-miterlimit stroke-opacity stroke-width text-anchor text-decoration text-rendering underline-position underline-thickness unicode-bidi unicode-range units-per-em v-alphabetic v-hanging v-ideographic v-mathematical vector-effect vert-adv-y vert-origin-x vert-origin-y word-spacing writing-mode xmlns:xlink x-height".split(" ").forEach(e=>{var n=e.replace(w,S)
k[n]=new b(n,1,!1,e,null,!1,!1)}),"xlink:actuate xlink:arcrole xlink:role xlink:show xlink:title xlink:type".split(" ").forEach(e=>{var n=e.replace(w,S)
k[n]=new b(n,1,!1,e,"http://www.w3.org/1999/xlink",!1,!1)}),["xml:base","xml:lang","xml:space"].forEach(e=>{var n=e.replace(w,S)
k[n]=new b(n,1,!1,e,"http://www.w3.org/XML/1998/namespace",!1,!1)}),["tabIndex","crossOrigin"].forEach(e=>{k[e]=new b(e,1,!1,e.toLowerCase(),null,!1,!1)}),k.xlinkHref=new b("xlinkHref",1,!1,"xlink:href","http://www.w3.org/1999/xlink",!0,!1),["src","href","action","formAction"].forEach(e=>{k[e]=new b(e,1,!1,e.toLowerCase(),null,!0,!0)})
var E=n.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED,C=Symbol.for("react.element"),_=Symbol.for("react.portal"),N=Symbol.for("react.fragment"),P=Symbol.for("react.strict_mode"),z=Symbol.for("react.profiler"),L=Symbol.for("react.provider"),T=Symbol.for("react.context"),M=Symbol.for("react.forward_ref"),F=Symbol.for("react.suspense"),R=Symbol.for("react.suspense_list"),O=Symbol.for("react.memo"),D=Symbol.for("react.lazy"),I=Symbol.for("react.offscreen"),U=Symbol.iterator
function V(e){return null===e||"object"!=typeof e?null:"function"==typeof(e=U&&e[U]||e["@@iterator"])?e:null}var A,H=Object.assign
function B(e){if(void 0===A)try{throw Error()}catch(t){var n=t.stack.trim().match(/\n( *(at )?)/)
A=n&&n[1]||""}return"\n"+A+e}var j=!1
function W(e,n){if(!e||j)return""
j=!0
var t=Error.prepareStackTrace
Error.prepareStackTrace=void 0
try{if(n)if(n=()=>{throw Error()},Object.defineProperty(n.prototype,"props",{set:()=>{throw Error()}}),"object"==typeof Reflect&&Reflect.construct){try{Reflect.construct(n,[])}catch(s){var r=s}Reflect.construct(e,[],n)}else{try{n.call()}catch(s){r=s}e.call(n.prototype)}else{try{throw Error()}catch(s){r=s}e()}}catch(s){if(s&&r&&"string"==typeof s.stack){for(var l=s.stack.split("\n"),a=r.stack.split("\n"),o=l.length-1,u=a.length-1;1<=o&&0<=u&&l[o]!==a[u];)u--
for(;1<=o&&0<=u;o--,u--)if(l[o]!==a[u]){if(1!==o||1!==u)do{if(o--,0>--u||l[o]!==a[u]){var i="\n"+l[o].replace(" at new "," at ")
return e.displayName&&i.includes("<anonymous>")&&(i=i.replace("<anonymous>",e.displayName)),i}}while(1<=o&&0<=u)
break}}}finally{j=!1,Error.prepareStackTrace=t}return(e=e?e.displayName||e.name:"")?B(e):""}function Q(e){switch(e.tag){case 5:return B(e.type)
case 16:return B("Lazy")
case 13:return B("Suspense")
case 19:return B("SuspenseList")
case 0:case 2:case 15:return W(e.type,!1)
case 11:return W(e.type.render,!1)
case 1:return W(e.type,!0)
default:return""}}function $(e){if(null==e)return null
if("function"==typeof e)return e.displayName||e.name||null
if("string"==typeof e)return e
switch(e){case N:return"Fragment"
case _:return"Portal"
case z:return"Profiler"
case P:return"StrictMode"
case F:return"Suspense"
case R:return"SuspenseList"}if("object"==typeof e)switch(e.$$typeof){case T:return(e.displayName||"Context")+".Consumer"
case L:return(e._context.displayName||"Context")+".Provider"
case M:var n=e.render
return(e=e.displayName)||(e=""!==(e=n.displayName||n.name||"")?"ForwardRef("+e+")":"ForwardRef"),e
case O:return null!==(n=e.displayName||null)?n:$(e.type)||"Memo"
case D:n=e._payload,e=e._init
try{return $(e(n))}catch(t){}}return null}function K(e){var n=e.type
switch(e.tag){case 24:return"Cache"
case 9:return(n.displayName||"Context")+".Consumer"
case 10:return(n._context.displayName||"Context")+".Provider"
case 18:return"DehydratedFragment"
case 11:return e=(e=n.render).displayName||e.name||"",n.displayName||(""!==e?"ForwardRef("+e+")":"ForwardRef")
case 7:return"Fragment"
case 5:return n
case 4:return"Portal"
case 3:return"Root"
case 6:return"Text"
case 16:return $(n)
case 8:return n===P?"StrictMode":"Mode"
case 22:return"Offscreen"
case 12:return"Profiler"
case 21:return"Scope"
case 13:return"Suspense"
case 19:return"SuspenseList"
case 25:return"TracingMarker"
case 1:case 0:case 17:case 2:case 14:case 15:if("function"==typeof n)return n.displayName||n.name||null
if("string"==typeof n)return n}return null}function q(e){switch(typeof e){case"boolean":case"number":case"string":case"undefined":case"object":return e
default:return""}}function Y(e){var n=e.type
return(e=e.nodeName)&&"input"===e.toLowerCase()&&("checkbox"===n||"radio"===n)}function X(e){e._valueTracker||(e._valueTracker=function(e){var n=Y(e)?"checked":"value",t=Object.getOwnPropertyDescriptor(e.constructor.prototype,n),r=""+e[n]
if(!e.hasOwnProperty(n)&&void 0!==t&&"function"==typeof t.get&&"function"==typeof t.set){var l=t.get,a=t.set
return Object.defineProperty(e,n,{configurable:!0,get:function(){return l.call(this)},set:function(e){r=""+e,a.call(this,e)}}),Object.defineProperty(e,n,{enumerable:t.enumerable}),{getValue:()=>r,setValue:e=>{r=""+e},stopTracking:()=>{e._valueTracker=null,delete e[n]}}}}(e))}function G(e){if(!e)return!1
var n=e._valueTracker
if(!n)return!0
var t=n.getValue(),r=""
return e&&(r=Y(e)?e.checked?"true":"false":e.value),(e=r)!==t&&(n.setValue(e),!0)}function Z(e){if(void 0===(e=e||("undefined"!=typeof document?document:void 0)))return null
try{return e.activeElement||e.body}catch(n){return e.body}}function J(e,n){var t=n.checked
return H({},n,{defaultChecked:void 0,defaultValue:void 0,value:void 0,checked:null!=t?t:e._wrapperState.initialChecked})}function ee(e,n){var t=null==n.defaultValue?"":n.defaultValue,r=null!=n.checked?n.checked:n.defaultChecked
t=q(null!=n.value?n.value:t),e._wrapperState={initialChecked:r,initialValue:t,controlled:"checkbox"===n.type||"radio"===n.type?null!=n.checked:null!=n.value}}function ne(e,n){null!=(n=n.checked)&&x(e,"checked",n,!1)}function te(e,n){ne(e,n)
var t=q(n.value),r=n.type
if(null!=t)"number"===r?(0===t&&""===e.value||e.value!=t)&&(e.value=""+t):e.value!==""+t&&(e.value=""+t)
else if("submit"===r||"reset"===r)return void e.removeAttribute("value")
n.hasOwnProperty("value")?le(e,n.type,t):n.hasOwnProperty("defaultValue")&&le(e,n.type,q(n.defaultValue)),null==n.checked&&null!=n.defaultChecked&&(e.defaultChecked=!!n.defaultChecked)}function re(e,n,t){if(n.hasOwnProperty("value")||n.hasOwnProperty("defaultValue")){var r=n.type
if(!("submit"!==r&&"reset"!==r||void 0!==n.value&&null!==n.value))return
n=""+e._wrapperState.initialValue,t||n===e.value||(e.value=n),e.defaultValue=n}""!==(t=e.name)&&(e.name=""),e.defaultChecked=!!e._wrapperState.initialChecked,""!==t&&(e.name=t)}function le(e,n,t){"number"===n&&Z(e.ownerDocument)===e||(null==t?e.defaultValue=""+e._wrapperState.initialValue:e.defaultValue!==""+t&&(e.defaultValue=""+t))}var ae=Array.isArray
function oe(e,n,t,r){if(e=e.options,n){n={}
for(var l=0;l<t.length;l++)n["$"+t[l]]=!0
for(t=0;t<e.length;t++)l=n.hasOwnProperty("$"+e[t].value),e[t].selected!==l&&(e[t].selected=l),l&&r&&(e[t].defaultSelected=!0)}else{for(t=""+q(t),n=null,l=0;l<e.length;l++){if(e[l].value===t)return e[l].selected=!0,void(r&&(e[l].defaultSelected=!0))
null!==n||e[l].disabled||(n=e[l])}null!==n&&(n.selected=!0)}}function ue(e,n){if(null!=n.dangerouslySetInnerHTML)throw Error(o(91))
return H({},n,{value:void 0,defaultValue:void 0,children:""+e._wrapperState.initialValue})}function ie(e,n){var t=n.value
if(null==t){if(t=n.children,n=n.defaultValue,null!=t){if(null!=n)throw Error(o(92))
if(ae(t)){if(1<t.length)throw Error(o(93))
t=t[0]}n=t}null==n&&(n=""),t=n}e._wrapperState={initialValue:q(t)}}function se(e,n){var t=q(n.value),r=q(n.defaultValue)
null!=t&&((t=""+t)!==e.value&&(e.value=t),null==n.defaultValue&&e.defaultValue!==t&&(e.defaultValue=t)),null!=r&&(e.defaultValue=""+r)}function ce(e){var n=e.textContent
n===e._wrapperState.initialValue&&""!==n&&null!==n&&(e.value=n)}function fe(e){switch(e){case"svg":return"http://www.w3.org/2000/svg"
case"math":return"http://www.w3.org/1998/Math/MathML"
default:return"http://www.w3.org/1999/xhtml"}}function de(e,n){return null==e||"http://www.w3.org/1999/xhtml"===e?fe(n):"http://www.w3.org/2000/svg"===e&&"foreignObject"===n?"http://www.w3.org/1999/xhtml":e}var pe,he,me=(he=(e,n)=>{if("http://www.w3.org/2000/svg"!==e.namespaceURI||"innerHTML"in e)e.innerHTML=n
else{for((pe=pe||document.createElement("div")).innerHTML="<svg>"+n.valueOf().toString()+"</svg>",n=pe.firstChild;e.firstChild;)e.removeChild(e.firstChild)
for(;n.firstChild;)e.appendChild(n.firstChild)}},"undefined"!=typeof MSApp&&MSApp.execUnsafeLocalFunction?(e,n)=>{MSApp.execUnsafeLocalFunction(()=>he(e,n))}:he)
function ge(e,n){if(n){var t=e.firstChild
if(t&&t===e.lastChild&&3===t.nodeType)return void(t.nodeValue=n)}e.textContent=n}var ve={animationIterationCount:!0,aspectRatio:!0,borderImageOutset:!0,borderImageSlice:!0,borderImageWidth:!0,boxFlex:!0,boxFlexGroup:!0,boxOrdinalGroup:!0,columnCount:!0,columns:!0,flex:!0,flexGrow:!0,flexPositive:!0,flexShrink:!0,flexNegative:!0,flexOrder:!0,gridArea:!0,gridRow:!0,gridRowEnd:!0,gridRowSpan:!0,gridRowStart:!0,gridColumn:!0,gridColumnEnd:!0,gridColumnSpan:!0,gridColumnStart:!0,fontWeight:!0,lineClamp:!0,lineHeight:!0,opacity:!0,order:!0,orphans:!0,tabSize:!0,widows:!0,zIndex:!0,zoom:!0,fillOpacity:!0,floodOpacity:!0,stopOpacity:!0,strokeDasharray:!0,strokeDashoffset:!0,strokeMiterlimit:!0,strokeOpacity:!0,strokeWidth:!0},ye=["Webkit","ms","Moz","O"]
function be(e,n,t){return null==n||"boolean"==typeof n||""===n?"":t||"number"!=typeof n||0===n||ve.hasOwnProperty(e)&&ve[e]?(""+n).trim():n+"px"}function ke(e,n){for(var t in e=e.style,n)if(n.hasOwnProperty(t)){var r=0===t.indexOf("--"),l=be(t,n[t],r)
"float"===t&&(t="cssFloat"),r?e.setProperty(t,l):e[t]=l}}Object.keys(ve).forEach(e=>{ye.forEach(n=>{n=n+e.charAt(0).toUpperCase()+e.substring(1),ve[n]=ve[e]})})
var we=H({menuitem:!0},{area:!0,base:!0,br:!0,col:!0,embed:!0,hr:!0,img:!0,input:!0,keygen:!0,link:!0,meta:!0,param:!0,source:!0,track:!0,wbr:!0})
function Se(e,n){if(n){if(we[e]&&(null!=n.children||null!=n.dangerouslySetInnerHTML))throw Error(o(137,e))
if(null!=n.dangerouslySetInnerHTML){if(null!=n.children)throw Error(o(60))
if("object"!=typeof n.dangerouslySetInnerHTML||!("__html"in n.dangerouslySetInnerHTML))throw Error(o(61))}if(null!=n.style&&"object"!=typeof n.style)throw Error(o(62))}}function xe(e,n){if(-1===e.indexOf("-"))return"string"==typeof n.is
switch(e){case"annotation-xml":case"color-profile":case"font-face":case"font-face-src":case"font-face-uri":case"font-face-format":case"font-face-name":case"missing-glyph":return!1
default:return!0}}var Ee=null
function Ce(e){return(e=e.target||e.srcElement||window).correspondingUseElement&&(e=e.correspondingUseElement),3===e.nodeType?e.parentNode:e}var _e=null,Ne=null,Pe=null
function ze(e){if(e=xl(e)){if("function"!=typeof _e)throw Error(o(280))
var n=e.stateNode
n&&(n=Cl(n),_e(e.stateNode,e.type,n))}}function Le(e){Ne?Pe?Pe.push(e):Pe=[e]:Ne=e}function Te(){if(Ne){var e=Ne,n=Pe
if(Pe=Ne=null,ze(e),n)for(e=0;e<n.length;e++)ze(n[e])}}function Me(e,n){return e(n)}function Fe(){}var Re=!1
function Oe(e,n,t){if(Re)return e(n,t)
Re=!0
try{return Me(e,n,t)}finally{Re=!1,(null!==Ne||null!==Pe)&&(Fe(),Te())}}function De(e,n){var t=e.stateNode
if(null===t)return null
var r=Cl(t)
if(null===r)return null
t=r[n]
e:switch(n){case"onClick":case"onClickCapture":case"onDoubleClick":case"onDoubleClickCapture":case"onMouseDown":case"onMouseDownCapture":case"onMouseMove":case"onMouseMoveCapture":case"onMouseUp":case"onMouseUpCapture":case"onMouseEnter":(r=!r.disabled)||(r=!("button"===(e=e.type)||"input"===e||"select"===e||"textarea"===e)),e=!r
break e
default:e=!1}if(e)return null
if(t&&"function"!=typeof t)throw Error(o(231,n,typeof t))
return t}var Ie=!1
if(h)try{var Ue={}
Object.defineProperty(Ue,"passive",{get:()=>{Ie=!0}}),window.addEventListener("test",Ue,Ue),window.removeEventListener("test",Ue,Ue)}catch(he){Ie=!1}function Ve(e,n,t,r,l,a,o,u,i){var s=Array.prototype.slice.call(arguments,3)
try{n.apply(t,s)}catch(c){this.onError(c)}}var Ae=!1,He=null,Be=!1,je=null,We={onError:e=>{Ae=!0,He=e}}
function Qe(e,n,t,r,l,a,o,u,i){Ae=!1,He=null,Ve.apply(We,arguments)}function $e(e){var n=e,t=e
if(e.alternate)for(;n.return;)n=n.return
else{e=n
do{!!(4098&(n=e).flags)&&(t=n.return),e=n.return}while(e)}return 3===n.tag?t:null}function Ke(e){if(13===e.tag){var n=e.memoizedState
if(null===n&&null!==(e=e.alternate)&&(n=e.memoizedState),null!==n)return n.dehydrated}return null}function qe(e){if($e(e)!==e)throw Error(o(188))}function Ye(e){return null!==(e=(e=>{var n=e.alternate
if(!n){if(null===(n=$e(e)))throw Error(o(188))
return n!==e?null:e}for(var t=e,r=n;;){var l=t.return
if(null===l)break
var a=l.alternate
if(null===a){if(null!==(r=l.return)){t=r
continue}break}if(l.child===a.child){for(a=l.child;a;){if(a===t)return qe(l),e
if(a===r)return qe(l),n
a=a.sibling}throw Error(o(188))}if(t.return!==r.return)t=l,r=a
else{for(var u=!1,i=l.child;i;){if(i===t){u=!0,t=l,r=a
break}if(i===r){u=!0,r=l,t=a
break}i=i.sibling}if(!u){for(i=a.child;i;){if(i===t){u=!0,t=a,r=l
break}if(i===r){u=!0,r=a,t=l
break}i=i.sibling}if(!u)throw Error(o(189))}}if(t.alternate!==r)throw Error(o(190))}if(3!==t.tag)throw Error(o(188))
return t.stateNode.current===t?e:n})(e))?Xe(e):null}function Xe(e){if(5===e.tag||6===e.tag)return e
for(e=e.child;null!==e;){var n=Xe(e)
if(null!==n)return n
e=e.sibling}return null}var Ge=t.unstable_scheduleCallback,Ze=t.unstable_cancelCallback,Je=t.unstable_shouldYield,en=t.unstable_requestPaint,nn=t.unstable_now,tn=t.unstable_getCurrentPriorityLevel,rn=t.unstable_ImmediatePriority,ln=t.unstable_UserBlockingPriority,an=t.unstable_NormalPriority,on=t.unstable_LowPriority,un=t.unstable_IdlePriority,sn=null,cn=null,fn=Math.clz32?Math.clz32:e=>0==(e>>>=0)?32:31-(dn(e)/pn|0)|0,dn=Math.log,pn=Math.LN2,hn=64,mn=4194304
function gn(e){switch(e&-e){case 1:return 1
case 2:return 2
case 4:return 4
case 8:return 8
case 16:return 16
case 32:return 32
case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return 4194240&e
case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:return 130023424&e
case 134217728:return 134217728
case 268435456:return 268435456
case 536870912:return 536870912
case 1073741824:return 1073741824
default:return e}}function vn(e,n){var t=e.pendingLanes
if(0===t)return 0
var r=0,l=e.suspendedLanes,a=e.pingedLanes,o=268435455&t
if(0!==o){var u=o&~l
0!==u?r=gn(u):0!==(a&=o)&&(r=gn(a))}else 0!==(o=t&~l)?r=gn(o):0!==a&&(r=gn(a))
if(0===r)return 0
if(0!==n&&n!==r&&0===(n&l)&&((l=r&-r)>=(a=n&-n)||16===l&&4194240&a))return n
if(4&r&&(r|=16&t),0!==(n=e.entangledLanes))for(e=e.entanglements,n&=r;0<n;)l=1<<(t=31-fn(n)),r|=e[t],n&=~l
return r}function yn(e,n){switch(e){case 1:case 2:case 4:return n+250
case 8:case 16:case 32:case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:return n+5e3
default:return-1}}function bn(e){return 0!=(e=-1073741825&e.pendingLanes)?e:1073741824&e?1073741824:0}function kn(){var e=hn
return!(4194240&(hn<<=1))&&(hn=64),e}function wn(e){for(var n=[],t=0;31>t;t++)n.push(e)
return n}function Sn(e,n,t){e.pendingLanes|=n,536870912!==n&&(e.suspendedLanes=0,e.pingedLanes=0),(e=e.eventTimes)[n=31-fn(n)]=t}function xn(e,n){var t=e.entangledLanes|=n
for(e=e.entanglements;t;){var r=31-fn(t),l=1<<r
l&n|e[r]&n&&(e[r]|=n),t&=~l}}var En=0
function Cn(e){return 1<(e&=-e)?4<e?268435455&e?16:536870912:4:1}var _n,Nn,Pn,zn,Ln,Tn=!1,Mn=[],Fn=null,Rn=null,On=null,Dn=new Map,In=new Map,Un=[],Vn="mousedown mouseup touchcancel touchend touchstart auxclick dblclick pointercancel pointerdown pointerup dragend dragstart drop compositionend compositionstart keydown keypress keyup input textInput copy cut paste click change contextmenu reset submit".split(" ")
function An(e,n){switch(e){case"focusin":case"focusout":Fn=null
break
case"dragenter":case"dragleave":Rn=null
break
case"mouseover":case"mouseout":On=null
break
case"pointerover":case"pointerout":Dn.delete(n.pointerId)
break
case"gotpointercapture":case"lostpointercapture":In.delete(n.pointerId)}}function Hn(e,n,t,r,l,a){return null===e||e.nativeEvent!==a?(e={blockedOn:n,domEventName:t,eventSystemFlags:r,nativeEvent:a,targetContainers:[l]},null!==n&&null!==(n=xl(n))&&Nn(n),e):(e.eventSystemFlags|=r,n=e.targetContainers,null!==l&&-1===n.indexOf(l)&&n.push(l),e)}function Bn(e){var n=Sl(e.target)
if(null!==n){var t=$e(n)
if(null!==t)if(13===(n=t.tag)){if(null!==(n=Ke(t)))return e.blockedOn=n,void Ln(e.priority,()=>{Pn(t)})}else if(3===n&&t.stateNode.current.memoizedState.isDehydrated)return void(e.blockedOn=3===t.tag?t.stateNode.containerInfo:null)}e.blockedOn=null}function jn(e){if(null!==e.blockedOn)return!1
for(var n=e.targetContainers;0<n.length;){var t=et(e.domEventName,e.eventSystemFlags,n[0],e.nativeEvent)
if(null!==t)return null!==(n=xl(t))&&Nn(n),e.blockedOn=t,!1
var r=new(t=e.nativeEvent).constructor(t.type,t)
Ee=r,t.target.dispatchEvent(r),Ee=null,n.shift()}return!0}function Wn(e,n,t){jn(e)&&t.delete(n)}function Qn(){Tn=!1,null!==Fn&&jn(Fn)&&(Fn=null),null!==Rn&&jn(Rn)&&(Rn=null),null!==On&&jn(On)&&(On=null),Dn.forEach(Wn),In.forEach(Wn)}function $n(e,n){e.blockedOn===n&&(e.blockedOn=null,Tn||(Tn=!0,t.unstable_scheduleCallback(t.unstable_NormalPriority,Qn)))}function Kn(e){function n(n){return $n(n,e)}if(0<Mn.length){$n(Mn[0],e)
for(var t=1;t<Mn.length;t++){var r=Mn[t]
r.blockedOn===e&&(r.blockedOn=null)}}for(null!==Fn&&$n(Fn,e),null!==Rn&&$n(Rn,e),null!==On&&$n(On,e),Dn.forEach(n),In.forEach(n),t=0;t<Un.length;t++)(r=Un[t]).blockedOn===e&&(r.blockedOn=null)
for(;0<Un.length&&null===(t=Un[0]).blockedOn;)Bn(t),null===t.blockedOn&&Un.shift()}var qn=E.ReactCurrentBatchConfig,Yn=!0
function Xn(e,n,t,r){var l=En,a=qn.transition
qn.transition=null
try{En=1,Zn(e,n,t,r)}finally{En=l,qn.transition=a}}function Gn(e,n,t,r){var l=En,a=qn.transition
qn.transition=null
try{En=4,Zn(e,n,t,r)}finally{En=l,qn.transition=a}}function Zn(e,n,t,r){if(Yn){var l=et(e,n,t,r)
if(null===l)qr(e,n,r,Jn,t),An(e,r)
else if(((e,n,t,r,l)=>{switch(n){case"focusin":return Fn=Hn(Fn,e,n,t,r,l),!0
case"dragenter":return Rn=Hn(Rn,e,n,t,r,l),!0
case"mouseover":return On=Hn(On,e,n,t,r,l),!0
case"pointerover":var a=l.pointerId
return Dn.set(a,Hn(Dn.get(a)||null,e,n,t,r,l)),!0
case"gotpointercapture":return a=l.pointerId,In.set(a,Hn(In.get(a)||null,e,n,t,r,l)),!0}return!1})(l,e,n,t,r))r.stopPropagation()
else if(An(e,r),4&n&&-1<Vn.indexOf(e)){for(;null!==l;){var a=xl(l)
if(null!==a&&_n(a),null===(a=et(e,n,t,r))&&qr(e,n,r,Jn,t),a===l)break
l=a}null!==l&&r.stopPropagation()}else qr(e,n,r,null,t)}}var Jn=null
function et(e,n,t,r){if(Jn=null,null!==(e=Sl(e=Ce(r))))if(null===(n=$e(e)))e=null
else if(13===(t=n.tag)){if(null!==(e=Ke(n)))return e
e=null}else if(3===t){if(n.stateNode.current.memoizedState.isDehydrated)return 3===n.tag?n.stateNode.containerInfo:null
e=null}else n!==e&&(e=null)
return Jn=e,null}function nt(e){switch(e){case"cancel":case"click":case"close":case"contextmenu":case"copy":case"cut":case"auxclick":case"dblclick":case"dragend":case"dragstart":case"drop":case"focusin":case"focusout":case"input":case"invalid":case"keydown":case"keypress":case"keyup":case"mousedown":case"mouseup":case"paste":case"pause":case"play":case"pointercancel":case"pointerdown":case"pointerup":case"ratechange":case"reset":case"resize":case"seeked":case"submit":case"touchcancel":case"touchend":case"touchstart":case"volumechange":case"change":case"selectionchange":case"textInput":case"compositionstart":case"compositionend":case"compositionupdate":case"beforeblur":case"afterblur":case"beforeinput":case"blur":case"fullscreenchange":case"focus":case"hashchange":case"popstate":case"select":case"selectstart":return 1
case"drag":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"mousemove":case"mouseout":case"mouseover":case"pointermove":case"pointerout":case"pointerover":case"scroll":case"toggle":case"touchmove":case"wheel":case"mouseenter":case"mouseleave":case"pointerenter":case"pointerleave":return 4
case"message":switch(tn()){case rn:return 1
case ln:return 4
case an:case on:return 16
case un:return 536870912
default:return 16}default:return 16}}var tt=null,rt=null,lt=null
function at(){if(lt)return lt
var e,n,t=rt,r=t.length,l="value"in tt?tt.value:tt.textContent,a=l.length
for(e=0;e<r&&t[e]===l[e];e++);var o=r-e
for(n=1;n<=o&&t[r-n]===l[a-n];n++);return lt=l.slice(e,1<n?1-n:void 0)}function ot(e){var n=e.keyCode
return"charCode"in e?0===(e=e.charCode)&&13===n&&(e=13):e=n,10===e&&(e=13),32<=e||13===e?e:0}function ut(){return!0}function it(){return!1}function st(e){function n(n,t,r,l,a){for(var o in this._reactName=n,this._targetInst=r,this.type=t,this.nativeEvent=l,this.target=a,this.currentTarget=null,e)e.hasOwnProperty(o)&&(n=e[o],this[o]=n?n(l):l[o])
return this.isDefaultPrevented=(null!=l.defaultPrevented?l.defaultPrevented:!1===l.returnValue)?ut:it,this.isPropagationStopped=it,this}return H(n.prototype,{preventDefault:function(){this.defaultPrevented=!0
var e=this.nativeEvent
e&&(e.preventDefault?e.preventDefault():"unknown"!=typeof e.returnValue&&(e.returnValue=!1),this.isDefaultPrevented=ut)},stopPropagation:function(){var e=this.nativeEvent
e&&(e.stopPropagation?e.stopPropagation():"unknown"!=typeof e.cancelBubble&&(e.cancelBubble=!0),this.isPropagationStopped=ut)},persist:()=>{},isPersistent:ut}),n}var ct,ft,dt,pt={eventPhase:0,bubbles:0,cancelable:0,timeStamp:e=>e.timeStamp||Date.now(),defaultPrevented:0,isTrusted:0},ht=st(pt),mt=H({},pt,{view:0,detail:0}),gt=st(mt),vt=H({},mt,{screenX:0,screenY:0,clientX:0,clientY:0,pageX:0,pageY:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,getModifierState:zt,button:0,buttons:0,relatedTarget:e=>void 0===e.relatedTarget?e.fromElement===e.srcElement?e.toElement:e.fromElement:e.relatedTarget,movementX:e=>"movementX"in e?e.movementX:(e!==dt&&(dt&&"mousemove"===e.type?(ct=e.screenX-dt.screenX,ft=e.screenY-dt.screenY):ft=ct=0,dt=e),ct),movementY:e=>"movementY"in e?e.movementY:ft}),yt=st(vt),bt=st(H({},vt,{dataTransfer:0})),kt=st(H({},mt,{relatedTarget:0})),wt=st(H({},pt,{animationName:0,elapsedTime:0,pseudoElement:0})),St=H({},pt,{clipboardData:e=>"clipboardData"in e?e.clipboardData:window.clipboardData}),xt=st(St),Et=st(H({},pt,{data:0})),Ct={Esc:"Escape",Spacebar:" ",Left:"ArrowLeft",Up:"ArrowUp",Right:"ArrowRight",Down:"ArrowDown",Del:"Delete",Win:"OS",Menu:"ContextMenu",Apps:"ContextMenu",Scroll:"ScrollLock",MozPrintableKey:"Unidentified"},_t={8:"Backspace",9:"Tab",12:"Clear",13:"Enter",16:"Shift",17:"Control",18:"Alt",19:"Pause",20:"CapsLock",27:"Escape",32:" ",33:"PageUp",34:"PageDown",35:"End",36:"Home",37:"ArrowLeft",38:"ArrowUp",39:"ArrowRight",40:"ArrowDown",45:"Insert",46:"Delete",112:"F1",113:"F2",114:"F3",115:"F4",116:"F5",117:"F6",118:"F7",119:"F8",120:"F9",121:"F10",122:"F11",123:"F12",144:"NumLock",145:"ScrollLock",224:"Meta"},Nt={Alt:"altKey",Control:"ctrlKey",Meta:"metaKey",Shift:"shiftKey"}
function Pt(e){var n=this.nativeEvent
return n.getModifierState?n.getModifierState(e):!!(e=Nt[e])&&!!n[e]}function zt(){return Pt}var Lt=H({},mt,{key:e=>{if(e.key){var n=Ct[e.key]||e.key
if("Unidentified"!==n)return n}return"keypress"===e.type?13===(e=ot(e))?"Enter":String.fromCharCode(e):"keydown"===e.type||"keyup"===e.type?_t[e.keyCode]||"Unidentified":""},code:0,location:0,ctrlKey:0,shiftKey:0,altKey:0,metaKey:0,repeat:0,locale:0,getModifierState:zt,charCode:e=>"keypress"===e.type?ot(e):0,keyCode:e=>"keydown"===e.type||"keyup"===e.type?e.keyCode:0,which:e=>"keypress"===e.type?ot(e):"keydown"===e.type||"keyup"===e.type?e.keyCode:0}),Tt=st(Lt),Mt=st(H({},vt,{pointerId:0,width:0,height:0,pressure:0,tangentialPressure:0,tiltX:0,tiltY:0,twist:0,pointerType:0,isPrimary:0})),Ft=st(H({},mt,{touches:0,targetTouches:0,changedTouches:0,altKey:0,metaKey:0,ctrlKey:0,shiftKey:0,getModifierState:zt})),Rt=st(H({},pt,{propertyName:0,elapsedTime:0,pseudoElement:0})),Ot=H({},vt,{deltaX:e=>"deltaX"in e?e.deltaX:"wheelDeltaX"in e?-e.wheelDeltaX:0,deltaY:e=>"deltaY"in e?e.deltaY:"wheelDeltaY"in e?-e.wheelDeltaY:"wheelDelta"in e?-e.wheelDelta:0,deltaZ:0,deltaMode:0}),Dt=st(Ot),It=[9,13,27,32],Ut=h&&"CompositionEvent"in window,Vt=null
h&&"documentMode"in document&&(Vt=document.documentMode)
var At=h&&"TextEvent"in window&&!Vt,Ht=h&&(!Ut||Vt&&8<Vt&&11>=Vt),Bt=String.fromCharCode(32),jt=!1
function Wt(e,n){switch(e){case"keyup":return-1!==It.indexOf(n.keyCode)
case"keydown":return 229!==n.keyCode
case"keypress":case"mousedown":case"focusout":return!0
default:return!1}}function Qt(e){return"object"==typeof(e=e.detail)&&"data"in e?e.data:null}var $t=!1,Kt={color:!0,date:!0,datetime:!0,"datetime-local":!0,email:!0,month:!0,number:!0,password:!0,range:!0,search:!0,tel:!0,text:!0,time:!0,url:!0,week:!0}
function qt(e){var n=e&&e.nodeName&&e.nodeName.toLowerCase()
return"input"===n?!!Kt[e.type]:"textarea"===n}function Yt(e,n,t,r){Le(r),0<(n=Xr(n,"onChange")).length&&(t=new ht("onChange","change",null,t,r),e.push({event:t,listeners:n}))}var Xt=null,Gt=null
function Zt(e){Br(e,0)}function Jt(e){if(G(El(e)))return e}function er(e,n){if("change"===e)return n}var nr=!1
if(h){var tr
if(h){var rr="oninput"in document
if(!rr){var lr=document.createElement("div")
lr.setAttribute("oninput","return;"),rr="function"==typeof lr.oninput}tr=rr}else tr=!1
nr=tr&&(!document.documentMode||9<document.documentMode)}function ar(){Xt&&(Xt.detachEvent("onpropertychange",or),Gt=Xt=null)}function or(e){if("value"===e.propertyName&&Jt(Gt)){var n=[]
Yt(n,Gt,e,Ce(e)),Oe(Zt,n)}}function ur(e,n,t){"focusin"===e?(ar(),Gt=t,(Xt=n).attachEvent("onpropertychange",or)):"focusout"===e&&ar()}function ir(e){if("selectionchange"===e||"keyup"===e||"keydown"===e)return Jt(Gt)}function sr(e,n){if("click"===e)return Jt(n)}function cr(e,n){if("input"===e||"change"===e)return Jt(n)}var fr="function"==typeof Object.is?Object.is:(e,n)=>e===n&&(0!==e||1/e==1/n)||e!=e&&n!=n
function dr(e,n){if(fr(e,n))return!0
if("object"!=typeof e||null===e||"object"!=typeof n||null===n)return!1
var t=Object.keys(e),r=Object.keys(n)
if(t.length!==r.length)return!1
for(r=0;r<t.length;r++){var l=t[r]
if(!m.call(n,l)||!fr(e[l],n[l]))return!1}return!0}function pr(e){for(;e&&e.firstChild;)e=e.firstChild
return e}function hr(e,n){var t,r=pr(e)
for(e=0;r;){if(3===r.nodeType){if(t=e+r.textContent.length,e<=n&&t>=n)return{node:r,offset:n-e}
e=t}e:{for(;r;){if(r.nextSibling){r=r.nextSibling
break e}r=r.parentNode}r=void 0}r=pr(r)}}function mr(e,n){return!(!e||!n)&&(e===n||(!e||3!==e.nodeType)&&(n&&3===n.nodeType?mr(e,n.parentNode):"contains"in e?e.contains(n):!!e.compareDocumentPosition&&!!(16&e.compareDocumentPosition(n))))}function gr(){for(var e=window,n=Z();n instanceof e.HTMLIFrameElement;){try{var t="string"==typeof n.contentWindow.location.href}catch(r){t=!1}if(!t)break
n=Z((e=n.contentWindow).document)}return n}function vr(e){var n=e&&e.nodeName&&e.nodeName.toLowerCase()
return n&&("input"===n&&("text"===e.type||"search"===e.type||"tel"===e.type||"url"===e.type||"password"===e.type)||"textarea"===n||"true"===e.contentEditable)}function yr(e){var n=gr(),t=e.focusedElem,r=e.selectionRange
if(n!==t&&t&&t.ownerDocument&&mr(t.ownerDocument.documentElement,t)){if(null!==r&&vr(t))if(n=r.start,void 0===(e=r.end)&&(e=n),"selectionStart"in t)t.selectionStart=n,t.selectionEnd=Math.min(e,t.value.length)
else if((e=(n=t.ownerDocument||document)&&n.defaultView||window).getSelection){e=e.getSelection()
var l=t.textContent.length,a=Math.min(r.start,l)
r=void 0===r.end?a:Math.min(r.end,l),!e.extend&&a>r&&(l=r,r=a,a=l),l=hr(t,a)
var o=hr(t,r)
l&&o&&(1!==e.rangeCount||e.anchorNode!==l.node||e.anchorOffset!==l.offset||e.focusNode!==o.node||e.focusOffset!==o.offset)&&((n=n.createRange()).setStart(l.node,l.offset),e.removeAllRanges(),a>r?(e.addRange(n),e.extend(o.node,o.offset)):(n.setEnd(o.node,o.offset),e.addRange(n)))}for(n=[],e=t;e=e.parentNode;)1===e.nodeType&&n.push({element:e,left:e.scrollLeft,top:e.scrollTop})
for("function"==typeof t.focus&&t.focus(),t=0;t<n.length;t++)(e=n[t]).element.scrollLeft=e.left,e.element.scrollTop=e.top}}var br=h&&"documentMode"in document&&11>=document.documentMode,kr=null,wr=null,Sr=null,xr=!1
function Er(e,n,t){var r=t.window===t?t.document:9===t.nodeType?t:t.ownerDocument
xr||null==kr||kr!==Z(r)||(r="selectionStart"in(r=kr)&&vr(r)?{start:r.selectionStart,end:r.selectionEnd}:{anchorNode:(r=(r.ownerDocument&&r.ownerDocument.defaultView||window).getSelection()).anchorNode,anchorOffset:r.anchorOffset,focusNode:r.focusNode,focusOffset:r.focusOffset},Sr&&dr(Sr,r)||(Sr=r,0<(r=Xr(wr,"onSelect")).length&&(n=new ht("onSelect","select",null,n,t),e.push({event:n,listeners:r}),n.target=kr)))}function Cr(e,n){var t={}
return t[e.toLowerCase()]=n.toLowerCase(),t["Webkit"+e]="webkit"+n,t["Moz"+e]="moz"+n,t}var _r={animationend:Cr("Animation","AnimationEnd"),animationiteration:Cr("Animation","AnimationIteration"),animationstart:Cr("Animation","AnimationStart"),transitionend:Cr("Transition","TransitionEnd")},Nr={},Pr={}
function zr(e){if(Nr[e])return Nr[e]
if(!_r[e])return e
var n,t=_r[e]
for(n in t)if(t.hasOwnProperty(n)&&n in Pr)return Nr[e]=t[n]
return e}h&&(Pr=document.createElement("div").style,"AnimationEvent"in window||(delete _r.animationend.animation,delete _r.animationiteration.animation,delete _r.animationstart.animation),"TransitionEvent"in window||delete _r.transitionend.transition)
var Lr=zr("animationend"),Tr=zr("animationiteration"),Mr=zr("animationstart"),Fr=zr("transitionend"),Rr=new Map,Or="abort auxClick cancel canPlay canPlayThrough click close contextMenu copy cut drag dragEnd dragEnter dragExit dragLeave dragOver dragStart drop durationChange emptied encrypted ended error gotPointerCapture input invalid keyDown keyPress keyUp load loadedData loadedMetadata loadStart lostPointerCapture mouseDown mouseMove mouseOut mouseOver mouseUp paste pause play playing pointerCancel pointerDown pointerMove pointerOut pointerOver pointerUp progress rateChange reset resize seeked seeking stalled submit suspend timeUpdate touchCancel touchEnd touchStart volumeChange scroll toggle touchMove waiting wheel".split(" ")
function Dr(e,n){Rr.set(e,n),d(n,[e])}for(var Ir=0;Ir<Or.length;Ir++){var Ur=Or[Ir]
Dr(Ur.toLowerCase(),"on"+(Ur[0].toUpperCase()+Ur.slice(1)))}Dr(Lr,"onAnimationEnd"),Dr(Tr,"onAnimationIteration"),Dr(Mr,"onAnimationStart"),Dr("dblclick","onDoubleClick"),Dr("focusin","onFocus"),Dr("focusout","onBlur"),Dr(Fr,"onTransitionEnd"),p("onMouseEnter",["mouseout","mouseover"]),p("onMouseLeave",["mouseout","mouseover"]),p("onPointerEnter",["pointerout","pointerover"]),p("onPointerLeave",["pointerout","pointerover"]),d("onChange","change click focusin focusout input keydown keyup selectionchange".split(" ")),d("onSelect","focusout contextmenu dragend focusin keydown keyup mousedown mouseup selectionchange".split(" ")),d("onBeforeInput",["compositionend","keypress","textInput","paste"]),d("onCompositionEnd","compositionend focusout keydown keypress keyup mousedown".split(" ")),d("onCompositionStart","compositionstart focusout keydown keypress keyup mousedown".split(" ")),d("onCompositionUpdate","compositionupdate focusout keydown keypress keyup mousedown".split(" "))
var Vr="abort canplay canplaythrough durationchange emptied encrypted ended error loadeddata loadedmetadata loadstart pause play playing progress ratechange resize seeked seeking stalled suspend timeupdate volumechange waiting".split(" "),Ar=new Set("cancel close invalid load scroll toggle".split(" ").concat(Vr))
function Hr(e,n,t){var r=e.type||"unknown-event"
e.currentTarget=t,function(e,n,t,r,l,a,u,i,s){if(Qe.apply(this,arguments),Ae){if(!Ae)throw Error(o(198))
var c=He
Ae=!1,He=null,Be||(Be=!0,je=c)}}(r,n,void 0,e),e.currentTarget=null}function Br(e,n){n=!!(4&n)
for(var t=0;t<e.length;t++){var r=e[t],l=r.event
r=r.listeners
e:{var a=void 0
if(n)for(var o=r.length-1;0<=o;o--){var u=r[o],i=u.instance,s=u.currentTarget
if(u=u.listener,i!==a&&l.isPropagationStopped())break e
Hr(l,u,s),a=i}else for(o=0;o<r.length;o++){if(i=(u=r[o]).instance,s=u.currentTarget,u=u.listener,i!==a&&l.isPropagationStopped())break e
Hr(l,u,s),a=i}}}if(Be)throw e=je,Be=!1,je=null,e}function jr(e,n){var t=n[bl]
void 0===t&&(t=n[bl]=new Set)
var r=e+"__bubble"
t.has(r)||(Kr(n,e,2,!1),t.add(r))}function Wr(e,n,t){var r=0
n&&(r|=4),Kr(t,e,r,n)}var Qr="_reactListening"+Math.random().toString(36).slice(2)
function $r(e){if(!e[Qr]){e[Qr]=!0,u.forEach(n=>{"selectionchange"!==n&&(Ar.has(n)||Wr(n,!1,e),Wr(n,!0,e))})
var n=9===e.nodeType?e:e.ownerDocument
null===n||n[Qr]||(n[Qr]=!0,Wr("selectionchange",!1,n))}}function Kr(e,n,t,r){switch(nt(n)){case 1:var l=Xn
break
case 4:l=Gn
break
default:l=Zn}t=l.bind(null,n,t,e),l=void 0,!Ie||"touchstart"!==n&&"touchmove"!==n&&"wheel"!==n||(l=!0),r?void 0!==l?e.addEventListener(n,t,{capture:!0,passive:l}):e.addEventListener(n,t,!0):void 0!==l?e.addEventListener(n,t,{passive:l}):e.addEventListener(n,t,!1)}function qr(e,n,t,r,l){var a=r
if(!(1&n||2&n||null===r))e:for(;;){if(null===r)return
var o=r.tag
if(3===o||4===o){var u=r.stateNode.containerInfo
if(u===l||8===u.nodeType&&u.parentNode===l)break
if(4===o)for(o=r.return;null!==o;){var i=o.tag
if((3===i||4===i)&&((i=o.stateNode.containerInfo)===l||8===i.nodeType&&i.parentNode===l))return
o=o.return}for(;null!==u;){if(null===(o=Sl(u)))return
if(5===(i=o.tag)||6===i){r=a=o
continue e}u=u.parentNode}}r=r.return}Oe(()=>{var r=a,l=Ce(t),o=[]
e:{var u=Rr.get(e)
if(void 0!==u){var i=ht,s=e
switch(e){case"keypress":if(0===ot(t))break e
case"keydown":case"keyup":i=Tt
break
case"focusin":s="focus",i=kt
break
case"focusout":s="blur",i=kt
break
case"beforeblur":case"afterblur":i=kt
break
case"click":if(2===t.button)break e
case"auxclick":case"dblclick":case"mousedown":case"mousemove":case"mouseup":case"mouseout":case"mouseover":case"contextmenu":i=yt
break
case"drag":case"dragend":case"dragenter":case"dragexit":case"dragleave":case"dragover":case"dragstart":case"drop":i=bt
break
case"touchcancel":case"touchend":case"touchmove":case"touchstart":i=Ft
break
case Lr:case Tr:case Mr:i=wt
break
case Fr:i=Rt
break
case"scroll":i=gt
break
case"wheel":i=Dt
break
case"copy":case"cut":case"paste":i=xt
break
case"gotpointercapture":case"lostpointercapture":case"pointercancel":case"pointerdown":case"pointermove":case"pointerout":case"pointerover":case"pointerup":i=Mt}var c=!!(4&n),f=!c&&"scroll"===e,d=c?null!==u?u+"Capture":null:u
c=[]
for(var p,h=r;null!==h;){var m=(p=h).stateNode
if(5===p.tag&&null!==m&&(p=m,null!==d&&null!=(m=De(h,d))&&c.push(Yr(h,m,p))),f)break
h=h.return}0<c.length&&(u=new i(u,s,null,t,l),o.push({event:u,listeners:c}))}}if(!(7&n)){if(i="mouseout"===e||"pointerout"===e,(!(u="mouseover"===e||"pointerover"===e)||t===Ee||!(s=t.relatedTarget||t.fromElement)||!Sl(s)&&!s[yl])&&(i||u)&&(u=l.window===l?l:(u=l.ownerDocument)?u.defaultView||u.parentWindow:window,i?(i=r,null!==(s=(s=t.relatedTarget||t.toElement)?Sl(s):null)&&(s!==(f=$e(s))||5!==s.tag&&6!==s.tag)&&(s=null)):(i=null,s=r),i!==s)){if(c=yt,m="onMouseLeave",d="onMouseEnter",h="mouse","pointerout"!==e&&"pointerover"!==e||(c=Mt,m="onPointerLeave",d="onPointerEnter",h="pointer"),f=null==i?u:El(i),p=null==s?u:El(s),(u=new c(m,h+"leave",i,t,l)).target=f,u.relatedTarget=p,m=null,Sl(l)===r&&((c=new c(d,h+"enter",s,t,l)).target=p,c.relatedTarget=f,m=c),f=m,i&&s)e:{for(d=s,h=0,p=c=i;p;p=Gr(p))h++
for(p=0,m=d;m;m=Gr(m))p++
for(;0<h-p;)c=Gr(c),h--
for(;0<p-h;)d=Gr(d),p--
for(;h--;){if(c===d||null!==d&&c===d.alternate)break e
c=Gr(c),d=Gr(d)}c=null}else c=null
null!==i&&Zr(o,u,i,c,!1),null!==s&&null!==f&&Zr(o,f,s,c,!0)}if("select"===(i=(u=r?El(r):window).nodeName&&u.nodeName.toLowerCase())||"input"===i&&"file"===u.type)var g=er
else if(qt(u))if(nr)g=cr
else{g=ir
var v=ur}else(i=u.nodeName)&&"input"===i.toLowerCase()&&("checkbox"===u.type||"radio"===u.type)&&(g=sr)
switch(g&&(g=g(e,r))?Yt(o,g,t,l):(v&&v(e,u,r),"focusout"===e&&(v=u._wrapperState)&&v.controlled&&"number"===u.type&&le(u,"number",u.value)),v=r?El(r):window,e){case"focusin":(qt(v)||"true"===v.contentEditable)&&(kr=v,wr=r,Sr=null)
break
case"focusout":Sr=wr=kr=null
break
case"mousedown":xr=!0
break
case"contextmenu":case"mouseup":case"dragend":xr=!1,Er(o,t,l)
break
case"selectionchange":if(br)break
case"keydown":case"keyup":Er(o,t,l)}var y
if(Ut)e:{switch(e){case"compositionstart":var b="onCompositionStart"
break e
case"compositionend":b="onCompositionEnd"
break e
case"compositionupdate":b="onCompositionUpdate"
break e}b=void 0}else $t?Wt(e,t)&&(b="onCompositionEnd"):"keydown"===e&&229===t.keyCode&&(b="onCompositionStart")
b&&(Ht&&"ko"!==t.locale&&($t||"onCompositionStart"!==b?"onCompositionEnd"===b&&$t&&(y=at()):(rt="value"in(tt=l)?tt.value:tt.textContent,$t=!0)),0<(v=Xr(r,b)).length&&(b=new Et(b,e,null,t,l),o.push({event:b,listeners:v}),(y||null!==(y=Qt(t)))&&(b.data=y))),(y=At?((e,n)=>{switch(e){case"compositionend":return Qt(n)
case"keypress":return 32!==n.which?null:(jt=!0,Bt)
case"textInput":return(e=n.data)===Bt&&jt?null:e
default:return null}})(e,t):((e,n)=>{if($t)return"compositionend"===e||!Ut&&Wt(e,n)?(e=at(),lt=rt=tt=null,$t=!1,e):null
switch(e){case"paste":default:return null
case"keypress":if(!(n.ctrlKey||n.altKey||n.metaKey)||n.ctrlKey&&n.altKey){if(n.char&&1<n.char.length)return n.char
if(n.which)return String.fromCharCode(n.which)}return null
case"compositionend":return Ht&&"ko"!==n.locale?null:n.data}})(e,t))&&0<(r=Xr(r,"onBeforeInput")).length&&(l=new Et("onBeforeInput","beforeinput",null,t,l),o.push({event:l,listeners:r}),l.data=y)}Br(o,n)})}function Yr(e,n,t){return{instance:e,listener:n,currentTarget:t}}function Xr(e,n){for(var t=n+"Capture",r=[];null!==e;){var l=e,a=l.stateNode
5===l.tag&&null!==a&&(l=a,null!=(a=De(e,t))&&r.unshift(Yr(e,a,l)),null!=(a=De(e,n))&&r.push(Yr(e,a,l))),e=e.return}return r}function Gr(e){if(null===e)return null
do{e=e.return}while(e&&5!==e.tag)
return e||null}function Zr(e,n,t,r,l){for(var a=n._reactName,o=[];null!==t&&t!==r;){var u=t,i=u.alternate,s=u.stateNode
if(null!==i&&i===r)break
5===u.tag&&null!==s&&(u=s,l?null!=(i=De(t,a))&&o.unshift(Yr(t,i,u)):l||null!=(i=De(t,a))&&o.push(Yr(t,i,u))),t=t.return}0!==o.length&&e.push({event:n,listeners:o})}var Jr=/\r\n?/g,el=/\u0000|\uFFFD/g
function nl(e){return("string"==typeof e?e:""+e).replace(Jr,"\n").replace(el,"")}function tl(e,n,t){if(n=nl(n),nl(e)!==n&&t)throw Error(o(425))}function rl(){}var ll=null,al=null
function ol(e,n){return"textarea"===e||"noscript"===e||"string"==typeof n.children||"number"==typeof n.children||"object"==typeof n.dangerouslySetInnerHTML&&null!==n.dangerouslySetInnerHTML&&null!=n.dangerouslySetInnerHTML.__html}var ul="function"==typeof setTimeout?setTimeout:void 0,il="function"==typeof clearTimeout?clearTimeout:void 0,sl="function"==typeof Promise?Promise:void 0,cl="function"==typeof queueMicrotask?queueMicrotask:void 0!==sl?e=>sl.resolve(null).then(e).catch(fl):ul
function fl(e){setTimeout(()=>{throw e})}function dl(e,n){var t=n,r=0
do{var l=t.nextSibling
if(e.removeChild(t),l&&8===l.nodeType)if("/$"===(t=l.data)){if(0===r)return e.removeChild(l),void Kn(n)
r--}else"$"!==t&&"$?"!==t&&"$!"!==t||r++
t=l}while(t)
Kn(n)}function pl(e){for(;null!=e;e=e.nextSibling){var n=e.nodeType
if(1===n||3===n)break
if(8===n){if("$"===(n=e.data)||"$!"===n||"$?"===n)break
if("/$"===n)return null}}return e}function hl(e){e=e.previousSibling
for(var n=0;e;){if(8===e.nodeType){var t=e.data
if("$"===t||"$!"===t||"$?"===t){if(0===n)return e
n--}else"/$"===t&&n++}e=e.previousSibling}return null}var ml=Math.random().toString(36).slice(2),gl="__reactFiber$"+ml,vl="__reactProps$"+ml,yl="__reactContainer$"+ml,bl="__reactEvents$"+ml,kl="__reactListeners$"+ml,wl="__reactHandles$"+ml
function Sl(e){var n=e[gl]
if(n)return n
for(var t=e.parentNode;t;){if(n=t[yl]||t[gl]){if(t=n.alternate,null!==n.child||null!==t&&null!==t.child)for(e=hl(e);null!==e;){if(t=e[gl])return t
e=hl(e)}return n}t=(e=t).parentNode}return null}function xl(e){return!(e=e[gl]||e[yl])||5!==e.tag&&6!==e.tag&&13!==e.tag&&3!==e.tag?null:e}function El(e){if(5===e.tag||6===e.tag)return e.stateNode
throw Error(o(33))}function Cl(e){return e[vl]||null}var _l=[],Nl=-1
function Pl(e){return{current:e}}function zl(e){0>Nl||(e.current=_l[Nl],_l[Nl]=null,Nl--)}function Ll(e,n){Nl++,_l[Nl]=e.current,e.current=n}var Tl={},Ml=Pl(Tl),Fl=Pl(!1),Rl=Tl
function Ol(e,n){var t=e.type.contextTypes
if(!t)return Tl
var r=e.stateNode
if(r&&r.__reactInternalMemoizedUnmaskedChildContext===n)return r.__reactInternalMemoizedMaskedChildContext
var l,a={}
for(l in t)a[l]=n[l]
return r&&((e=e.stateNode).__reactInternalMemoizedUnmaskedChildContext=n,e.__reactInternalMemoizedMaskedChildContext=a),a}function Dl(e){return null!=e.childContextTypes}function Il(){zl(Fl),zl(Ml)}function Ul(e,n,t){if(Ml.current!==Tl)throw Error(o(168))
Ll(Ml,n),Ll(Fl,t)}function Vl(e,n,t){var r=e.stateNode
if(n=n.childContextTypes,"function"!=typeof r.getChildContext)return t
for(var l in r=r.getChildContext())if(!(l in n))throw Error(o(108,K(e)||"Unknown",l))
return H({},t,r)}function Al(e){return e=(e=e.stateNode)&&e.__reactInternalMemoizedMergedChildContext||Tl,Rl=Ml.current,Ll(Ml,e),Ll(Fl,Fl.current),!0}function Hl(e,n,t){var r=e.stateNode
if(!r)throw Error(o(169))
t?(e=Vl(e,n,Rl),r.__reactInternalMemoizedMergedChildContext=e,zl(Fl),zl(Ml),Ll(Ml,e)):zl(Fl),Ll(Fl,t)}var Bl=null,jl=!1,Wl=!1
function Ql(e){null===Bl?Bl=[e]:Bl.push(e)}function $l(){if(!Wl&&null!==Bl){Wl=!0
var e=0,n=En
try{var t=Bl
for(En=1;e<t.length;e++){var r=t[e]
do{r=r(!0)}while(null!==r)}Bl=null,jl=!1}catch(l){throw null!==Bl&&(Bl=Bl.slice(e+1)),Ge(rn,$l),l}finally{En=n,Wl=!1}}return null}var Kl=[],ql=0,Yl=null,Xl=0,Gl=[],Zl=0,Jl=null,ea=1,na=""
function ta(e,n){Kl[ql++]=Xl,Kl[ql++]=Yl,Yl=e,Xl=n}function ra(e,n,t){Gl[Zl++]=ea,Gl[Zl++]=na,Gl[Zl++]=Jl,Jl=e
var r=ea
e=na
var l=32-fn(r)-1
r&=~(1<<l),t+=1
var a=32-fn(n)+l
if(30<a){var o=l-l%5
a=(r&(1<<o)-1).toString(32),r>>=o,l-=o,ea=1<<32-fn(n)+l|t<<l|r,na=a+e}else ea=1<<a|t<<l|r,na=e}function la(e){null!==e.return&&(ta(e,1),ra(e,1,0))}function aa(e){for(;e===Yl;)Yl=Kl[--ql],Kl[ql]=null,Xl=Kl[--ql],Kl[ql]=null
for(;e===Jl;)Jl=Gl[--Zl],Gl[Zl]=null,na=Gl[--Zl],Gl[Zl]=null,ea=Gl[--Zl],Gl[Zl]=null}var oa=null,ua=null,ia=!1,sa=null
function ca(e,n){var t=Rs(5,null,null,0)
t.elementType="DELETED",t.stateNode=n,t.return=e,null===(n=e.deletions)?(e.deletions=[t],e.flags|=16):n.push(t)}function fa(e,n){switch(e.tag){case 5:var t=e.type
return null!==(n=1!==n.nodeType||t.toLowerCase()!==n.nodeName.toLowerCase()?null:n)&&(e.stateNode=n,oa=e,ua=pl(n.firstChild),!0)
case 6:return null!==(n=""===e.pendingProps||3!==n.nodeType?null:n)&&(e.stateNode=n,oa=e,ua=null,!0)
case 13:return null!==(n=8!==n.nodeType?null:n)&&(t=null!==Jl?{id:ea,overflow:na}:null,e.memoizedState={dehydrated:n,treeContext:t,retryLane:1073741824},(t=Rs(18,null,null,0)).stateNode=n,t.return=e,e.child=t,oa=e,ua=null,!0)
default:return!1}}function da(e){return!(!(1&e.mode)||128&e.flags)}function pa(e){if(ia){var n=ua
if(n){var t=n
if(!fa(e,n)){if(da(e))throw Error(o(418))
n=pl(t.nextSibling)
var r=oa
n&&fa(e,n)?ca(r,t):(e.flags=-4097&e.flags|2,ia=!1,oa=e)}}else{if(da(e))throw Error(o(418))
e.flags=-4097&e.flags|2,ia=!1,oa=e}}}function ha(e){for(e=e.return;null!==e&&5!==e.tag&&3!==e.tag&&13!==e.tag;)e=e.return
oa=e}function ma(e){if(e!==oa)return!1
if(!ia)return ha(e),ia=!0,!1
var n
if((n=3!==e.tag)&&!(n=5!==e.tag)&&(n="head"!==(n=e.type)&&"body"!==n&&!ol(e.type,e.memoizedProps)),n&&(n=ua)){if(da(e))throw ga(),Error(o(418))
for(;n;)ca(e,n),n=pl(n.nextSibling)}if(ha(e),13===e.tag){if(!(e=null!==(e=e.memoizedState)?e.dehydrated:null))throw Error(o(317))
e:{for(e=e.nextSibling,n=0;e;){if(8===e.nodeType){var t=e.data
if("/$"===t){if(0===n){ua=pl(e.nextSibling)
break e}n--}else"$"!==t&&"$!"!==t&&"$?"!==t||n++}e=e.nextSibling}ua=null}}else ua=oa?pl(e.stateNode.nextSibling):null
return!0}function ga(){for(var e=ua;e;)e=pl(e.nextSibling)}function va(){ua=oa=null,ia=!1}function ya(e){null===sa?sa=[e]:sa.push(e)}var ba=E.ReactCurrentBatchConfig
function ka(e,n,t){if(null!==(e=t.ref)&&"function"!=typeof e&&"object"!=typeof e){if(t._owner){if(t=t._owner){if(1!==t.tag)throw Error(o(309))
var r=t.stateNode}if(!r)throw Error(o(147,e))
var l=r,a=""+e
return null!==n&&null!==n.ref&&"function"==typeof n.ref&&n.ref._stringRef===a?n.ref:((n=e=>{var n=l.refs
null===e?delete n[a]:n[a]=e})._stringRef=a,n)}if("string"!=typeof e)throw Error(o(284))
if(!t._owner)throw Error(o(290,e))}return e}function wa(e,n){throw e=Object.prototype.toString.call(n),Error(o(31,"[object Object]"===e?"object with keys {"+Object.keys(n).join(", ")+"}":e))}function Sa(e){return(0,e._init)(e._payload)}function xa(e){function n(n,t){if(e){var r=n.deletions
null===r?(n.deletions=[t],n.flags|=16):r.push(t)}}function t(t,r){if(!e)return null
for(;null!==r;)n(t,r),r=r.sibling
return null}function r(e,n){for(e=new Map;null!==n;)null!==n.key?e.set(n.key,n):e.set(n.index,n),n=n.sibling
return e}function l(e,n){return(e=Ds(e,n)).index=0,e.sibling=null,e}function a(n,t,r){return n.index=r,e?null!==(r=n.alternate)?(r=r.index)<t?(n.flags|=2,t):r:(n.flags|=2,t):(n.flags|=1048576,t)}function u(n){return e&&null===n.alternate&&(n.flags|=2),n}function i(e,n,t,r){return null===n||6!==n.tag?((n=As(t,e.mode,r)).return=e,n):((n=l(n,t)).return=e,n)}function s(e,n,t,r){var a=t.type
return a===N?f(e,n,t.props.children,r,t.key):null!==n&&(n.elementType===a||"object"==typeof a&&null!==a&&a.$$typeof===D&&Sa(a)===n.type)?((r=l(n,t.props)).ref=ka(e,n,t),r.return=e,r):((r=Is(t.type,t.key,t.props,null,e.mode,r)).ref=ka(e,n,t),r.return=e,r)}function c(e,n,t,r){return null===n||4!==n.tag||n.stateNode.containerInfo!==t.containerInfo||n.stateNode.implementation!==t.implementation?((n=Hs(t,e.mode,r)).return=e,n):((n=l(n,t.children||[])).return=e,n)}function f(e,n,t,r,a){return null===n||7!==n.tag?((n=Us(t,e.mode,r,a)).return=e,n):((n=l(n,t)).return=e,n)}function d(e,n,t){if("string"==typeof n&&""!==n||"number"==typeof n)return(n=As(""+n,e.mode,t)).return=e,n
if("object"==typeof n&&null!==n){switch(n.$$typeof){case C:return(t=Is(n.type,n.key,n.props,null,e.mode,t)).ref=ka(e,null,n),t.return=e,t
case _:return(n=Hs(n,e.mode,t)).return=e,n
case D:return d(e,(0,n._init)(n._payload),t)}if(ae(n)||V(n))return(n=Us(n,e.mode,t,null)).return=e,n
wa(e,n)}return null}function p(e,n,t,r){var l=null!==n?n.key:null
if("string"==typeof t&&""!==t||"number"==typeof t)return null!==l?null:i(e,n,""+t,r)
if("object"==typeof t&&null!==t){switch(t.$$typeof){case C:return t.key===l?s(e,n,t,r):null
case _:return t.key===l?c(e,n,t,r):null
case D:return p(e,n,(l=t._init)(t._payload),r)}if(ae(t)||V(t))return null!==l?null:f(e,n,t,r,null)
wa(e,t)}return null}function h(e,n,t,r,l){if("string"==typeof r&&""!==r||"number"==typeof r)return i(n,e=e.get(t)||null,""+r,l)
if("object"==typeof r&&null!==r){switch(r.$$typeof){case C:return s(n,e=e.get(null===r.key?t:r.key)||null,r,l)
case _:return c(n,e=e.get(null===r.key?t:r.key)||null,r,l)
case D:return h(e,n,t,(0,r._init)(r._payload),l)}if(ae(r)||V(r))return f(n,e=e.get(t)||null,r,l,null)
wa(n,r)}return null}return function i(s,c,f,m){if("object"==typeof f&&null!==f&&f.type===N&&null===f.key&&(f=f.props.children),"object"==typeof f&&null!==f){switch(f.$$typeof){case C:e:{for(var g=f.key,v=c;null!==v;){if(v.key===g){if((g=f.type)===N){if(7===v.tag){t(s,v.sibling),(c=l(v,f.props.children)).return=s,s=c
break e}}else if(v.elementType===g||"object"==typeof g&&null!==g&&g.$$typeof===D&&Sa(g)===v.type){t(s,v.sibling),(c=l(v,f.props)).ref=ka(s,v,f),c.return=s,s=c
break e}t(s,v)
break}n(s,v),v=v.sibling}f.type===N?((c=Us(f.props.children,s.mode,m,f.key)).return=s,s=c):((m=Is(f.type,f.key,f.props,null,s.mode,m)).ref=ka(s,c,f),m.return=s,s=m)}return u(s)
case _:e:{for(v=f.key;null!==c;){if(c.key===v){if(4===c.tag&&c.stateNode.containerInfo===f.containerInfo&&c.stateNode.implementation===f.implementation){t(s,c.sibling),(c=l(c,f.children||[])).return=s,s=c
break e}t(s,c)
break}n(s,c),c=c.sibling}(c=Hs(f,s.mode,m)).return=s,s=c}return u(s)
case D:return i(s,c,(v=f._init)(f._payload),m)}if(ae(f))return((l,o,u,i)=>{for(var s=null,c=null,f=o,m=o=0,g=null;null!==f&&m<u.length;m++){f.index>m?(g=f,f=null):g=f.sibling
var v=p(l,f,u[m],i)
if(null===v){null===f&&(f=g)
break}e&&f&&null===v.alternate&&n(l,f),o=a(v,o,m),null===c?s=v:c.sibling=v,c=v,f=g}if(m===u.length)return t(l,f),ia&&ta(l,m),s
if(null===f){for(;m<u.length;m++)null!==(f=d(l,u[m],i))&&(o=a(f,o,m),null===c?s=f:c.sibling=f,c=f)
return ia&&ta(l,m),s}for(f=r(l,f);m<u.length;m++)null!==(g=h(f,l,m,u[m],i))&&(e&&null!==g.alternate&&f.delete(null===g.key?m:g.key),o=a(g,o,m),null===c?s=g:c.sibling=g,c=g)
return e&&f.forEach(e=>n(l,e)),ia&&ta(l,m),s})(s,c,f,m)
if(V(f))return((l,u,i,s)=>{var c=V(i)
if("function"!=typeof c)throw Error(o(150))
if(null==(i=c.call(i)))throw Error(o(151))
for(var f=c=null,m=u,g=u=0,v=null,y=i.next();null!==m&&!y.done;g++,y=i.next()){m.index>g?(v=m,m=null):v=m.sibling
var b=p(l,m,y.value,s)
if(null===b){null===m&&(m=v)
break}e&&m&&null===b.alternate&&n(l,m),u=a(b,u,g),null===f?c=b:f.sibling=b,f=b,m=v}if(y.done)return t(l,m),ia&&ta(l,g),c
if(null===m){for(;!y.done;g++,y=i.next())null!==(y=d(l,y.value,s))&&(u=a(y,u,g),null===f?c=y:f.sibling=y,f=y)
return ia&&ta(l,g),c}for(m=r(l,m);!y.done;g++,y=i.next())null!==(y=h(m,l,g,y.value,s))&&(e&&null!==y.alternate&&m.delete(null===y.key?g:y.key),u=a(y,u,g),null===f?c=y:f.sibling=y,f=y)
return e&&m.forEach(e=>n(l,e)),ia&&ta(l,g),c})(s,c,f,m)
wa(s,f)}return"string"==typeof f&&""!==f||"number"==typeof f?(f=""+f,null!==c&&6===c.tag?(t(s,c.sibling),(c=l(c,f)).return=s,s=c):(t(s,c),(c=As(f,s.mode,m)).return=s,s=c),u(s)):t(s,c)}}var Ea=xa(!0),Ca=xa(!1),_a=Pl(null),Na=null,Pa=null,za=null
function La(){za=Pa=Na=null}function Ta(e){var n=_a.current
zl(_a),e._currentValue=n}function Ma(e,n,t){for(;null!==e;){var r=e.alternate
if((e.childLanes&n)!==n?(e.childLanes|=n,null!==r&&(r.childLanes|=n)):null!==r&&(r.childLanes&n)!==n&&(r.childLanes|=n),e===t)break
e=e.return}}function Fa(e,n){Na=e,za=Pa=null,null!==(e=e.dependencies)&&null!==e.firstContext&&(0!==(e.lanes&n)&&(Su=!0),e.firstContext=null)}function Ra(e){var n=e._currentValue
if(za!==e)if(e={context:e,memoizedValue:n,next:null},null===Pa){if(null===Na)throw Error(o(308))
Pa=e,Na.dependencies={lanes:0,firstContext:e}}else Pa=Pa.next=e
return n}var Oa=null
function Da(e){null===Oa?Oa=[e]:Oa.push(e)}function Ia(e,n,t,r){var l=n.interleaved
return null===l?(t.next=t,Da(n)):(t.next=l.next,l.next=t),n.interleaved=t,Ua(e,r)}function Ua(e,n){e.lanes|=n
var t=e.alternate
for(null!==t&&(t.lanes|=n),t=e,e=e.return;null!==e;)e.childLanes|=n,null!==(t=e.alternate)&&(t.childLanes|=n),t=e,e=e.return
return 3===t.tag?t.stateNode:null}var Va=!1
function Aa(e){e.updateQueue={baseState:e.memoizedState,firstBaseUpdate:null,lastBaseUpdate:null,shared:{pending:null,interleaved:null,lanes:0},effects:null}}function Ha(e,n){e=e.updateQueue,n.updateQueue===e&&(n.updateQueue={baseState:e.baseState,firstBaseUpdate:e.firstBaseUpdate,lastBaseUpdate:e.lastBaseUpdate,shared:e.shared,effects:e.effects})}function Ba(e,n){return{eventTime:e,lane:n,tag:0,payload:null,callback:null,next:null}}function ja(e,n,t){var r=e.updateQueue
if(null===r)return null
if(r=r.shared,2&Ti){var l=r.pending
return null===l?n.next=n:(n.next=l.next,l.next=n),r.pending=n,Ua(e,t)}return null===(l=r.interleaved)?(n.next=n,Da(r)):(n.next=l.next,l.next=n),r.interleaved=n,Ua(e,t)}function Wa(e,n,t){if(null!==(n=n.updateQueue)&&(n=n.shared,4194240&t)){var r=n.lanes
t|=r&=e.pendingLanes,n.lanes=t,xn(e,t)}}function Qa(e,n){var t=e.updateQueue,r=e.alternate
if(null!==r&&t===(r=r.updateQueue)){var l=null,a=null
if(null!==(t=t.firstBaseUpdate)){do{var o={eventTime:t.eventTime,lane:t.lane,tag:t.tag,payload:t.payload,callback:t.callback,next:null}
null===a?l=a=o:a=a.next=o,t=t.next}while(null!==t)
null===a?l=a=n:a=a.next=n}else l=a=n
return t={baseState:r.baseState,firstBaseUpdate:l,lastBaseUpdate:a,shared:r.shared,effects:r.effects},void(e.updateQueue=t)}null===(e=t.lastBaseUpdate)?t.firstBaseUpdate=n:e.next=n,t.lastBaseUpdate=n}function $a(e,n,t,r){var l=e.updateQueue
Va=!1
var a=l.firstBaseUpdate,o=l.lastBaseUpdate,u=l.shared.pending
if(null!==u){l.shared.pending=null
var i=u,s=i.next
i.next=null,null===o?a=s:o.next=s,o=i
var c=e.alternate
null!==c&&(u=(c=c.updateQueue).lastBaseUpdate)!==o&&(null===u?c.firstBaseUpdate=s:u.next=s,c.lastBaseUpdate=i)}if(null!==a){var f=l.baseState
for(o=0,c=s=i=null,u=a;;){var d=u.lane,p=u.eventTime
if((r&d)===d){null!==c&&(c=c.next={eventTime:p,lane:0,tag:u.tag,payload:u.payload,callback:u.callback,next:null})
e:{var h=e,m=u
switch(d=n,p=t,m.tag){case 1:if("function"==typeof(h=m.payload)){f=h.call(p,f,d)
break e}f=h
break e
case 3:h.flags=-65537&h.flags|128
case 0:if(null==(d="function"==typeof(h=m.payload)?h.call(p,f,d):h))break e
f=H({},f,d)
break e
case 2:Va=!0}}null!==u.callback&&0!==u.lane&&(e.flags|=64,null===(d=l.effects)?l.effects=[u]:d.push(u))}else p={eventTime:p,lane:d,tag:u.tag,payload:u.payload,callback:u.callback,next:null},null===c?(s=c=p,i=f):c=c.next=p,o|=d
if(null===(u=u.next)){if(null===(u=l.shared.pending))break
u=(d=u).next,d.next=null,l.lastBaseUpdate=d,l.shared.pending=null}}if(null===c&&(i=f),l.baseState=i,l.firstBaseUpdate=s,l.lastBaseUpdate=c,null!==(n=l.shared.interleaved)){l=n
do{o|=l.lane,l=l.next}while(l!==n)}else null===a&&(l.shared.lanes=0)
Vi|=o,e.lanes=o,e.memoizedState=f}}function Ka(e,n,t){if(e=n.effects,n.effects=null,null!==e)for(n=0;n<e.length;n++){var r=e[n],l=r.callback
if(null!==l){if(r.callback=null,r=t,"function"!=typeof l)throw Error(o(191,l))
l.call(r)}}}var qa={},Ya=Pl(qa),Xa=Pl(qa),Ga=Pl(qa)
function Za(e){if(e===qa)throw Error(o(174))
return e}function Ja(e,n){switch(Ll(Ga,n),Ll(Xa,e),Ll(Ya,qa),e=n.nodeType){case 9:case 11:n=(n=n.documentElement)?n.namespaceURI:de(null,"")
break
default:n=de(n=(e=8===e?n.parentNode:n).namespaceURI||null,e=e.tagName)}zl(Ya),Ll(Ya,n)}function eo(){zl(Ya),zl(Xa),zl(Ga)}function no(e){Za(Ga.current)
var n=Za(Ya.current),t=de(n,e.type)
n!==t&&(Ll(Xa,e),Ll(Ya,t))}function to(e){Xa.current===e&&(zl(Ya),zl(Xa))}var ro=Pl(0)
function lo(e){for(var n=e;null!==n;){if(13===n.tag){var t=n.memoizedState
if(null!==t&&(null===(t=t.dehydrated)||"$?"===t.data||"$!"===t.data))return n}else if(19===n.tag&&void 0!==n.memoizedProps.revealOrder){if(128&n.flags)return n}else if(null!==n.child){n.child.return=n,n=n.child
continue}if(n===e)break
for(;null===n.sibling;){if(null===n.return||n.return===e)return null
n=n.return}n.sibling.return=n.return,n=n.sibling}return null}var ao=[]
function oo(){for(var e=0;e<ao.length;e++)ao[e]._workInProgressVersionPrimary=null
ao.length=0}var uo=E.ReactCurrentDispatcher,io=E.ReactCurrentBatchConfig,so=0,co=null,fo=null,po=null,ho=!1,mo=!1,go=0,vo=0
function yo(){throw Error(o(321))}function bo(e,n){if(null===n)return!1
for(var t=0;t<n.length&&t<e.length;t++)if(!fr(e[t],n[t]))return!1
return!0}function ko(e,n,t,r,l,a){if(so=a,co=n,n.memoizedState=null,n.updateQueue=null,n.lanes=0,uo.current=null===e||null===e.memoizedState?ru:lu,e=t(r,l),mo){a=0
do{if(mo=!1,go=0,25<=a)throw Error(o(301))
a+=1,po=fo=null,n.updateQueue=null,uo.current=au,e=t(r,l)}while(mo)}if(uo.current=tu,n=null!==fo&&null!==fo.next,so=0,po=fo=co=null,ho=!1,n)throw Error(o(300))
return e}function wo(){var e=0!==go
return go=0,e}function So(){var e={memoizedState:null,baseState:null,baseQueue:null,queue:null,next:null}
return null===po?co.memoizedState=po=e:po=po.next=e,po}function xo(){if(null===fo){var e=co.alternate
e=null!==e?e.memoizedState:null}else e=fo.next
var n=null===po?co.memoizedState:po.next
if(null!==n)po=n,fo=e
else{if(null===e)throw Error(o(310))
e={memoizedState:(fo=e).memoizedState,baseState:fo.baseState,baseQueue:fo.baseQueue,queue:fo.queue,next:null},null===po?co.memoizedState=po=e:po=po.next=e}return po}function Eo(e,n){return"function"==typeof n?n(e):n}function Co(e){var n=xo(),t=n.queue
if(null===t)throw Error(o(311))
t.lastRenderedReducer=e
var r=fo,l=r.baseQueue,a=t.pending
if(null!==a){if(null!==l){var u=l.next
l.next=a.next,a.next=u}r.baseQueue=l=a,t.pending=null}if(null!==l){a=l.next,r=r.baseState
var i=u=null,s=null,c=a
do{var f=c.lane
if((so&f)===f)null!==s&&(s=s.next={lane:0,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null}),r=c.hasEagerState?c.eagerState:e(r,c.action)
else{var d={lane:f,action:c.action,hasEagerState:c.hasEagerState,eagerState:c.eagerState,next:null}
null===s?(i=s=d,u=r):s=s.next=d,co.lanes|=f,Vi|=f}c=c.next}while(null!==c&&c!==a)
null===s?u=r:s.next=i,fr(r,n.memoizedState)||(Su=!0),n.memoizedState=r,n.baseState=u,n.baseQueue=s,t.lastRenderedState=r}if(null!==(e=t.interleaved)){l=e
do{a=l.lane,co.lanes|=a,Vi|=a,l=l.next}while(l!==e)}else null===l&&(t.lanes=0)
return[n.memoizedState,t.dispatch]}function _o(e){var n=xo(),t=n.queue
if(null===t)throw Error(o(311))
t.lastRenderedReducer=e
var r=t.dispatch,l=t.pending,a=n.memoizedState
if(null!==l){t.pending=null
var u=l=l.next
do{a=e(a,u.action),u=u.next}while(u!==l)
fr(a,n.memoizedState)||(Su=!0),n.memoizedState=a,null===n.baseQueue&&(n.baseState=a),t.lastRenderedState=a}return[a,r]}function No(){}function Po(e,n){var t=co,r=xo(),l=n(),a=!fr(r.memoizedState,l)
if(a&&(r.memoizedState=l,Su=!0),r=r.queue,Ao(To.bind(null,t,r,e),[e]),r.getSnapshot!==n||a||null!==po&&1&po.memoizedState.tag){if(t.flags|=2048,Oo(9,Lo.bind(null,t,r,l,n),void 0,null),null===Mi)throw Error(o(349))
30&so||zo(t,n,l)}return l}function zo(e,n,t){e.flags|=16384,e={getSnapshot:n,value:t},null===(n=co.updateQueue)?(n={lastEffect:null,stores:null},co.updateQueue=n,n.stores=[e]):null===(t=n.stores)?n.stores=[e]:t.push(e)}function Lo(e,n,t,r){n.value=t,n.getSnapshot=r,Mo(n)&&Fo(e)}function To(e,n,t){return t(()=>{Mo(n)&&Fo(e)})}function Mo(e){var n=e.getSnapshot
e=e.value
try{var t=n()
return!fr(e,t)}catch(r){return!0}}function Fo(e){var n=Ua(e,1)
null!==n&&as(n,e,1,-1)}function Ro(e){var n=So()
return"function"==typeof e&&(e=e()),n.memoizedState=n.baseState=e,e={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:Eo,lastRenderedState:e},n.queue=e,e=e.dispatch=Zo.bind(null,co,e),[n.memoizedState,e]}function Oo(e,n,t,r){return e={tag:e,create:n,destroy:t,deps:r,next:null},null===(n=co.updateQueue)?(n={lastEffect:null,stores:null},co.updateQueue=n,n.lastEffect=e.next=e):null===(t=n.lastEffect)?n.lastEffect=e.next=e:(r=t.next,t.next=e,e.next=r,n.lastEffect=e),e}function Do(){return xo().memoizedState}function Io(e,n,t,r){var l=So()
co.flags|=e,l.memoizedState=Oo(1|n,t,void 0,void 0===r?null:r)}function Uo(e,n,t,r){var l=xo()
r=void 0===r?null:r
var a=void 0
if(null!==fo){var o=fo.memoizedState
if(a=o.destroy,null!==r&&bo(r,o.deps))return void(l.memoizedState=Oo(n,t,a,r))}co.flags|=e,l.memoizedState=Oo(1|n,t,a,r)}function Vo(e,n){return Io(8390656,8,e,n)}function Ao(e,n){return Uo(2048,8,e,n)}function Ho(e,n){return Uo(4,2,e,n)}function Bo(e,n){return Uo(4,4,e,n)}function jo(e,n){return"function"==typeof n?(e=e(),n(e),()=>{n(null)}):null!=n?(e=e(),n.current=e,()=>{n.current=null}):void 0}function Wo(e,n,t){return t=null!=t?t.concat([e]):null,Uo(4,4,jo.bind(null,n,e),t)}function Qo(){}function $o(e,n){var t=xo()
n=void 0===n?null:n
var r=t.memoizedState
return null!==r&&null!==n&&bo(n,r[1])?r[0]:(t.memoizedState=[e,n],e)}function Ko(e,n){var t=xo()
n=void 0===n?null:n
var r=t.memoizedState
return null!==r&&null!==n&&bo(n,r[1])?r[0]:(e=e(),t.memoizedState=[e,n],e)}function qo(e,n,t){return 21&so?(fr(t,n)||(t=kn(),co.lanes|=t,Vi|=t,e.baseState=!0),n):(e.baseState&&(e.baseState=!1,Su=!0),e.memoizedState=t)}function Yo(e,n){var t=En
En=0!==t&&4>t?t:4,e(!0)
var r=io.transition
io.transition={}
try{e(!1),n()}finally{En=t,io.transition=r}}function Xo(){return xo().memoizedState}function Go(e,n,t){var r=ls(e)
t={lane:r,action:t,hasEagerState:!1,eagerState:null,next:null},Jo(e)?eu(n,t):null!==(t=Ia(e,n,t,r))&&(as(t,e,r,rs()),nu(t,n,r))}function Zo(e,n,t){var r=ls(e),l={lane:r,action:t,hasEagerState:!1,eagerState:null,next:null}
if(Jo(e))eu(n,l)
else{var a=e.alternate
if(0===e.lanes&&(null===a||0===a.lanes)&&null!==(a=n.lastRenderedReducer))try{var o=n.lastRenderedState,u=a(o,t)
if(l.hasEagerState=!0,l.eagerState=u,fr(u,o)){var i=n.interleaved
return null===i?(l.next=l,Da(n)):(l.next=i.next,i.next=l),void(n.interleaved=l)}}catch(s){}null!==(t=Ia(e,n,l,r))&&(as(t,e,r,l=rs()),nu(t,n,r))}}function Jo(e){var n=e.alternate
return e===co||null!==n&&n===co}function eu(e,n){mo=ho=!0
var t=e.pending
null===t?n.next=n:(n.next=t.next,t.next=n),e.pending=n}function nu(e,n,t){if(4194240&t){var r=n.lanes
t|=r&=e.pendingLanes,n.lanes=t,xn(e,t)}}var tu={readContext:Ra,useCallback:yo,useContext:yo,useEffect:yo,useImperativeHandle:yo,useInsertionEffect:yo,useLayoutEffect:yo,useMemo:yo,useReducer:yo,useRef:yo,useState:yo,useDebugValue:yo,useDeferredValue:yo,useTransition:yo,useMutableSource:yo,useSyncExternalStore:yo,useId:yo,unstable_isNewReconciler:!1},ru={readContext:Ra,useCallback:(e,n)=>(So().memoizedState=[e,void 0===n?null:n],e),useContext:Ra,useEffect:Vo,useImperativeHandle:(e,n,t)=>(t=null!=t?t.concat([e]):null,Io(4194308,4,jo.bind(null,n,e),t)),useLayoutEffect:(e,n)=>Io(4194308,4,e,n),useInsertionEffect:(e,n)=>Io(4,2,e,n),useMemo:(e,n)=>{var t=So()
return n=void 0===n?null:n,e=e(),t.memoizedState=[e,n],e},useReducer:(e,n,t)=>{var r=So()
return n=void 0!==t?t(n):n,r.memoizedState=r.baseState=n,e={pending:null,interleaved:null,lanes:0,dispatch:null,lastRenderedReducer:e,lastRenderedState:n},r.queue=e,e=e.dispatch=Go.bind(null,co,e),[r.memoizedState,e]},useRef:e=>(e={current:e},So().memoizedState=e),useState:Ro,useDebugValue:Qo,useDeferredValue:e=>So().memoizedState=e,useTransition:()=>{var e=Ro(!1),n=e[0]
return e=Yo.bind(null,e[1]),So().memoizedState=e,[n,e]},useMutableSource:()=>{},useSyncExternalStore:(e,n,t)=>{var r=co,l=So()
if(ia){if(void 0===t)throw Error(o(407))
t=t()}else{if(t=n(),null===Mi)throw Error(o(349))
30&so||zo(r,n,t)}l.memoizedState=t
var a={value:t,getSnapshot:n}
return l.queue=a,Vo(To.bind(null,r,a,e),[e]),r.flags|=2048,Oo(9,Lo.bind(null,r,a,t,n),void 0,null),t},useId:()=>{var e=So(),n=Mi.identifierPrefix
if(ia){var t=na
n=":"+n+"R"+(t=(ea&~(1<<32-fn(ea)-1)).toString(32)+t),0<(t=go++)&&(n+="H"+t.toString(32)),n+=":"}else n=":"+n+"r"+(t=vo++).toString(32)+":"
return e.memoizedState=n},unstable_isNewReconciler:!1},lu={readContext:Ra,useCallback:$o,useContext:Ra,useEffect:Ao,useImperativeHandle:Wo,useInsertionEffect:Ho,useLayoutEffect:Bo,useMemo:Ko,useReducer:Co,useRef:Do,useState:()=>Co(Eo),useDebugValue:Qo,useDeferredValue:e=>qo(xo(),fo.memoizedState,e),useTransition:()=>[Co(Eo)[0],xo().memoizedState],useMutableSource:No,useSyncExternalStore:Po,useId:Xo,unstable_isNewReconciler:!1},au={readContext:Ra,useCallback:$o,useContext:Ra,useEffect:Ao,useImperativeHandle:Wo,useInsertionEffect:Ho,useLayoutEffect:Bo,useMemo:Ko,useReducer:_o,useRef:Do,useState:()=>_o(Eo),useDebugValue:Qo,useDeferredValue:e=>{var n=xo()
return null===fo?n.memoizedState=e:qo(n,fo.memoizedState,e)},useTransition:()=>[_o(Eo)[0],xo().memoizedState],useMutableSource:No,useSyncExternalStore:Po,useId:Xo,unstable_isNewReconciler:!1}
function ou(e,n){if(e&&e.defaultProps){for(var t in n=H({},n),e=e.defaultProps)void 0===n[t]&&(n[t]=e[t])
return n}return n}function uu(e,n,t,r){t=null==(t=t(r,n=e.memoizedState))?n:H({},n,t),e.memoizedState=t,0===e.lanes&&(e.updateQueue.baseState=t)}var iu={isMounted:e=>!!(e=e._reactInternals)&&$e(e)===e,enqueueSetState:(e,n,t)=>{e=e._reactInternals
var r=rs(),l=ls(e),a=Ba(r,l)
a.payload=n,null!=t&&(a.callback=t),null!==(n=ja(e,a,l))&&(as(n,e,l,r),Wa(n,e,l))},enqueueReplaceState:(e,n,t)=>{e=e._reactInternals
var r=rs(),l=ls(e),a=Ba(r,l)
a.tag=1,a.payload=n,null!=t&&(a.callback=t),null!==(n=ja(e,a,l))&&(as(n,e,l,r),Wa(n,e,l))},enqueueForceUpdate:(e,n)=>{e=e._reactInternals
var t=rs(),r=ls(e),l=Ba(t,r)
l.tag=2,null!=n&&(l.callback=n),null!==(n=ja(e,l,r))&&(as(n,e,r,t),Wa(n,e,r))}}
function su(e,n,t,r,l,a,o){return"function"==typeof(e=e.stateNode).shouldComponentUpdate?e.shouldComponentUpdate(r,a,o):!(n.prototype&&n.prototype.isPureReactComponent&&dr(t,r)&&dr(l,a))}function cu(e,n,t){var r=!1,l=Tl,a=n.contextType
return"object"==typeof a&&null!==a?a=Ra(a):(l=Dl(n)?Rl:Ml.current,a=(r=null!=(r=n.contextTypes))?Ol(e,l):Tl),n=new n(t,a),e.memoizedState=null!==n.state&&void 0!==n.state?n.state:null,n.updater=iu,e.stateNode=n,n._reactInternals=e,r&&((e=e.stateNode).__reactInternalMemoizedUnmaskedChildContext=l,e.__reactInternalMemoizedMaskedChildContext=a),n}function fu(e,n,t,r){e=n.state,"function"==typeof n.componentWillReceiveProps&&n.componentWillReceiveProps(t,r),"function"==typeof n.UNSAFE_componentWillReceiveProps&&n.UNSAFE_componentWillReceiveProps(t,r),n.state!==e&&iu.enqueueReplaceState(n,n.state,null)}function du(e,n,t,r){var l=e.stateNode
l.props=t,l.state=e.memoizedState,l.refs={},Aa(e)
var a=n.contextType
"object"==typeof a&&null!==a?l.context=Ra(a):(a=Dl(n)?Rl:Ml.current,l.context=Ol(e,a)),l.state=e.memoizedState,"function"==typeof(a=n.getDerivedStateFromProps)&&(uu(e,n,a,t),l.state=e.memoizedState),"function"==typeof n.getDerivedStateFromProps||"function"==typeof l.getSnapshotBeforeUpdate||"function"!=typeof l.UNSAFE_componentWillMount&&"function"!=typeof l.componentWillMount||(n=l.state,"function"==typeof l.componentWillMount&&l.componentWillMount(),"function"==typeof l.UNSAFE_componentWillMount&&l.UNSAFE_componentWillMount(),n!==l.state&&iu.enqueueReplaceState(l,l.state,null),$a(e,t,l,r),l.state=e.memoizedState),"function"==typeof l.componentDidMount&&(e.flags|=4194308)}function pu(e,n){try{var t="",r=n
do{t+=Q(r),r=r.return}while(r)
var l=t}catch(a){l="\nError generating stack: "+a.message+"\n"+a.stack}return{value:e,source:n,stack:l,digest:null}}function hu(e,n,t){return{value:e,source:null,stack:null!=t?t:null,digest:null!=n?n:null}}var mu="function"==typeof WeakMap?WeakMap:Map
function gu(e,n,t){(t=Ba(-1,t)).tag=3,t.payload={element:null}
var r=n.value
return t.callback=()=>{Ki||(Ki=!0,qi=r)},t}function vu(e,n,t){(t=Ba(-1,t)).tag=3
var r=e.type.getDerivedStateFromError
if("function"==typeof r){var l=n.value
t.payload=()=>r(l),t.callback=()=>{}}var a=e.stateNode
return null!==a&&"function"==typeof a.componentDidCatch&&(t.callback=function(){"function"!=typeof r&&(null===Yi?Yi=new Set([this]):Yi.add(this))
var e=n.stack
this.componentDidCatch(n.value,{componentStack:null!==e?e:""})}),t}function yu(e,n,t){var r=e.pingCache
if(null===r){r=e.pingCache=new mu
var l=new Set
r.set(n,l)}else void 0===(l=r.get(n))&&(l=new Set,r.set(n,l))
l.has(t)||(l.add(t),e=Ps.bind(null,e,n,t),n.then(e,e))}function bu(e){do{var n
if((n=13===e.tag)&&(n=null===(n=e.memoizedState)||null!==n.dehydrated),n)return e
e=e.return}while(null!==e)
return null}function ku(e,n,t,r,l){return 1&e.mode?(e.flags|=65536,e.lanes=l,e):(e===n?e.flags|=65536:(e.flags|=128,t.flags|=131072,t.flags&=-52805,1===t.tag&&(null===t.alternate?t.tag=17:((n=Ba(-1,1)).tag=2,ja(t,n,1))),t.lanes|=1),e)}var wu=E.ReactCurrentOwner,Su=!1
function xu(e,n,t,r){n.child=null===e?Ca(n,null,t,r):Ea(n,e.child,t,r)}function Eu(e,n,t,r,l){t=t.render
var a=n.ref
return Fa(n,l),r=ko(e,n,t,r,a,l),t=wo(),null===e||Su?(ia&&t&&la(n),n.flags|=1,xu(e,n,r,l),n.child):(n.updateQueue=e.updateQueue,n.flags&=-2053,e.lanes&=~l,Ku(e,n,l))}function Cu(e,n,t,r,l){if(null===e){var a=t.type
return"function"!=typeof a||Os(a)||void 0!==a.defaultProps||null!==t.compare||void 0!==t.defaultProps?((e=Is(t.type,null,r,n,n.mode,l)).ref=n.ref,e.return=n,n.child=e):(n.tag=15,n.type=a,_u(e,n,a,r,l))}if(a=e.child,0===(e.lanes&l)){var o=a.memoizedProps
if((t=null!==(t=t.compare)?t:dr)(o,r)&&e.ref===n.ref)return Ku(e,n,l)}return n.flags|=1,(e=Ds(a,r)).ref=n.ref,e.return=n,n.child=e}function _u(e,n,t,r,l){if(null!==e){var a=e.memoizedProps
if(dr(a,r)&&e.ref===n.ref){if(Su=!1,n.pendingProps=r=a,0===(e.lanes&l))return n.lanes=e.lanes,Ku(e,n,l)
131072&e.flags&&(Su=!0)}}return zu(e,n,t,r,l)}function Nu(e,n,t){var r=n.pendingProps,l=r.children,a=null!==e?e.memoizedState:null
if("hidden"===r.mode)if(1&n.mode){if(!(1073741824&t))return e=null!==a?a.baseLanes|t:t,n.lanes=n.childLanes=1073741824,n.memoizedState={baseLanes:e,cachePool:null,transitions:null},n.updateQueue=null,Ll(Di,Oi),Oi|=e,null
n.memoizedState={baseLanes:0,cachePool:null,transitions:null},r=null!==a?a.baseLanes:t,Ll(Di,Oi),Oi|=r}else n.memoizedState={baseLanes:0,cachePool:null,transitions:null},Ll(Di,Oi),Oi|=t
else null!==a?(r=a.baseLanes|t,n.memoizedState=null):r=t,Ll(Di,Oi),Oi|=r
return xu(e,n,l,t),n.child}function Pu(e,n){var t=n.ref;(null===e&&null!==t||null!==e&&e.ref!==t)&&(n.flags|=512,n.flags|=2097152)}function zu(e,n,t,r,l){var a=Dl(t)?Rl:Ml.current
return a=Ol(n,a),Fa(n,l),t=ko(e,n,t,r,a,l),r=wo(),null===e||Su?(ia&&r&&la(n),n.flags|=1,xu(e,n,t,l),n.child):(n.updateQueue=e.updateQueue,n.flags&=-2053,e.lanes&=~l,Ku(e,n,l))}function Lu(e,n,t,r,l){if(Dl(t)){var a=!0
Al(n)}else a=!1
if(Fa(n,l),null===n.stateNode)$u(e,n),cu(n,t,r),du(n,t,r,l),r=!0
else if(null===e){var o=n.stateNode,u=n.memoizedProps
o.props=u
var i=o.context,s=t.contextType
s="object"==typeof s&&null!==s?Ra(s):Ol(n,s=Dl(t)?Rl:Ml.current)
var c=t.getDerivedStateFromProps,f="function"==typeof c||"function"==typeof o.getSnapshotBeforeUpdate
f||"function"!=typeof o.UNSAFE_componentWillReceiveProps&&"function"!=typeof o.componentWillReceiveProps||(u!==r||i!==s)&&fu(n,o,r,s),Va=!1
var d=n.memoizedState
o.state=d,$a(n,r,o,l),i=n.memoizedState,u!==r||d!==i||Fl.current||Va?("function"==typeof c&&(uu(n,t,c,r),i=n.memoizedState),(u=Va||su(n,t,u,r,d,i,s))?(f||"function"!=typeof o.UNSAFE_componentWillMount&&"function"!=typeof o.componentWillMount||("function"==typeof o.componentWillMount&&o.componentWillMount(),"function"==typeof o.UNSAFE_componentWillMount&&o.UNSAFE_componentWillMount()),"function"==typeof o.componentDidMount&&(n.flags|=4194308)):("function"==typeof o.componentDidMount&&(n.flags|=4194308),n.memoizedProps=r,n.memoizedState=i),o.props=r,o.state=i,o.context=s,r=u):("function"==typeof o.componentDidMount&&(n.flags|=4194308),r=!1)}else{o=n.stateNode,Ha(e,n),u=n.memoizedProps,s=n.type===n.elementType?u:ou(n.type,u),o.props=s,f=n.pendingProps,d=o.context,i="object"==typeof(i=t.contextType)&&null!==i?Ra(i):Ol(n,i=Dl(t)?Rl:Ml.current)
var p=t.getDerivedStateFromProps;(c="function"==typeof p||"function"==typeof o.getSnapshotBeforeUpdate)||"function"!=typeof o.UNSAFE_componentWillReceiveProps&&"function"!=typeof o.componentWillReceiveProps||(u!==f||d!==i)&&fu(n,o,r,i),Va=!1,d=n.memoizedState,o.state=d,$a(n,r,o,l)
var h=n.memoizedState
u!==f||d!==h||Fl.current||Va?("function"==typeof p&&(uu(n,t,p,r),h=n.memoizedState),(s=Va||su(n,t,s,r,d,h,i)||!1)?(c||"function"!=typeof o.UNSAFE_componentWillUpdate&&"function"!=typeof o.componentWillUpdate||("function"==typeof o.componentWillUpdate&&o.componentWillUpdate(r,h,i),"function"==typeof o.UNSAFE_componentWillUpdate&&o.UNSAFE_componentWillUpdate(r,h,i)),"function"==typeof o.componentDidUpdate&&(n.flags|=4),"function"==typeof o.getSnapshotBeforeUpdate&&(n.flags|=1024)):("function"!=typeof o.componentDidUpdate||u===e.memoizedProps&&d===e.memoizedState||(n.flags|=4),"function"!=typeof o.getSnapshotBeforeUpdate||u===e.memoizedProps&&d===e.memoizedState||(n.flags|=1024),n.memoizedProps=r,n.memoizedState=h),o.props=r,o.state=h,o.context=i,r=s):("function"!=typeof o.componentDidUpdate||u===e.memoizedProps&&d===e.memoizedState||(n.flags|=4),"function"!=typeof o.getSnapshotBeforeUpdate||u===e.memoizedProps&&d===e.memoizedState||(n.flags|=1024),r=!1)}return Tu(e,n,t,r,a,l)}function Tu(e,n,t,r,l,a){Pu(e,n)
var o=!!(128&n.flags)
if(!r&&!o)return l&&Hl(n,t,!1),Ku(e,n,a)
r=n.stateNode,wu.current=n
var u=o&&"function"!=typeof t.getDerivedStateFromError?null:r.render()
return n.flags|=1,null!==e&&o?(n.child=Ea(n,e.child,null,a),n.child=Ea(n,null,u,a)):xu(e,n,u,a),n.memoizedState=r.state,l&&Hl(n,t,!0),n.child}function Mu(e){var n=e.stateNode
n.pendingContext?Ul(0,n.pendingContext,n.pendingContext!==n.context):n.context&&Ul(0,n.context,!1),Ja(e,n.containerInfo)}function Fu(e,n,t,r,l){return va(),ya(l),n.flags|=256,xu(e,n,t,r),n.child}var Ru,Ou,Du,Iu,Uu={dehydrated:null,treeContext:null,retryLane:0}
function Vu(e){return{baseLanes:e,cachePool:null,transitions:null}}function Au(e,n,t){var r,l=n.pendingProps,a=ro.current,u=!1,i=!!(128&n.flags)
if((r=i)||(r=(null===e||null!==e.memoizedState)&&!!(2&a)),r?(u=!0,n.flags&=-129):null!==e&&null===e.memoizedState||(a|=1),Ll(ro,1&a),null===e)return pa(n),null!==(e=n.memoizedState)&&null!==(e=e.dehydrated)?(1&n.mode?"$!"===e.data?n.lanes=8:n.lanes=1073741824:n.lanes=1,null):(i=l.children,e=l.fallback,u?(l=n.mode,u=n.child,i={mode:"hidden",children:i},1&l||null===u?u=Vs(i,l,0,null):(u.childLanes=0,u.pendingProps=i),e=Us(e,l,t,null),u.return=n,e.return=n,u.sibling=e,n.child=u,n.child.memoizedState=Vu(t),n.memoizedState=Uu,e):Hu(n,i))
if(null!==(a=e.memoizedState)&&null!==(r=a.dehydrated))return((e,n,t,r,l,a,u)=>{if(t)return 256&n.flags?(n.flags&=-257,Bu(e,n,u,r=hu(Error(o(422))))):null!==n.memoizedState?(n.child=e.child,n.flags|=128,null):(a=r.fallback,l=n.mode,r=Vs({mode:"visible",children:r.children},l,0,null),(a=Us(a,l,u,null)).flags|=2,r.return=n,a.return=n,r.sibling=a,n.child=r,1&n.mode&&Ea(n,e.child,null,u),n.child.memoizedState=Vu(u),n.memoizedState=Uu,a)
if(!(1&n.mode))return Bu(e,n,u,null)
if("$!"===l.data){if(r=l.nextSibling&&l.nextSibling.dataset)var i=r.dgst
return r=i,Bu(e,n,u,r=hu(a=Error(o(419)),r,void 0))}if(i=0!==(u&e.childLanes),Su||i){if(null!==(r=Mi)){switch(u&-u){case 4:l=2
break
case 16:l=8
break
case 64:case 128:case 256:case 512:case 1024:case 2048:case 4096:case 8192:case 16384:case 32768:case 65536:case 131072:case 262144:case 524288:case 1048576:case 2097152:case 4194304:case 8388608:case 16777216:case 33554432:case 67108864:l=32
break
case 536870912:l=268435456
break
default:l=0}0!==(l=0!==(l&(r.suspendedLanes|u))?0:l)&&l!==a.retryLane&&(a.retryLane=l,Ua(e,l),as(r,e,l,-1))}return ys(),Bu(e,n,u,r=hu(Error(o(421))))}return"$?"===l.data?(n.flags|=128,n.child=e.child,n=Ls.bind(null,e),l._reactRetry=n,null):(e=a.treeContext,ua=pl(l.nextSibling),oa=n,ia=!0,sa=null,null!==e&&(Gl[Zl++]=ea,Gl[Zl++]=na,Gl[Zl++]=Jl,ea=e.id,na=e.overflow,Jl=n),(n=Hu(n,r.children)).flags|=4096,n)})(e,n,i,l,r,a,t)
if(u){u=l.fallback,i=n.mode,r=(a=e.child).sibling
var s={mode:"hidden",children:l.children}
return 1&i||n.child===a?(l=Ds(a,s)).subtreeFlags=14680064&a.subtreeFlags:((l=n.child).childLanes=0,l.pendingProps=s,n.deletions=null),null!==r?u=Ds(r,u):(u=Us(u,i,t,null)).flags|=2,u.return=n,l.return=n,l.sibling=u,n.child=l,l=u,u=n.child,i=null===(i=e.child.memoizedState)?Vu(t):{baseLanes:i.baseLanes|t,cachePool:null,transitions:i.transitions},u.memoizedState=i,u.childLanes=e.childLanes&~t,n.memoizedState=Uu,l}return e=(u=e.child).sibling,l=Ds(u,{mode:"visible",children:l.children}),!(1&n.mode)&&(l.lanes=t),l.return=n,l.sibling=null,null!==e&&(null===(t=n.deletions)?(n.deletions=[e],n.flags|=16):t.push(e)),n.child=l,n.memoizedState=null,l}function Hu(e,n){return(n=Vs({mode:"visible",children:n},e.mode,0,null)).return=e,e.child=n}function Bu(e,n,t,r){return null!==r&&ya(r),Ea(n,e.child,null,t),(e=Hu(n,n.pendingProps.children)).flags|=2,n.memoizedState=null,e}function ju(e,n,t){e.lanes|=n
var r=e.alternate
null!==r&&(r.lanes|=n),Ma(e.return,n,t)}function Wu(e,n,t,r,l){var a=e.memoizedState
null===a?e.memoizedState={isBackwards:n,rendering:null,renderingStartTime:0,last:r,tail:t,tailMode:l}:(a.isBackwards=n,a.rendering=null,a.renderingStartTime=0,a.last=r,a.tail=t,a.tailMode=l)}function Qu(e,n,t){var r=n.pendingProps,l=r.revealOrder,a=r.tail
if(xu(e,n,r.children,t),2&(r=ro.current))r=1&r|2,n.flags|=128
else{if(null!==e&&128&e.flags)e:for(e=n.child;null!==e;){if(13===e.tag)null!==e.memoizedState&&ju(e,t,n)
else if(19===e.tag)ju(e,t,n)
else if(null!==e.child){e.child.return=e,e=e.child
continue}if(e===n)break e
for(;null===e.sibling;){if(null===e.return||e.return===n)break e
e=e.return}e.sibling.return=e.return,e=e.sibling}r&=1}if(Ll(ro,r),1&n.mode)switch(l){case"forwards":for(t=n.child,l=null;null!==t;)null!==(e=t.alternate)&&null===lo(e)&&(l=t),t=t.sibling
null===(t=l)?(l=n.child,n.child=null):(l=t.sibling,t.sibling=null),Wu(n,!1,l,t,a)
break
case"backwards":for(t=null,l=n.child,n.child=null;null!==l;){if(null!==(e=l.alternate)&&null===lo(e)){n.child=l
break}e=l.sibling,l.sibling=t,t=l,l=e}Wu(n,!0,t,null,a)
break
case"together":Wu(n,!1,null,null,void 0)
break
default:n.memoizedState=null}else n.memoizedState=null
return n.child}function $u(e,n){!(1&n.mode)&&null!==e&&(e.alternate=null,n.alternate=null,n.flags|=2)}function Ku(e,n,t){if(null!==e&&(n.dependencies=e.dependencies),Vi|=n.lanes,0===(t&n.childLanes))return null
if(null!==e&&n.child!==e.child)throw Error(o(153))
if(null!==n.child){for(t=Ds(e=n.child,e.pendingProps),n.child=t,t.return=n;null!==e.sibling;)e=e.sibling,(t=t.sibling=Ds(e,e.pendingProps)).return=n
t.sibling=null}return n.child}function qu(e,n){if(!ia)switch(e.tailMode){case"hidden":n=e.tail
for(var t=null;null!==n;)null!==n.alternate&&(t=n),n=n.sibling
null===t?e.tail=null:t.sibling=null
break
case"collapsed":t=e.tail
for(var r=null;null!==t;)null!==t.alternate&&(r=t),t=t.sibling
null===r?n||null===e.tail?e.tail=null:e.tail.sibling=null:r.sibling=null}}function Yu(e){var n=null!==e.alternate&&e.alternate.child===e.child,t=0,r=0
if(n)for(var l=e.child;null!==l;)t|=l.lanes|l.childLanes,r|=14680064&l.subtreeFlags,r|=14680064&l.flags,l.return=e,l=l.sibling
else for(l=e.child;null!==l;)t|=l.lanes|l.childLanes,r|=l.subtreeFlags,r|=l.flags,l.return=e,l=l.sibling
return e.subtreeFlags|=r,e.childLanes=t,n}function Xu(e,n,t){var r=n.pendingProps
switch(aa(n),n.tag){case 2:case 16:case 15:case 0:case 11:case 7:case 8:case 12:case 9:case 14:return Yu(n),null
case 1:case 17:return Dl(n.type)&&Il(),Yu(n),null
case 3:return r=n.stateNode,eo(),zl(Fl),zl(Ml),oo(),r.pendingContext&&(r.context=r.pendingContext,r.pendingContext=null),null!==e&&null!==e.child||(ma(n)?n.flags|=4:null===e||e.memoizedState.isDehydrated&&!(256&n.flags)||(n.flags|=1024,null!==sa&&(ss(sa),sa=null))),Ou(e,n),Yu(n),null
case 5:to(n)
var l=Za(Ga.current)
if(t=n.type,null!==e&&null!=n.stateNode)Du(e,n,t,r,l),e.ref!==n.ref&&(n.flags|=512,n.flags|=2097152)
else{if(!r){if(null===n.stateNode)throw Error(o(166))
return Yu(n),null}if(e=Za(Ya.current),ma(n)){r=n.stateNode,t=n.type
var a=n.memoizedProps
switch(r[gl]=n,r[vl]=a,e=!!(1&n.mode),t){case"dialog":jr("cancel",r),jr("close",r)
break
case"iframe":case"object":case"embed":jr("load",r)
break
case"video":case"audio":for(l=0;l<Vr.length;l++)jr(Vr[l],r)
break
case"source":jr("error",r)
break
case"img":case"image":case"link":jr("error",r),jr("load",r)
break
case"details":jr("toggle",r)
break
case"input":ee(r,a),jr("invalid",r)
break
case"select":r._wrapperState={wasMultiple:!!a.multiple},jr("invalid",r)
break
case"textarea":ie(r,a),jr("invalid",r)}for(var u in Se(t,a),l=null,a)if(a.hasOwnProperty(u)){var i=a[u]
"children"===u?"string"==typeof i?r.textContent!==i&&(!0!==a.suppressHydrationWarning&&tl(r.textContent,i,e),l=["children",i]):"number"==typeof i&&r.textContent!==""+i&&(!0!==a.suppressHydrationWarning&&tl(r.textContent,i,e),l=["children",""+i]):f.hasOwnProperty(u)&&null!=i&&"onScroll"===u&&jr("scroll",r)}switch(t){case"input":X(r),re(r,a,!0)
break
case"textarea":X(r),ce(r)
break
case"select":case"option":break
default:"function"==typeof a.onClick&&(r.onclick=rl)}r=l,n.updateQueue=r,null!==r&&(n.flags|=4)}else{u=9===l.nodeType?l:l.ownerDocument,"http://www.w3.org/1999/xhtml"===e&&(e=fe(t)),"http://www.w3.org/1999/xhtml"===e?"script"===t?((e=u.createElement("div")).innerHTML="<script><\/script>",e=e.removeChild(e.firstChild)):"string"==typeof r.is?e=u.createElement(t,{is:r.is}):(e=u.createElement(t),"select"===t&&(u=e,r.multiple?u.multiple=!0:r.size&&(u.size=r.size))):e=u.createElementNS(e,t),e[gl]=n,e[vl]=r,Ru(e,n,!1,!1),n.stateNode=e
e:{switch(u=xe(t,r),t){case"dialog":jr("cancel",e),jr("close",e),l=r
break
case"iframe":case"object":case"embed":jr("load",e),l=r
break
case"video":case"audio":for(l=0;l<Vr.length;l++)jr(Vr[l],e)
l=r
break
case"source":jr("error",e),l=r
break
case"img":case"image":case"link":jr("error",e),jr("load",e),l=r
break
case"details":jr("toggle",e),l=r
break
case"input":ee(e,r),l=J(e,r),jr("invalid",e)
break
case"option":default:l=r
break
case"select":e._wrapperState={wasMultiple:!!r.multiple},l=H({},r,{value:void 0}),jr("invalid",e)
break
case"textarea":ie(e,r),l=ue(e,r),jr("invalid",e)}for(a in Se(t,l),i=l)if(i.hasOwnProperty(a)){var s=i[a]
"style"===a?ke(e,s):"dangerouslySetInnerHTML"===a?null!=(s=s?s.__html:void 0)&&me(e,s):"children"===a?"string"==typeof s?("textarea"!==t||""!==s)&&ge(e,s):"number"==typeof s&&ge(e,""+s):"suppressContentEditableWarning"!==a&&"suppressHydrationWarning"!==a&&"autoFocus"!==a&&(f.hasOwnProperty(a)?null!=s&&"onScroll"===a&&jr("scroll",e):null!=s&&x(e,a,s,u))}switch(t){case"input":X(e),re(e,r,!1)
break
case"textarea":X(e),ce(e)
break
case"option":null!=r.value&&e.setAttribute("value",""+q(r.value))
break
case"select":e.multiple=!!r.multiple,null!=(a=r.value)?oe(e,!!r.multiple,a,!1):null!=r.defaultValue&&oe(e,!!r.multiple,r.defaultValue,!0)
break
default:"function"==typeof l.onClick&&(e.onclick=rl)}switch(t){case"button":case"input":case"select":case"textarea":r=!!r.autoFocus
break e
case"img":r=!0
break e
default:r=!1}}r&&(n.flags|=4)}null!==n.ref&&(n.flags|=512,n.flags|=2097152)}return Yu(n),null
case 6:if(e&&null!=n.stateNode)Iu(e,n,e.memoizedProps,r)
else{if("string"!=typeof r&&null===n.stateNode)throw Error(o(166))
if(t=Za(Ga.current),Za(Ya.current),ma(n)){if(r=n.stateNode,t=n.memoizedProps,r[gl]=n,(a=r.nodeValue!==t)&&null!==(e=oa))switch(e.tag){case 3:tl(r.nodeValue,t,!!(1&e.mode))
break
case 5:!0!==e.memoizedProps.suppressHydrationWarning&&tl(r.nodeValue,t,!!(1&e.mode))}a&&(n.flags|=4)}else(r=(9===t.nodeType?t:t.ownerDocument).createTextNode(r))[gl]=n,n.stateNode=r}return Yu(n),null
case 13:if(zl(ro),r=n.memoizedState,null===e||null!==e.memoizedState&&null!==e.memoizedState.dehydrated){if(ia&&null!==ua&&1&n.mode&&!(128&n.flags))ga(),va(),n.flags|=98560,a=!1
else if(a=ma(n),null!==r&&null!==r.dehydrated){if(null===e){if(!a)throw Error(o(318))
if(!(a=null!==(a=n.memoizedState)?a.dehydrated:null))throw Error(o(317))
a[gl]=n}else va(),!(128&n.flags)&&(n.memoizedState=null),n.flags|=4
Yu(n),a=!1}else null!==sa&&(ss(sa),sa=null),a=!0
if(!a)return 65536&n.flags?n:null}return 128&n.flags?(n.lanes=t,n):((r=null!==r)!=(null!==e&&null!==e.memoizedState)&&r&&(n.child.flags|=8192,1&n.mode&&(null===e||1&ro.current?0===Ii&&(Ii=3):ys())),null!==n.updateQueue&&(n.flags|=4),Yu(n),null)
case 4:return eo(),Ou(e,n),null===e&&$r(n.stateNode.containerInfo),Yu(n),null
case 10:return Ta(n.type._context),Yu(n),null
case 19:if(zl(ro),null===(a=n.memoizedState))return Yu(n),null
if(r=!!(128&n.flags),null===(u=a.rendering))if(r)qu(a,!1)
else{if(0!==Ii||null!==e&&128&e.flags)for(e=n.child;null!==e;){if(null!==(u=lo(e))){for(n.flags|=128,qu(a,!1),null!==(r=u.updateQueue)&&(n.updateQueue=r,n.flags|=4),n.subtreeFlags=0,r=t,t=n.child;null!==t;)e=r,(a=t).flags&=14680066,null===(u=a.alternate)?(a.childLanes=0,a.lanes=e,a.child=null,a.subtreeFlags=0,a.memoizedProps=null,a.memoizedState=null,a.updateQueue=null,a.dependencies=null,a.stateNode=null):(a.childLanes=u.childLanes,a.lanes=u.lanes,a.child=u.child,a.subtreeFlags=0,a.deletions=null,a.memoizedProps=u.memoizedProps,a.memoizedState=u.memoizedState,a.updateQueue=u.updateQueue,a.type=u.type,e=u.dependencies,a.dependencies=null===e?null:{lanes:e.lanes,firstContext:e.firstContext}),t=t.sibling
return Ll(ro,1&ro.current|2),n.child}e=e.sibling}null!==a.tail&&nn()>Qi&&(n.flags|=128,r=!0,qu(a,!1),n.lanes=4194304)}else{if(!r)if(null!==(e=lo(u))){if(n.flags|=128,r=!0,null!==(t=e.updateQueue)&&(n.updateQueue=t,n.flags|=4),qu(a,!0),null===a.tail&&"hidden"===a.tailMode&&!u.alternate&&!ia)return Yu(n),null}else 2*nn()-a.renderingStartTime>Qi&&1073741824!==t&&(n.flags|=128,r=!0,qu(a,!1),n.lanes=4194304)
a.isBackwards?(u.sibling=n.child,n.child=u):(null!==(t=a.last)?t.sibling=u:n.child=u,a.last=u)}return null!==a.tail?(n=a.tail,a.rendering=n,a.tail=n.sibling,a.renderingStartTime=nn(),n.sibling=null,t=ro.current,Ll(ro,r?1&t|2:1&t),n):(Yu(n),null)
case 22:case 23:return hs(),r=null!==n.memoizedState,null!==e&&null!==e.memoizedState!==r&&(n.flags|=8192),r&&1&n.mode?!!(1073741824&Oi)&&(Yu(n),6&n.subtreeFlags&&(n.flags|=8192)):Yu(n),null
case 24:case 25:return null}throw Error(o(156,n.tag))}function Gu(e,n){switch(aa(n),n.tag){case 1:return Dl(n.type)&&Il(),65536&(e=n.flags)?(n.flags=-65537&e|128,n):null
case 3:return eo(),zl(Fl),zl(Ml),oo(),65536&(e=n.flags)&&!(128&e)?(n.flags=-65537&e|128,n):null
case 5:return to(n),null
case 13:if(zl(ro),null!==(e=n.memoizedState)&&null!==e.dehydrated){if(null===n.alternate)throw Error(o(340))
va()}return 65536&(e=n.flags)?(n.flags=-65537&e|128,n):null
case 19:return zl(ro),null
case 4:return eo(),null
case 10:return Ta(n.type._context),null
case 22:case 23:return hs(),null
default:return null}}Ru=(e,n)=>{for(var t=n.child;null!==t;){if(5===t.tag||6===t.tag)e.appendChild(t.stateNode)
else if(4!==t.tag&&null!==t.child){t.child.return=t,t=t.child
continue}if(t===n)break
for(;null===t.sibling;){if(null===t.return||t.return===n)return
t=t.return}t.sibling.return=t.return,t=t.sibling}},Ou=()=>{},Du=(e,n,t,r)=>{var l=e.memoizedProps
if(l!==r){e=n.stateNode,Za(Ya.current)
var a,o=null
switch(t){case"input":l=J(e,l),r=J(e,r),o=[]
break
case"select":l=H({},l,{value:void 0}),r=H({},r,{value:void 0}),o=[]
break
case"textarea":l=ue(e,l),r=ue(e,r),o=[]
break
default:"function"!=typeof l.onClick&&"function"==typeof r.onClick&&(e.onclick=rl)}for(s in Se(t,r),t=null,l)if(!r.hasOwnProperty(s)&&l.hasOwnProperty(s)&&null!=l[s])if("style"===s){var u=l[s]
for(a in u)u.hasOwnProperty(a)&&(t||(t={}),t[a]="")}else"dangerouslySetInnerHTML"!==s&&"children"!==s&&"suppressContentEditableWarning"!==s&&"suppressHydrationWarning"!==s&&"autoFocus"!==s&&(f.hasOwnProperty(s)?o||(o=[]):(o=o||[]).push(s,null))
for(s in r){var i=r[s]
if(u=null!=l?l[s]:void 0,r.hasOwnProperty(s)&&i!==u&&(null!=i||null!=u))if("style"===s)if(u){for(a in u)!u.hasOwnProperty(a)||i&&i.hasOwnProperty(a)||(t||(t={}),t[a]="")
for(a in i)i.hasOwnProperty(a)&&u[a]!==i[a]&&(t||(t={}),t[a]=i[a])}else t||(o||(o=[]),o.push(s,t)),t=i
else"dangerouslySetInnerHTML"===s?(i=i?i.__html:void 0,u=u?u.__html:void 0,null!=i&&u!==i&&(o=o||[]).push(s,i)):"children"===s?"string"!=typeof i&&"number"!=typeof i||(o=o||[]).push(s,""+i):"suppressContentEditableWarning"!==s&&"suppressHydrationWarning"!==s&&(f.hasOwnProperty(s)?(null!=i&&"onScroll"===s&&jr("scroll",e),o||u===i||(o=[])):(o=o||[]).push(s,i))}t&&(o=o||[]).push("style",t)
var s=o;(n.updateQueue=s)&&(n.flags|=4)}},Iu=(e,n,t,r)=>{t!==r&&(n.flags|=4)}
var Zu=!1,Ju=!1,ei="function"==typeof WeakSet?WeakSet:Set,ni=null
function ti(e,n){var t=e.ref
if(null!==t)if("function"==typeof t)try{t(null)}catch(r){Ns(e,n,r)}else t.current=null}function ri(e,n,t){try{t()}catch(r){Ns(e,n,r)}}var li=!1
function ai(e,n,t){var r=n.updateQueue
if(null!==(r=null!==r?r.lastEffect:null)){var l=r=r.next
do{if((l.tag&e)===e){var a=l.destroy
l.destroy=void 0,void 0!==a&&ri(n,t,a)}l=l.next}while(l!==r)}}function oi(e,n){if(null!==(n=null!==(n=n.updateQueue)?n.lastEffect:null)){var t=n=n.next
do{if((t.tag&e)===e){var r=t.create
t.destroy=r()}t=t.next}while(t!==n)}}function ui(e){var n=e.ref
if(null!==n){var t=e.stateNode
e.tag,e=t,"function"==typeof n?n(e):n.current=e}}function ii(e){var n=e.alternate
null!==n&&(e.alternate=null,ii(n)),e.child=null,e.deletions=null,e.sibling=null,5===e.tag&&null!==(n=e.stateNode)&&(delete n[gl],delete n[vl],delete n[bl],delete n[kl],delete n[wl]),e.stateNode=null,e.return=null,e.dependencies=null,e.memoizedProps=null,e.memoizedState=null,e.pendingProps=null,e.stateNode=null,e.updateQueue=null}function si(e){return 5===e.tag||3===e.tag||4===e.tag}function ci(e){e:for(;;){for(;null===e.sibling;){if(null===e.return||si(e.return))return null
e=e.return}for(e.sibling.return=e.return,e=e.sibling;5!==e.tag&&6!==e.tag&&18!==e.tag;){if(2&e.flags)continue e
if(null===e.child||4===e.tag)continue e
e.child.return=e,e=e.child}if(!(2&e.flags))return e.stateNode}}function fi(e,n,t){var r=e.tag
if(5===r||6===r)e=e.stateNode,n?8===t.nodeType?t.parentNode.insertBefore(e,n):t.insertBefore(e,n):(8===t.nodeType?(n=t.parentNode).insertBefore(e,t):(n=t).appendChild(e),null!=(t=t._reactRootContainer)||null!==n.onclick||(n.onclick=rl))
else if(4!==r&&null!==(e=e.child))for(fi(e,n,t),e=e.sibling;null!==e;)fi(e,n,t),e=e.sibling}function di(e,n,t){var r=e.tag
if(5===r||6===r)e=e.stateNode,n?t.insertBefore(e,n):t.appendChild(e)
else if(4!==r&&null!==(e=e.child))for(di(e,n,t),e=e.sibling;null!==e;)di(e,n,t),e=e.sibling}var pi=null,hi=!1
function mi(e,n,t){for(t=t.child;null!==t;)gi(e,n,t),t=t.sibling}function gi(e,n,t){if(cn&&"function"==typeof cn.onCommitFiberUnmount)try{cn.onCommitFiberUnmount(sn,t)}catch(u){}switch(t.tag){case 5:Ju||ti(t,n)
case 6:var r=pi,l=hi
pi=null,mi(e,n,t),hi=l,null!==(pi=r)&&(hi?(e=pi,t=t.stateNode,8===e.nodeType?e.parentNode.removeChild(t):e.removeChild(t)):pi.removeChild(t.stateNode))
break
case 18:null!==pi&&(hi?(e=pi,t=t.stateNode,8===e.nodeType?dl(e.parentNode,t):1===e.nodeType&&dl(e,t),Kn(e)):dl(pi,t.stateNode))
break
case 4:r=pi,l=hi,pi=t.stateNode.containerInfo,hi=!0,mi(e,n,t),pi=r,hi=l
break
case 0:case 11:case 14:case 15:if(!Ju&&null!==(r=t.updateQueue)&&null!==(r=r.lastEffect)){l=r=r.next
do{var a=l,o=a.destroy
a=a.tag,void 0!==o&&(2&a||4&a)&&ri(t,n,o),l=l.next}while(l!==r)}mi(e,n,t)
break
case 1:if(!Ju&&(ti(t,n),"function"==typeof(r=t.stateNode).componentWillUnmount))try{r.props=t.memoizedProps,r.state=t.memoizedState,r.componentWillUnmount()}catch(u){Ns(t,n,u)}mi(e,n,t)
break
case 21:mi(e,n,t)
break
case 22:1&t.mode?(Ju=(r=Ju)||null!==t.memoizedState,mi(e,n,t),Ju=r):mi(e,n,t)
break
default:mi(e,n,t)}}function vi(e){var n=e.updateQueue
if(null!==n){e.updateQueue=null
var t=e.stateNode
null===t&&(t=e.stateNode=new ei),n.forEach(n=>{var r=Ts.bind(null,e,n)
t.has(n)||(t.add(n),n.then(r,r))})}}function yi(e,n){var t=n.deletions
if(null!==t)for(var r=0;r<t.length;r++){var l=t[r]
try{var a=e,u=n,i=u
e:for(;null!==i;){switch(i.tag){case 5:pi=i.stateNode,hi=!1
break e
case 3:case 4:pi=i.stateNode.containerInfo,hi=!0
break e}i=i.return}if(null===pi)throw Error(o(160))
gi(a,u,l),pi=null,hi=!1
var s=l.alternate
null!==s&&(s.return=null),l.return=null}catch(c){Ns(l,n,c)}}if(12854&n.subtreeFlags)for(n=n.child;null!==n;)bi(n,e),n=n.sibling}function bi(e,n){var t=e.alternate,r=e.flags
switch(e.tag){case 0:case 11:case 14:case 15:if(yi(n,e),ki(e),4&r){try{ai(3,e,e.return),oi(3,e)}catch(g){Ns(e,e.return,g)}try{ai(5,e,e.return)}catch(g){Ns(e,e.return,g)}}break
case 1:yi(n,e),ki(e),512&r&&null!==t&&ti(t,t.return)
break
case 5:if(yi(n,e),ki(e),512&r&&null!==t&&ti(t,t.return),32&e.flags){var l=e.stateNode
try{ge(l,"")}catch(g){Ns(e,e.return,g)}}if(4&r&&null!=(l=e.stateNode)){var a=e.memoizedProps,u=null!==t?t.memoizedProps:a,i=e.type,s=e.updateQueue
if(e.updateQueue=null,null!==s)try{"input"===i&&"radio"===a.type&&null!=a.name&&ne(l,a),xe(i,u)
var c=xe(i,a)
for(u=0;u<s.length;u+=2){var f=s[u],d=s[u+1]
"style"===f?ke(l,d):"dangerouslySetInnerHTML"===f?me(l,d):"children"===f?ge(l,d):x(l,f,d,c)}switch(i){case"input":te(l,a)
break
case"textarea":se(l,a)
break
case"select":var p=l._wrapperState.wasMultiple
l._wrapperState.wasMultiple=!!a.multiple
var h=a.value
null!=h?oe(l,!!a.multiple,h,!1):p!==!!a.multiple&&(null!=a.defaultValue?oe(l,!!a.multiple,a.defaultValue,!0):oe(l,!!a.multiple,a.multiple?[]:"",!1))}l[vl]=a}catch(g){Ns(e,e.return,g)}}break
case 6:if(yi(n,e),ki(e),4&r){if(null===e.stateNode)throw Error(o(162))
l=e.stateNode,a=e.memoizedProps
try{l.nodeValue=a}catch(g){Ns(e,e.return,g)}}break
case 3:if(yi(n,e),ki(e),4&r&&null!==t&&t.memoizedState.isDehydrated)try{Kn(n.containerInfo)}catch(g){Ns(e,e.return,g)}break
case 4:default:yi(n,e),ki(e)
break
case 13:yi(n,e),ki(e),8192&(l=e.child).flags&&(a=null!==l.memoizedState,l.stateNode.isHidden=a,!a||null!==l.alternate&&null!==l.alternate.memoizedState||(Wi=nn())),4&r&&vi(e)
break
case 22:if(f=null!==t&&null!==t.memoizedState,1&e.mode?(Ju=(c=Ju)||f,yi(n,e),Ju=c):yi(n,e),ki(e),8192&r){if(c=null!==e.memoizedState,(e.stateNode.isHidden=c)&&!f&&1&e.mode)for(ni=e,f=e.child;null!==f;){for(d=ni=f;null!==ni;){switch(h=(p=ni).child,p.tag){case 0:case 11:case 14:case 15:ai(4,p,p.return)
break
case 1:ti(p,p.return)
var m=p.stateNode
if("function"==typeof m.componentWillUnmount){r=p,t=p.return
try{n=r,m.props=n.memoizedProps,m.state=n.memoizedState,m.componentWillUnmount()}catch(g){Ns(r,t,g)}}break
case 5:ti(p,p.return)
break
case 22:if(null!==p.memoizedState){Ei(d)
continue}}null!==h?(h.return=p,ni=h):Ei(d)}f=f.sibling}e:for(f=null,d=e;;){if(5===d.tag){if(null===f){f=d
try{l=d.stateNode,c?"function"==typeof(a=l.style).setProperty?a.setProperty("display","none","important"):a.display="none":(i=d.stateNode,u=null!=(s=d.memoizedProps.style)&&s.hasOwnProperty("display")?s.display:null,i.style.display=be("display",u))}catch(g){Ns(e,e.return,g)}}}else if(6===d.tag){if(null===f)try{d.stateNode.nodeValue=c?"":d.memoizedProps}catch(g){Ns(e,e.return,g)}}else if((22!==d.tag&&23!==d.tag||null===d.memoizedState||d===e)&&null!==d.child){d.child.return=d,d=d.child
continue}if(d===e)break e
for(;null===d.sibling;){if(null===d.return||d.return===e)break e
f===d&&(f=null),d=d.return}f===d&&(f=null),d.sibling.return=d.return,d=d.sibling}}break
case 19:yi(n,e),ki(e),4&r&&vi(e)
case 21:}}function ki(e){var n=e.flags
if(2&n){try{e:{for(var t=e.return;null!==t;){if(si(t)){var r=t
break e}t=t.return}throw Error(o(160))}switch(r.tag){case 5:var l=r.stateNode
32&r.flags&&(ge(l,""),r.flags&=-33),di(e,ci(e),l)
break
case 3:case 4:var a=r.stateNode.containerInfo
fi(e,ci(e),a)
break
default:throw Error(o(161))}}catch(u){Ns(e,e.return,u)}e.flags&=-3}4096&n&&(e.flags&=-4097)}function wi(e){ni=e,Si(e)}function Si(e){for(var n=!!(1&e.mode);null!==ni;){var t=ni,r=t.child
if(22===t.tag&&n){var l=null!==t.memoizedState||Zu
if(!l){var a=t.alternate,o=null!==a&&null!==a.memoizedState||Ju
a=Zu
var u=Ju
if(Zu=l,(Ju=o)&&!u)for(ni=t;null!==ni;)o=(l=ni).child,22===l.tag&&null!==l.memoizedState?Ci(t):null!==o?(o.return=l,ni=o):Ci(t)
for(;null!==r;)ni=r,Si(r),r=r.sibling
ni=t,Zu=a,Ju=u}xi(e)}else 8772&t.subtreeFlags&&null!==r?(r.return=t,ni=r):xi(e)}}function xi(e){for(;null!==ni;){var n=ni
if(8772&n.flags){var t=n.alternate
try{if(8772&n.flags)switch(n.tag){case 0:case 11:case 15:Ju||oi(5,n)
break
case 1:var r=n.stateNode
if(4&n.flags&&!Ju)if(null===t)r.componentDidMount()
else{var l=n.elementType===n.type?t.memoizedProps:ou(n.type,t.memoizedProps)
r.componentDidUpdate(l,t.memoizedState,r.__reactInternalSnapshotBeforeUpdate)}var a=n.updateQueue
null!==a&&Ka(n,a,r)
break
case 3:var u=n.updateQueue
if(null!==u){if(t=null,null!==n.child)switch(n.child.tag){case 5:case 1:t=n.child.stateNode}Ka(n,u,t)}break
case 5:var i=n.stateNode
if(null===t&&4&n.flags){t=i
var s=n.memoizedProps
switch(n.type){case"button":case"input":case"select":case"textarea":s.autoFocus&&t.focus()
break
case"img":s.src&&(t.src=s.src)}}break
case 6:case 4:case 12:case 19:case 17:case 21:case 22:case 23:case 25:break
case 13:if(null===n.memoizedState){var c=n.alternate
if(null!==c){var f=c.memoizedState
if(null!==f){var d=f.dehydrated
null!==d&&Kn(d)}}}break
default:throw Error(o(163))}Ju||512&n.flags&&ui(n)}catch(p){Ns(n,n.return,p)}}if(n===e){ni=null
break}if(null!==(t=n.sibling)){t.return=n.return,ni=t
break}ni=n.return}}function Ei(e){for(;null!==ni;){var n=ni
if(n===e){ni=null
break}var t=n.sibling
if(null!==t){t.return=n.return,ni=t
break}ni=n.return}}function Ci(e){for(;null!==ni;){var n=ni
try{switch(n.tag){case 0:case 11:case 15:var t=n.return
try{oi(4,n)}catch(i){Ns(n,t,i)}break
case 1:var r=n.stateNode
if("function"==typeof r.componentDidMount){var l=n.return
try{r.componentDidMount()}catch(i){Ns(n,l,i)}}var a=n.return
try{ui(n)}catch(i){Ns(n,a,i)}break
case 5:var o=n.return
try{ui(n)}catch(i){Ns(n,o,i)}}}catch(i){Ns(n,n.return,i)}if(n===e){ni=null
break}var u=n.sibling
if(null!==u){u.return=n.return,ni=u
break}ni=n.return}}var _i,Ni=Math.ceil,Pi=E.ReactCurrentDispatcher,zi=E.ReactCurrentOwner,Li=E.ReactCurrentBatchConfig,Ti=0,Mi=null,Fi=null,Ri=0,Oi=0,Di=Pl(0),Ii=0,Ui=null,Vi=0,Ai=0,Hi=0,Bi=null,ji=null,Wi=0,Qi=1/0,$i=null,Ki=!1,qi=null,Yi=null,Xi=!1,Gi=null,Zi=0,Ji=0,es=null,ns=-1,ts=0
function rs(){return 6&Ti?nn():-1!==ns?ns:ns=nn()}function ls(e){return 1&e.mode?2&Ti&&0!==Ri?Ri&-Ri:null!==ba.transition?(0===ts&&(ts=kn()),ts):0!==(e=En)?e:e=void 0===(e=window.event)?16:nt(e.type):1}function as(e,n,t,r){if(50<Ji)throw Ji=0,es=null,Error(o(185))
Sn(e,t,r),2&Ti&&e===Mi||(e===Mi&&(!(2&Ti)&&(Ai|=t),4===Ii&&cs(e,Ri)),os(e,r),1===t&&0===Ti&&!(1&n.mode)&&(Qi=nn()+500,jl&&$l()))}function os(e,n){var t=e.callbackNode;((e,n)=>{for(var t=e.suspendedLanes,r=e.pingedLanes,l=e.expirationTimes,a=e.pendingLanes;0<a;){var o=31-fn(a),u=1<<o,i=l[o];-1===i?0!==(u&t)&&0===(u&r)||(l[o]=yn(u,n)):i<=n&&(e.expiredLanes|=u),a&=~u}})(e,n)
var r=vn(e,e===Mi?Ri:0)
if(0===r)null!==t&&Ze(t),e.callbackNode=null,e.callbackPriority=0
else if(n=r&-r,e.callbackPriority!==n){if(null!=t&&Ze(t),1===n)0===e.tag?(e=>{jl=!0,Ql(e)})(fs.bind(null,e)):Ql(fs.bind(null,e)),cl(()=>{!(6&Ti)&&$l()}),t=null
else{switch(Cn(r)){case 1:t=rn
break
case 4:t=ln
break
case 16:default:t=an
break
case 536870912:t=un}t=Ms(t,us.bind(null,e))}e.callbackPriority=n,e.callbackNode=t}}function us(e,n){if(ns=-1,ts=0,6&Ti)throw Error(o(327))
var t=e.callbackNode
if(Cs()&&e.callbackNode!==t)return null
var r=vn(e,e===Mi?Ri:0)
if(0===r)return null
if(30&r||0!==(r&e.expiredLanes)||n)n=bs(e,r)
else{n=r
var l=Ti
Ti|=2
var a=vs()
for(Mi===e&&Ri===n||($i=null,Qi=nn()+500,ms(e,n));;)try{ws()
break}catch(i){gs(e,i)}La(),Pi.current=a,Ti=l,null!==Fi?n=0:(Mi=null,Ri=0,n=Ii)}if(0!==n){if(2===n&&0!==(l=bn(e))&&(r=l,n=is(e,l)),1===n)throw t=Ui,ms(e,0),cs(e,r),os(e,nn()),t
if(6===n)cs(e,r)
else{if(l=e.current.alternate,!(30&r||(e=>{for(var n=e;;){if(16384&n.flags){var t=n.updateQueue
if(null!==t&&null!==(t=t.stores))for(var r=0;r<t.length;r++){var l=t[r],a=l.getSnapshot
l=l.value
try{if(!fr(a(),l))return!1}catch(u){return!1}}}if(t=n.child,16384&n.subtreeFlags&&null!==t)t.return=n,n=t
else{if(n===e)break
for(;null===n.sibling;){if(null===n.return||n.return===e)return!0
n=n.return}n.sibling.return=n.return,n=n.sibling}}return!0})(l)||(n=bs(e,r),2===n&&(a=bn(e),0!==a&&(r=a,n=is(e,a))),1!==n)))throw t=Ui,ms(e,0),cs(e,r),os(e,nn()),t
switch(e.finishedWork=l,e.finishedLanes=r,n){case 0:case 1:throw Error(o(345))
case 2:case 5:Es(e,ji,$i)
break
case 3:if(cs(e,r),(130023424&r)===r&&10<(n=Wi+500-nn())){if(0!==vn(e,0))break
if(((l=e.suspendedLanes)&r)!==r){rs(),e.pingedLanes|=e.suspendedLanes&l
break}e.timeoutHandle=ul(Es.bind(null,e,ji,$i),n)
break}Es(e,ji,$i)
break
case 4:if(cs(e,r),(4194240&r)===r)break
for(n=e.eventTimes,l=-1;0<r;){var u=31-fn(r)
a=1<<u,(u=n[u])>l&&(l=u),r&=~a}if(r=l,10<(r=(120>(r=nn()-r)?120:480>r?480:1080>r?1080:1920>r?1920:3e3>r?3e3:4320>r?4320:1960*Ni(r/1960))-r)){e.timeoutHandle=ul(Es.bind(null,e,ji,$i),r)
break}Es(e,ji,$i)
break
default:throw Error(o(329))}}}return os(e,nn()),e.callbackNode===t?us.bind(null,e):null}function is(e,n){var t=Bi
return e.current.memoizedState.isDehydrated&&(ms(e,n).flags|=256),2!==(e=bs(e,n))&&(n=ji,ji=t,null!==n&&ss(n)),e}function ss(e){null===ji?ji=e:ji.push.apply(ji,e)}function cs(e,n){for(n&=~Hi,n&=~Ai,e.suspendedLanes|=n,e.pingedLanes&=~n,e=e.expirationTimes;0<n;){var t=31-fn(n),r=1<<t
e[t]=-1,n&=~r}}function fs(e){if(6&Ti)throw Error(o(327))
Cs()
var n=vn(e,0)
if(!(1&n))return os(e,nn()),null
var t=bs(e,n)
if(0!==e.tag&&2===t){var r=bn(e)
0!==r&&(n=r,t=is(e,r))}if(1===t)throw t=Ui,ms(e,0),cs(e,n),os(e,nn()),t
if(6===t)throw Error(o(345))
return e.finishedWork=e.current.alternate,e.finishedLanes=n,Es(e,ji,$i),os(e,nn()),null}function ds(e,n){var t=Ti
Ti|=1
try{return e(n)}finally{0===(Ti=t)&&(Qi=nn()+500,jl&&$l())}}function ps(e){null!==Gi&&0===Gi.tag&&!(6&Ti)&&Cs()
var n=Ti
Ti|=1
var t=Li.transition,r=En
try{if(Li.transition=null,En=1,e)return e()}finally{En=r,Li.transition=t,!(6&(Ti=n))&&$l()}}function hs(){Oi=Di.current,zl(Di)}function ms(e,n){e.finishedWork=null,e.finishedLanes=0
var t=e.timeoutHandle
if(-1!==t&&(e.timeoutHandle=-1,il(t)),null!==Fi)for(t=Fi.return;null!==t;){var r=t
switch(aa(r),r.tag){case 1:null!=(r=r.type.childContextTypes)&&Il()
break
case 3:eo(),zl(Fl),zl(Ml),oo()
break
case 5:to(r)
break
case 4:eo()
break
case 13:case 19:zl(ro)
break
case 10:Ta(r.type._context)
break
case 22:case 23:hs()}t=t.return}if(Mi=e,Fi=e=Ds(e.current,null),Ri=Oi=n,Ii=0,Ui=null,Hi=Ai=Vi=0,ji=Bi=null,null!==Oa){for(n=0;n<Oa.length;n++)if(null!==(r=(t=Oa[n]).interleaved)){t.interleaved=null
var l=r.next,a=t.pending
if(null!==a){var o=a.next
a.next=l,r.next=o}t.pending=r}Oa=null}return e}function gs(e,n){for(;;){var t=Fi
try{if(La(),uo.current=tu,ho){for(var r=co.memoizedState;null!==r;){var l=r.queue
null!==l&&(l.pending=null),r=r.next}ho=!1}if(so=0,po=fo=co=null,mo=!1,go=0,zi.current=null,null===t||null===t.return){Ii=1,Ui=n,Fi=null
break}e:{var a=e,u=t.return,i=t,s=n
if(n=Ri,i.flags|=32768,null!==s&&"object"==typeof s&&"function"==typeof s.then){var c=s,f=i,d=f.tag
if(!(1&f.mode||0!==d&&11!==d&&15!==d)){var p=f.alternate
p?(f.updateQueue=p.updateQueue,f.memoizedState=p.memoizedState,f.lanes=p.lanes):(f.updateQueue=null,f.memoizedState=null)}var h=bu(u)
if(null!==h){h.flags&=-257,ku(h,u,i,0,n),1&h.mode&&yu(a,c,n),s=c
var m=(n=h).updateQueue
if(null===m){var g=new Set
g.add(s),n.updateQueue=g}else m.add(s)
break e}if(!(1&n)){yu(a,c,n),ys()
break e}s=Error(o(426))}else if(ia&&1&i.mode){var v=bu(u)
if(null!==v){!(65536&v.flags)&&(v.flags|=256),ku(v,u,i,0,n),ya(pu(s,i))
break e}}a=s=pu(s,i),4!==Ii&&(Ii=2),null===Bi?Bi=[a]:Bi.push(a),a=u
do{switch(a.tag){case 3:a.flags|=65536,n&=-n,a.lanes|=n,Qa(a,gu(0,s,n))
break e
case 1:i=s
var y=a.type,b=a.stateNode
if(!(128&a.flags||"function"!=typeof y.getDerivedStateFromError&&(null===b||"function"!=typeof b.componentDidCatch||null!==Yi&&Yi.has(b)))){a.flags|=65536,n&=-n,a.lanes|=n,Qa(a,vu(a,i,n))
break e}}a=a.return}while(null!==a)}xs(t)}catch(k){n=k,Fi===t&&null!==t&&(Fi=t=t.return)
continue}break}}function vs(){var e=Pi.current
return Pi.current=tu,null===e?tu:e}function ys(){0!==Ii&&3!==Ii&&2!==Ii||(Ii=4),null===Mi||!(268435455&Vi)&&!(268435455&Ai)||cs(Mi,Ri)}function bs(e,n){var t=Ti
Ti|=2
var r=vs()
for(Mi===e&&Ri===n||($i=null,ms(e,n));;)try{ks()
break}catch(l){gs(e,l)}if(La(),Ti=t,Pi.current=r,null!==Fi)throw Error(o(261))
return Mi=null,Ri=0,Ii}function ks(){for(;null!==Fi;)Ss(Fi)}function ws(){for(;null!==Fi&&!Je();)Ss(Fi)}function Ss(e){var n=_i(e.alternate,e,Oi)
e.memoizedProps=e.pendingProps,null===n?xs(e):Fi=n,zi.current=null}function xs(e){var n=e
do{var t=n.alternate
if(e=n.return,32768&n.flags){if(null!==(t=Gu(t,n)))return t.flags&=32767,void(Fi=t)
if(null===e)return Ii=6,void(Fi=null)
e.flags|=32768,e.subtreeFlags=0,e.deletions=null}else if(null!==(t=Xu(t,n,Oi)))return void(Fi=t)
if(null!==(n=n.sibling))return void(Fi=n)
Fi=n=e}while(null!==n)
0===Ii&&(Ii=5)}function Es(e,n,t){var r=En,l=Li.transition
try{Li.transition=null,En=1,((e,n,t,r)=>{do{Cs()}while(null!==Gi)
if(6&Ti)throw Error(o(327))
t=e.finishedWork
var l=e.finishedLanes
if(null===t)return null
if(e.finishedWork=null,e.finishedLanes=0,t===e.current)throw Error(o(177))
e.callbackNode=null,e.callbackPriority=0
var a=t.lanes|t.childLanes
if(((e,n)=>{var t=e.pendingLanes&~n
e.pendingLanes=n,e.suspendedLanes=0,e.pingedLanes=0,e.expiredLanes&=n,e.mutableReadLanes&=n,e.entangledLanes&=n,n=e.entanglements
var r=e.eventTimes
for(e=e.expirationTimes;0<t;){var l=31-fn(t),a=1<<l
n[l]=0,r[l]=-1,e[l]=-1,t&=~a}})(e,a),e===Mi&&(Fi=Mi=null,Ri=0),!(2064&t.subtreeFlags)&&!(2064&t.flags)||Xi||(Xi=!0,Ms(an,()=>(Cs(),null))),a=!!(15990&t.flags),15990&t.subtreeFlags||a){a=Li.transition,Li.transition=null
var u=En
En=1
var i=Ti
Ti|=4,zi.current=null,((e,n)=>{if(ll=Yn,vr(e=gr())){if("selectionStart"in e)var t={start:e.selectionStart,end:e.selectionEnd}
else e:{var r=(t=(t=e.ownerDocument)&&t.defaultView||window).getSelection&&t.getSelection()
if(r&&0!==r.rangeCount){t=r.anchorNode
var l=r.anchorOffset,a=r.focusNode
r=r.focusOffset
try{t.nodeType,a.nodeType}catch(w){t=null
break e}var u=0,i=-1,s=-1,c=0,f=0,d=e,p=null
n:for(;;){for(var h;d!==t||0!==l&&3!==d.nodeType||(i=u+l),d!==a||0!==r&&3!==d.nodeType||(s=u+r),3===d.nodeType&&(u+=d.nodeValue.length),null!==(h=d.firstChild);)p=d,d=h
for(;;){if(d===e)break n
if(p===t&&++c===l&&(i=u),p===a&&++f===r&&(s=u),null!==(h=d.nextSibling))break
p=(d=p).parentNode}d=h}t=-1===i||-1===s?null:{start:i,end:s}}else t=null}t=t||{start:0,end:0}}else t=null
for(al={focusedElem:e,selectionRange:t},Yn=!1,ni=n;null!==ni;)if(e=(n=ni).child,1028&n.subtreeFlags&&null!==e)e.return=n,ni=e
else for(;null!==ni;){n=ni
try{var m=n.alternate
if(1024&n.flags)switch(n.tag){case 0:case 11:case 15:case 5:case 6:case 4:case 17:break
case 1:if(null!==m){var g=m.memoizedProps,v=m.memoizedState,y=n.stateNode,b=y.getSnapshotBeforeUpdate(n.elementType===n.type?g:ou(n.type,g),v)
y.__reactInternalSnapshotBeforeUpdate=b}break
case 3:var k=n.stateNode.containerInfo
1===k.nodeType?k.textContent="":9===k.nodeType&&k.documentElement&&k.removeChild(k.documentElement)
break
default:throw Error(o(163))}}catch(w){Ns(n,n.return,w)}if(null!==(e=n.sibling)){e.return=n.return,ni=e
break}ni=n.return}m=li,li=!1})(e,t),bi(t,e),yr(al),Yn=!!ll,al=ll=null,e.current=t,wi(t),en(),Ti=i,En=u,Li.transition=a}else e.current=t
if(Xi&&(Xi=!1,Gi=e,Zi=l),0===(a=e.pendingLanes)&&(Yi=null),(e=>{if(cn&&"function"==typeof cn.onCommitFiberRoot)try{cn.onCommitFiberRoot(sn,e,void 0,!(128&~e.current.flags))}catch(n){}})(t.stateNode),os(e,nn()),null!==n)for(r=e.onRecoverableError,t=0;t<n.length;t++)r((l=n[t]).value,{componentStack:l.stack,digest:l.digest})
if(Ki)throw Ki=!1,e=qi,qi=null,e
!!(1&Zi)&&0!==e.tag&&Cs(),1&(a=e.pendingLanes)?e===es?Ji++:(Ji=0,es=e):Ji=0,$l()})(e,n,t,r)}finally{Li.transition=l,En=r}return null}function Cs(){if(null!==Gi){var e=Cn(Zi),n=Li.transition,t=En
try{if(Li.transition=null,En=16>e?16:e,null===Gi)var r=!1
else{if(e=Gi,Gi=null,Zi=0,6&Ti)throw Error(o(331))
var l=Ti
for(Ti|=4,ni=e.current;null!==ni;){var a=ni,u=a.child
if(16&ni.flags){var i=a.deletions
if(null!==i){for(var s=0;s<i.length;s++){var c=i[s]
for(ni=c;null!==ni;){var f=ni
switch(f.tag){case 0:case 11:case 15:ai(8,f,a)}var d=f.child
if(null!==d)d.return=f,ni=d
else for(;null!==ni;){var p=(f=ni).sibling,h=f.return
if(ii(f),f===c){ni=null
break}if(null!==p){p.return=h,ni=p
break}ni=h}}}var m=a.alternate
if(null!==m){var g=m.child
if(null!==g){m.child=null
do{var v=g.sibling
g.sibling=null,g=v}while(null!==g)}}ni=a}}if(2064&a.subtreeFlags&&null!==u)u.return=a,ni=u
else e:for(;null!==ni;){if(2048&(a=ni).flags)switch(a.tag){case 0:case 11:case 15:ai(9,a,a.return)}var y=a.sibling
if(null!==y){y.return=a.return,ni=y
break e}ni=a.return}}var b=e.current
for(ni=b;null!==ni;){var k=(u=ni).child
if(2064&u.subtreeFlags&&null!==k)k.return=u,ni=k
else e:for(u=b;null!==ni;){if(2048&(i=ni).flags)try{switch(i.tag){case 0:case 11:case 15:oi(9,i)}}catch(S){Ns(i,i.return,S)}if(i===u){ni=null
break e}var w=i.sibling
if(null!==w){w.return=i.return,ni=w
break e}ni=i.return}}if(Ti=l,$l(),cn&&"function"==typeof cn.onPostCommitFiberRoot)try{cn.onPostCommitFiberRoot(sn,e)}catch(S){}r=!0}return r}finally{En=t,Li.transition=n}}return!1}function _s(e,n,t){e=ja(e,n=gu(0,n=pu(t,n),1),1),n=rs(),null!==e&&(Sn(e,1,n),os(e,n))}function Ns(e,n,t){if(3===e.tag)_s(e,e,t)
else for(;null!==n;){if(3===n.tag){_s(n,e,t)
break}if(1===n.tag){var r=n.stateNode
if("function"==typeof n.type.getDerivedStateFromError||"function"==typeof r.componentDidCatch&&(null===Yi||!Yi.has(r))){n=ja(n,e=vu(n,e=pu(t,e),1),1),e=rs(),null!==n&&(Sn(n,1,e),os(n,e))
break}}n=n.return}}function Ps(e,n,t){var r=e.pingCache
null!==r&&r.delete(n),n=rs(),e.pingedLanes|=e.suspendedLanes&t,Mi===e&&(Ri&t)===t&&(4===Ii||3===Ii&&(130023424&Ri)===Ri&&500>nn()-Wi?ms(e,0):Hi|=t),os(e,n)}function zs(e,n){0===n&&(1&e.mode?(n=mn,!(130023424&(mn<<=1))&&(mn=4194304)):n=1)
var t=rs()
null!==(e=Ua(e,n))&&(Sn(e,n,t),os(e,t))}function Ls(e){var n=e.memoizedState,t=0
null!==n&&(t=n.retryLane),zs(e,t)}function Ts(e,n){var t=0
switch(e.tag){case 13:var r=e.stateNode,l=e.memoizedState
null!==l&&(t=l.retryLane)
break
case 19:r=e.stateNode
break
default:throw Error(o(314))}null!==r&&r.delete(n),zs(e,t)}function Ms(e,n){return Ge(e,n)}function Fs(e,n,t,r){this.tag=e,this.key=t,this.sibling=this.child=this.return=this.stateNode=this.type=this.elementType=null,this.index=0,this.ref=null,this.pendingProps=n,this.dependencies=this.memoizedState=this.updateQueue=this.memoizedProps=null,this.mode=r,this.subtreeFlags=this.flags=0,this.deletions=null,this.childLanes=this.lanes=0,this.alternate=null}function Rs(e,n,t,r){return new Fs(e,n,t,r)}function Os(e){return!(!(e=e.prototype)||!e.isReactComponent)}function Ds(e,n){var t=e.alternate
return null===t?((t=Rs(e.tag,n,e.key,e.mode)).elementType=e.elementType,t.type=e.type,t.stateNode=e.stateNode,t.alternate=e,e.alternate=t):(t.pendingProps=n,t.type=e.type,t.flags=0,t.subtreeFlags=0,t.deletions=null),t.flags=14680064&e.flags,t.childLanes=e.childLanes,t.lanes=e.lanes,t.child=e.child,t.memoizedProps=e.memoizedProps,t.memoizedState=e.memoizedState,t.updateQueue=e.updateQueue,n=e.dependencies,t.dependencies=null===n?null:{lanes:n.lanes,firstContext:n.firstContext},t.sibling=e.sibling,t.index=e.index,t.ref=e.ref,t}function Is(e,n,t,r,l,a){var u=2
if(r=e,"function"==typeof e)Os(e)&&(u=1)
else if("string"==typeof e)u=5
else e:switch(e){case N:return Us(t.children,l,a,n)
case P:u=8,l|=8
break
case z:return(e=Rs(12,t,n,2|l)).elementType=z,e.lanes=a,e
case F:return(e=Rs(13,t,n,l)).elementType=F,e.lanes=a,e
case R:return(e=Rs(19,t,n,l)).elementType=R,e.lanes=a,e
case I:return Vs(t,l,a,n)
default:if("object"==typeof e&&null!==e)switch(e.$$typeof){case L:u=10
break e
case T:u=9
break e
case M:u=11
break e
case O:u=14
break e
case D:u=16,r=null
break e}throw Error(o(130,null==e?e:typeof e,""))}return(n=Rs(u,t,n,l)).elementType=e,n.type=r,n.lanes=a,n}function Us(e,n,t,r){return(e=Rs(7,e,r,n)).lanes=t,e}function Vs(e,n,t,r){return(e=Rs(22,e,r,n)).elementType=I,e.lanes=t,e.stateNode={isHidden:!1},e}function As(e,n,t){return(e=Rs(6,e,null,n)).lanes=t,e}function Hs(e,n,t){return(n=Rs(4,null!==e.children?e.children:[],e.key,n)).lanes=t,n.stateNode={containerInfo:e.containerInfo,pendingChildren:null,implementation:e.implementation},n}function Bs(e,n,t,r,l){this.tag=n,this.containerInfo=e,this.finishedWork=this.pingCache=this.current=this.pendingChildren=null,this.timeoutHandle=-1,this.callbackNode=this.pendingContext=this.context=null,this.callbackPriority=0,this.eventTimes=wn(0),this.expirationTimes=wn(-1),this.entangledLanes=this.finishedLanes=this.mutableReadLanes=this.expiredLanes=this.pingedLanes=this.suspendedLanes=this.pendingLanes=0,this.entanglements=wn(0),this.identifierPrefix=r,this.onRecoverableError=l,this.mutableSourceEagerHydrationData=null}function js(e,n,t,r,l,a,o,u,i){return e=new Bs(e,n,t,u,i),1===n?(n=1,!0===a&&(n|=8)):n=0,a=Rs(3,null,null,n),e.current=a,a.stateNode=e,a.memoizedState={element:r,isDehydrated:t,cache:null,transitions:null,pendingSuspenseBoundaries:null},Aa(a),e}function Ws(e){if(!e)return Tl
e:{if($e(e=e._reactInternals)!==e||1!==e.tag)throw Error(o(170))
var n=e
do{switch(n.tag){case 3:n=n.stateNode.context
break e
case 1:if(Dl(n.type)){n=n.stateNode.__reactInternalMemoizedMergedChildContext
break e}}n=n.return}while(null!==n)
throw Error(o(171))}if(1===e.tag){var t=e.type
if(Dl(t))return Vl(e,t,n)}return n}function Qs(e,n,t,r,l,a,o,u,i){return(e=js(t,r,!0,e,0,a,0,u,i)).context=Ws(null),t=e.current,(a=Ba(r=rs(),l=ls(t))).callback=null!=n?n:null,ja(t,a,l),e.current.lanes=l,Sn(e,l,r),os(e,r),e}function $s(e,n,t,r){var l=n.current,a=rs(),o=ls(l)
return t=Ws(t),null===n.context?n.context=t:n.pendingContext=t,(n=Ba(a,o)).payload={element:e},null!==(r=void 0===r?null:r)&&(n.callback=r),null!==(e=ja(l,n,o))&&(as(e,l,o,a),Wa(e,l,o)),o}function Ks(e){return(e=e.current).child?(e.child.tag,e.child.stateNode):null}function qs(e,n){if(null!==(e=e.memoizedState)&&null!==e.dehydrated){var t=e.retryLane
e.retryLane=0!==t&&t<n?t:n}}function Ys(e,n){qs(e,n),(e=e.alternate)&&qs(e,n)}_i=(e,n,t)=>{if(null!==e)if(e.memoizedProps!==n.pendingProps||Fl.current)Su=!0
else{if(0===(e.lanes&t)&&!(128&n.flags))return Su=!1,((e,n,t)=>{switch(n.tag){case 3:Mu(n),va()
break
case 5:no(n)
break
case 1:Dl(n.type)&&Al(n)
break
case 4:Ja(n,n.stateNode.containerInfo)
break
case 10:var r=n.type._context,l=n.memoizedProps.value
Ll(_a,r._currentValue),r._currentValue=l
break
case 13:if(null!==(r=n.memoizedState))return null!==r.dehydrated?(Ll(ro,1&ro.current),n.flags|=128,null):0!==(t&n.child.childLanes)?Au(e,n,t):(Ll(ro,1&ro.current),null!==(e=Ku(e,n,t))?e.sibling:null)
Ll(ro,1&ro.current)
break
case 19:if(r=0!==(t&n.childLanes),128&e.flags){if(r)return Qu(e,n,t)
n.flags|=128}if(null!==(l=n.memoizedState)&&(l.rendering=null,l.tail=null,l.lastEffect=null),Ll(ro,ro.current),r)break
return null
case 22:case 23:return n.lanes=0,Nu(e,n,t)}return Ku(e,n,t)})(e,n,t)
Su=!!(131072&e.flags)}else Su=!1,ia&&1048576&n.flags&&ra(n,Xl,n.index)
switch(n.lanes=0,n.tag){case 2:var r=n.type
$u(e,n),e=n.pendingProps
var l=Ol(n,Ml.current)
Fa(n,t),l=ko(null,n,r,e,l,t)
var a=wo()
return n.flags|=1,"object"==typeof l&&null!==l&&"function"==typeof l.render&&void 0===l.$$typeof?(n.tag=1,n.memoizedState=null,n.updateQueue=null,Dl(r)?(a=!0,Al(n)):a=!1,n.memoizedState=null!==l.state&&void 0!==l.state?l.state:null,Aa(n),l.updater=iu,n.stateNode=l,l._reactInternals=n,du(n,r,e,t),n=Tu(null,n,r,!0,a,t)):(n.tag=0,ia&&a&&la(n),xu(null,n,l,t),n=n.child),n
case 16:r=n.elementType
e:{switch($u(e,n),e=n.pendingProps,r=(l=r._init)(r._payload),n.type=r,l=n.tag=(e=>{if("function"==typeof e)return Os(e)?1:0
if(null!=e){if((e=e.$$typeof)===M)return 11
if(e===O)return 14}return 2})(r),e=ou(r,e),l){case 0:n=zu(null,n,r,e,t)
break e
case 1:n=Lu(null,n,r,e,t)
break e
case 11:n=Eu(null,n,r,e,t)
break e
case 14:n=Cu(null,n,r,ou(r.type,e),t)
break e}throw Error(o(306,r,""))}return n
case 0:return r=n.type,l=n.pendingProps,zu(e,n,r,l=n.elementType===r?l:ou(r,l),t)
case 1:return r=n.type,l=n.pendingProps,Lu(e,n,r,l=n.elementType===r?l:ou(r,l),t)
case 3:e:{if(Mu(n),null===e)throw Error(o(387))
r=n.pendingProps,l=(a=n.memoizedState).element,Ha(e,n),$a(n,r,null,t)
var u=n.memoizedState
if(r=u.element,a.isDehydrated){if(a={element:r,isDehydrated:!1,cache:u.cache,pendingSuspenseBoundaries:u.pendingSuspenseBoundaries,transitions:u.transitions},n.updateQueue.baseState=a,n.memoizedState=a,256&n.flags){n=Fu(e,n,r,t,l=pu(Error(o(423)),n))
break e}if(r!==l){n=Fu(e,n,r,t,l=pu(Error(o(424)),n))
break e}for(ua=pl(n.stateNode.containerInfo.firstChild),oa=n,ia=!0,sa=null,t=Ca(n,null,r,t),n.child=t;t;)t.flags=-3&t.flags|4096,t=t.sibling}else{if(va(),r===l){n=Ku(e,n,t)
break e}xu(e,n,r,t)}n=n.child}return n
case 5:return no(n),null===e&&pa(n),r=n.type,l=n.pendingProps,a=null!==e?e.memoizedProps:null,u=l.children,ol(r,l)?u=null:null!==a&&ol(r,a)&&(n.flags|=32),Pu(e,n),xu(e,n,u,t),n.child
case 6:return null===e&&pa(n),null
case 13:return Au(e,n,t)
case 4:return Ja(n,n.stateNode.containerInfo),r=n.pendingProps,null===e?n.child=Ea(n,null,r,t):xu(e,n,r,t),n.child
case 11:return r=n.type,l=n.pendingProps,Eu(e,n,r,l=n.elementType===r?l:ou(r,l),t)
case 7:return xu(e,n,n.pendingProps,t),n.child
case 8:case 12:return xu(e,n,n.pendingProps.children,t),n.child
case 10:e:{if(r=n.type._context,l=n.pendingProps,a=n.memoizedProps,u=l.value,Ll(_a,r._currentValue),r._currentValue=u,null!==a)if(fr(a.value,u)){if(a.children===l.children&&!Fl.current){n=Ku(e,n,t)
break e}}else for(null!==(a=n.child)&&(a.return=n);null!==a;){var i=a.dependencies
if(null!==i){u=a.child
for(var s=i.firstContext;null!==s;){if(s.context===r){if(1===a.tag){(s=Ba(-1,t&-t)).tag=2
var c=a.updateQueue
if(null!==c){var f=(c=c.shared).pending
null===f?s.next=s:(s.next=f.next,f.next=s),c.pending=s}}a.lanes|=t,null!==(s=a.alternate)&&(s.lanes|=t),Ma(a.return,t,n),i.lanes|=t
break}s=s.next}}else if(10===a.tag)u=a.type===n.type?null:a.child
else if(18===a.tag){if(null===(u=a.return))throw Error(o(341))
u.lanes|=t,null!==(i=u.alternate)&&(i.lanes|=t),Ma(u,t,n),u=a.sibling}else u=a.child
if(null!==u)u.return=a
else for(u=a;null!==u;){if(u===n){u=null
break}if(null!==(a=u.sibling)){a.return=u.return,u=a
break}u=u.return}a=u}xu(e,n,l.children,t),n=n.child}return n
case 9:return l=n.type,r=n.pendingProps.children,Fa(n,t),r=r(l=Ra(l)),n.flags|=1,xu(e,n,r,t),n.child
case 14:return l=ou(r=n.type,n.pendingProps),Cu(e,n,r,l=ou(r.type,l),t)
case 15:return _u(e,n,n.type,n.pendingProps,t)
case 17:return r=n.type,l=n.pendingProps,l=n.elementType===r?l:ou(r,l),$u(e,n),n.tag=1,Dl(r)?(e=!0,Al(n)):e=!1,Fa(n,t),cu(n,r,l),du(n,r,l,t),Tu(null,n,r,!0,e,t)
case 19:return Qu(e,n,t)
case 22:return Nu(e,n,t)}throw Error(o(156,n.tag))}
var Xs="function"==typeof reportError?reportError:()=>{}
function Gs(e){this._internalRoot=e}function Zs(e){this._internalRoot=e}function Js(e){return!(!e||1!==e.nodeType&&9!==e.nodeType&&11!==e.nodeType)}function ec(e){return!(!e||1!==e.nodeType&&9!==e.nodeType&&11!==e.nodeType&&(8!==e.nodeType||" react-mount-point-unstable "!==e.nodeValue))}function nc(){}function tc(e,n,t,r,l){var a=t._reactRootContainer
if(a){var o=a
if("function"==typeof l){var u=l
l=()=>{var e=Ks(o)
u.call(e)}}$s(n,o,e,l)}else o=((e,n,t,r,l)=>{if(l){if("function"==typeof r){var a=r
r=()=>{var e=Ks(o)
a.call(e)}}var o=Qs(n,r,e,0,null,!1,0,"",nc)
return e._reactRootContainer=o,e[yl]=o.current,$r(8===e.nodeType?e.parentNode:e),ps(),o}for(;l=e.lastChild;)e.removeChild(l)
if("function"==typeof r){var u=r
r=()=>{var e=Ks(i)
u.call(e)}}var i=js(e,0,!1,null,0,!1,0,"",nc)
return e._reactRootContainer=i,e[yl]=i.current,$r(8===e.nodeType?e.parentNode:e),ps(()=>{$s(n,i,t,r)}),i})(t,n,e,l,r)
return Ks(o)}Zs.prototype.render=Gs.prototype.render=function(e){var n=this._internalRoot
if(null===n)throw Error(o(409))
$s(e,n,null,null)},Zs.prototype.unmount=Gs.prototype.unmount=function(){var e=this._internalRoot
if(null!==e){this._internalRoot=null
var n=e.containerInfo
ps(()=>{$s(null,e,null,null)}),n[yl]=null}},Zs.prototype.unstable_scheduleHydration=e=>{if(e){var n=zn()
e={blockedOn:null,target:e,priority:n}
for(var t=0;t<Un.length&&0!==n&&n<Un[t].priority;t++);Un.splice(t,0,e),0===t&&Bn(e)}},_n=e=>{switch(e.tag){case 3:var n=e.stateNode
if(n.current.memoizedState.isDehydrated){var t=gn(n.pendingLanes)
0!==t&&(xn(n,1|t),os(n,nn()),!(6&Ti)&&(Qi=nn()+500,$l()))}break
case 13:ps(()=>{var n=Ua(e,1)
if(null!==n){var t=rs()
as(n,e,1,t)}}),Ys(e,1)}},Nn=e=>{if(13===e.tag){var n=Ua(e,134217728)
null!==n&&as(n,e,134217728,rs()),Ys(e,134217728)}},Pn=e=>{if(13===e.tag){var n=ls(e),t=Ua(e,n)
null!==t&&as(t,e,n,rs()),Ys(e,n)}},zn=()=>En,Ln=(e,n)=>{var t=En
try{return En=e,n()}finally{En=t}},_e=(e,n,t)=>{switch(n){case"input":if(te(e,t),n=t.name,"radio"===t.type&&null!=n){for(t=e;t.parentNode;)t=t.parentNode
for(t=t.querySelectorAll("input[name="+JSON.stringify(""+n)+'][type="radio"]'),n=0;n<t.length;n++){var r=t[n]
if(r!==e&&r.form===e.form){var l=Cl(r)
if(!l)throw Error(o(90))
G(r),te(r,l)}}}break
case"textarea":se(e,t)
break
case"select":null!=(n=t.value)&&oe(e,!!t.multiple,n,!1)}},Me=ds,Fe=ps
var rc={usingClientEntryPoint:!1,Events:[xl,El,Cl,Le,Te,ds]},lc={findFiberByHostInstance:Sl,bundleType:0,version:"18.3.1",rendererPackageName:"react-dom"},ac={bundleType:lc.bundleType,version:lc.version,rendererPackageName:lc.rendererPackageName,rendererConfig:lc.rendererConfig,overrideHookState:null,overrideHookStateDeletePath:null,overrideHookStateRenamePath:null,overrideProps:null,overridePropsDeletePath:null,overridePropsRenamePath:null,setErrorHandler:null,setSuspenseHandler:null,scheduleUpdate:null,currentDispatcherRef:E.ReactCurrentDispatcher,findHostInstanceByFiber:e=>null===(e=Ye(e))?null:e.stateNode,findFiberByHostInstance:lc.findFiberByHostInstance||(()=>null),findHostInstancesForRefresh:null,scheduleRefresh:null,scheduleRoot:null,setRefreshHandler:null,getCurrentFiber:null,reconcilerVersion:"18.3.1-next-f1338f8080-20240426"}
if("undefined"!=typeof __REACT_DEVTOOLS_GLOBAL_HOOK__){var oc=__REACT_DEVTOOLS_GLOBAL_HOOK__
if(!oc.isDisabled&&oc.supportsFiber)try{sn=oc.inject(ac),cn=oc}catch(he){}}return i.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED=rc,i.createPortal=function(e,n){var t=2<arguments.length&&void 0!==arguments[2]?arguments[2]:null
if(!Js(n))throw Error(o(200))
return function(e,n,t){var r=3<arguments.length&&void 0!==arguments[3]?arguments[3]:null
return{$$typeof:_,key:null==r?null:""+r,children:e,containerInfo:n,implementation:t}}(e,n,null,t)},i.createRoot=(e,n)=>{if(!Js(e))throw Error(o(299))
var t=!1,r="",l=Xs
return null!=n&&(!0===n.unstable_strictMode&&(t=!0),void 0!==n.identifierPrefix&&(r=n.identifierPrefix),void 0!==n.onRecoverableError&&(l=n.onRecoverableError)),n=js(e,1,!1,null,0,t,0,r,l),e[yl]=n.current,$r(8===e.nodeType?e.parentNode:e),new Gs(n)},i.findDOMNode=e=>{if(null==e)return null
if(1===e.nodeType)return e
var n=e._reactInternals
if(void 0===n){if("function"==typeof e.render)throw Error(o(188))
throw e=Object.keys(e).join(","),Error(o(268,e))}return null===(e=Ye(n))?null:e.stateNode},i.flushSync=e=>ps(e),i.hydrate=(e,n,t)=>{if(!ec(n))throw Error(o(200))
return tc(null,e,n,!0,t)},i.hydrateRoot=(e,n,t)=>{if(!Js(e))throw Error(o(405))
var r=null!=t&&t.hydratedSources||null,l=!1,a="",u=Xs
if(null!=t&&(!0===t.unstable_strictMode&&(l=!0),void 0!==t.identifierPrefix&&(a=t.identifierPrefix),void 0!==t.onRecoverableError&&(u=t.onRecoverableError)),n=Qs(n,null,e,1,null!=t?t:null,l,0,a,u),e[yl]=n.current,$r(e),r)for(e=0;e<r.length;e++)l=(l=(t=r[e])._getVersion)(t._source),null==n.mutableSourceEagerHydrationData?n.mutableSourceEagerHydrationData=[t,l]:n.mutableSourceEagerHydrationData.push(t,l)
return new Zs(n)},i.render=(e,n,t)=>{if(!ec(n))throw Error(o(200))
return tc(null,e,n,!1,t)},i.unmountComponentAtNode=e=>{if(!ec(e))throw Error(o(40))
return!!e._reactRootContainer&&(ps(()=>{tc(null,null,e,!1,()=>{e._reactRootContainer=null,e[yl]=null})}),!0)},i.unstable_batchedUpdates=ds,i.unstable_renderSubtreeIntoContainer=(e,n,t,r)=>{if(!ec(t))throw Error(o(200))
if(null==e||void 0===e._reactInternals)throw Error(o(38))
return tc(e,n,t,!1,r)},i.version="18.3.1-next-f1338f8080-20240426",i}function d(){return o||(o=1,function e(){if("undefined"!=typeof __REACT_DEVTOOLS_GLOBAL_HOOK__&&"function"==typeof __REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE)try{__REACT_DEVTOOLS_GLOBAL_HOOK__.checkDCE(e)}catch(n){}}(),u.exports=f()),u.exports}var p,h,m={exports:{}},g={},v=(h||(h=1,m.exports=(()=>{if(p)return g
p=1
var n=e(),t="function"==typeof Object.is?Object.is:(e,n)=>e===n&&(0!==e||1/e==1/n)||e!=e&&n!=n,r=n.useState,l=n.useEffect,a=n.useLayoutEffect,o=n.useDebugValue
function u(e){var n=e.getSnapshot
e=e.value
try{var r=n()
return!t(e,r)}catch(l){return!0}}var i="undefined"==typeof window||void 0===window.document||void 0===window.document.createElement?(e,n)=>n():(e,n)=>{var t=n(),i=r({inst:{value:t,getSnapshot:n}}),s=i[0].inst,c=i[1]
return a(()=>{s.value=t,s.getSnapshot=n,u(s)&&c({inst:s})},[e,t,n]),l(()=>(u(s)&&c({inst:s}),e(()=>{u(s)&&c({inst:s})})),[e]),o(t),t}
return g.useSyncExternalStore=void 0!==n.useSyncExternalStore?n.useSyncExternalStore:i,g})()),m.exports)
const y=t.useInsertionEffect,b="undefined"!=typeof window&&void 0!==window.document&&void 0!==window.document.createElement?n.useLayoutEffect:n.useEffect,k=y||b,w=e=>{const t=n.useRef([e,(...e)=>t[0](...e)]).current
return k(()=>{t[0]=e}),t[1]},S="pushState",x="replaceState",E=["popstate",S,x,"hashchange"],C=e=>{for(const n of E)addEventListener(n,e)
return()=>{for(const n of E)removeEventListener(n,e)}},_=(e,n)=>v.useSyncExternalStore(C,e,n),N=()=>location.search,P=()=>location.pathname,z=({ssrPath:e}={})=>_(P,null!=e?()=>e:P),L=(e,{replace:n=!1,state:t=null}={})=>history[n?x:S](t,"",e),T=Symbol.for("wouter_v3")
if("undefined"!=typeof history&&void 0===window[T]){for(const e of[S,x]){const n=history[e]
history[e]=function(){const t=n.apply(this,arguments),r=new Event(e)
return r.arguments=arguments,dispatchEvent(r),t}}Object.defineProperty(window,T,{value:!0})}const M=(e="")=>"/"===e?"":e,F=(e="",n)=>((e,n)=>n.toLowerCase().indexOf(e.toLowerCase())?"~"+n:n.slice(e.length)||"/")(R(M(e)),R(n)),R=e=>{try{return decodeURI(e)}catch(n){return e}},O={hook:(e={})=>[z(e),L],searchHook:({ssrSearch:e}={})=>_(N,null!=e?()=>e:N),parser:(e,n)=>{if(e instanceof RegExp)return{keys:!1,pattern:e}
var t,r,l,a,o=[],u="",i=e.split("/")
for(i[0]||i.shift();l=i.shift();)"*"===(t=l[0])?(o.push(t),u+="?"===l[1]?"(?:/(.*))?":"/(.*)"):":"===t?(r=l.indexOf("?",1),a=l.indexOf(".",1),o.push(l.substring(1,~r?r:~a?a:l.length)),u+=~r&&!~a?"(?:/([^/]+?))?":"/([^/]+?)",~a&&(u+=(~r?"?":"")+"\\"+l.substring(a))):u+="/"+l
return{keys:o,pattern:new RegExp("^"+u+(n?"(?=$|/)":"/?$"),"i")}},base:"",ssrPath:void 0,ssrSearch:void 0,ssrContext:void 0,hrefs:e=>e,aroundNav:(e,n,t)=>e(n,t)},D=n.createContext(O),I=()=>n.useContext(D),U={},V=n.createContext(U),A=()=>n.useContext(V),H=e=>{const[n,t]=e.hook(e)
return[F(e.base,n),w((n,r)=>e.aroundNav(t,((e,n)=>"~"===e[0]?e.slice(1):M(n)+e)(n,e.base),r))]},B=()=>H(I()),j=()=>{const e=I()
return n=e.searchHook(e),R("?"===(t=n)[0]?t.slice(1):t)
var n,t},W=(e,n,t,r)=>{const{pattern:l,keys:a}=n instanceof RegExp?{keys:!1,pattern:n}:e(n||"*",r),o=l.exec(t)||[],[u,...i]=o
return void 0!==u?[!0,(()=>{const e=!1!==a?Object.fromEntries(a.map((e,n)=>[e,i[n]])):o.groups
let n={...i}
return e&&Object.assign(n,e),n})(),...r?[u]:[]]:[!1,null]},Q=({children:e,...t})=>{const r=I(),l=t.hook?O:r
let a=l
const[o,u=t.ssrSearch??""]=t.ssrPath?.split("?")??[]
o&&(t.ssrSearch=u,t.ssrPath=o),t.hrefs=t.hrefs??t.hook?.hrefs,t.searchHook=t.searchHook??t.hook?.searchHook
let i=n.useRef({}),s=i.current,c=s
for(let n in l){const e="base"===n?l[n]+(t[n]??""):t[n]??l[n]
s===c&&e!==c[n]&&(i.current=c={...c}),c[n]=e,e===l[n]&&e===a[n]||(a=c)}return n.createElement(D.Provider,{value:a,children:e})},$=({children:e,component:t},r)=>t?n.createElement(t,{params:r}):"function"==typeof e?e(r):e,K=({path:e,nest:t,match:r,...l})=>{const a=I(),[o]=H(a),[u,i,s]=r??W(a.parser,e,o,t),c=(e=>{let t=n.useRef(U)
const r=t.current
return t.current=Object.keys(e).length!==Object.keys(r).length||Object.entries(e).some(([e,n])=>n!==r[e])?e:r})({...A(),...i})
if(!u)return null
const f=s?n.createElement(Q,{base:s},$(l,c)):$(l,c)
return n.createElement(V.Provider,{value:c,children:f})},q=n.forwardRef((e,t)=>{const r=I(),[l,a]=H(r),{to:o="",href:u=o,onClick:i,asChild:s,children:c,className:f,replace:d,state:p,transition:h,...m}=e,g=w(n=>{n.ctrlKey||n.metaKey||n.altKey||n.shiftKey||0!==n.button||(i?.(n),n.defaultPrevented||(n.preventDefault(),a(u,e)))}),v=r.hrefs("~"===u[0]?u.slice(1):r.base+u,r)
return s&&n.isValidElement(c)?n.cloneElement(c,{onClick:g,href:v}):n.createElement("a",{...m,onClick:g,href:v,className:f?.call?f(l===u):f,children:c,ref:t})}),Y=e=>Array.isArray(e)?e.flatMap(e=>Y(e&&e.type===n.Fragment?e.props.children:e)):[e],X=({children:e,location:t})=>{const r=I(),[l]=H(r)
for(const a of Y(e)){let e=0
if(n.isValidElement(a)&&(e=W(r.parser,a.props.path,t||l,a.props.nest))[0])return n.cloneElement(a,{match:e})}return null},G=e=>{const{to:n,href:t=n}=e,r=I(),[,l]=H(r),a=w(()=>l(n||t,e)),{ssrContext:o}=r
return b(()=>{a()},[]),o&&(o.redirectTo=n),null}
export{q as L,Q as R,X as S,K as a,G as b,A as c,j as d,d as r,B as u}
