import{bA as e}from"./index-CYG8yywH.js"
import{g as t,h as r,a as n,f as o}from"./vendor-data-BaHBZjtO.js"
var i,a,l,c,s,u,f,p,h,d,y,v,m,b,g,w,x,O,j,S,P,A,E,M,_,T,k,C,I,D,N,B,R,L,U,z,$,F,q,W,X,H,V,Y,G,K,Z,J,Q,ee,te,re,ne,oe,ie,ae,le,ce,se,ue,fe,pe,he,de,ye,ve,me,be,ge,we,xe,Oe,je,Se,Pe,Ae,Ee,Me,_e,Te,ke,Ce,Ie,De,Ne,Be,Re,Le,Ue,ze,$e,Fe,qe,We,Xe,He,Ve,Ye,Ge,Ke,Ze,Je,Qe,et
function tt(){if(a)return i
a=1
var e=Array.isArray
return i=e}function rt(){if(c)return l
c=1
var e="object"==typeof t&&t&&t.Object===Object&&t
return l=e}function nt(){if(u)return s
u=1
var e=rt(),t="object"==typeof self&&self&&self.Object===Object&&self,r=e||t||Function("return this")()
return s=r}function ot(){if(p)return f
p=1
var e=nt().Symbol
return f=e}function it(){if(b)return m
b=1
var e=ot(),t=(()=>{if(d)return h
d=1
var e=ot(),t=Object.prototype,r=t.hasOwnProperty,n=t.toString,o=e?e.toStringTag:void 0
return h=e=>{var t=r.call(e,o),i=e[o]
try{e[o]=void 0
var a=!0}catch(c){}var l=n.call(e)
return a&&(t?e[o]=i:delete e[o]),l}})(),r=(()=>{if(v)return y
v=1
var e=Object.prototype.toString
return y=t=>e.call(t)})(),n=e?e.toStringTag:void 0
return m=e=>null==e?void 0===e?"[object Undefined]":"[object Null]":n&&n in Object(e)?t(e):r(e)}function at(){return w?g:(w=1,g=e=>null!=e&&"object"==typeof e)}function lt(){if(O)return x
O=1
var e=it(),t=at()
return x=r=>"symbol"==typeof r||t(r)&&"[object Symbol]"==e(r)}function ct(){if(S)return j
S=1
var e=tt(),t=lt(),r=/\.|\[(?:[^[\]]*|(["'])(?:(?!\1)[^\\]|\\.)*?\1)\]/,n=/^\w*$/
return j=(o,i)=>{if(e(o))return!1
var a=typeof o
return!("number"!=a&&"symbol"!=a&&"boolean"!=a&&null!=o&&!t(o))||n.test(o)||!r.test(o)||null!=i&&o in Object(i)}}function st(){return A?P:(A=1,P=e=>{var t=typeof e
return null!=e&&("object"==t||"function"==t)})}function ut(){if(M)return E
M=1
var e=it(),t=st()
return E=r=>{if(!t(r))return!1
var n=e(r)
return"[object Function]"==n||"[object GeneratorFunction]"==n||"[object AsyncFunction]"==n||"[object Proxy]"==n}}function ft(){if(D)return I
D=1
var e=Function.prototype.toString
return I=t=>{if(null!=t){try{return e.call(t)}catch(r){}try{return t+""}catch(r){}}return""}}function pt(){if(z)return U
z=1
var e=(()=>{if(B)return N
B=1
var e=ut(),t=(()=>{if(C)return k
C=1
var e,t=(()=>{if(T)return _
T=1
var e=nt()["__core-js_shared__"]
return _=e})(),r=(e=/[^.]+$/.exec(t&&t.keys&&t.keys.IE_PROTO||""))?"Symbol(src)_1."+e:""
return k=e=>!!r&&r in e})(),r=st(),n=ft(),o=/^\[object .+?Constructor\]$/,i=Function.prototype,a=Object.prototype,l=i.toString,c=a.hasOwnProperty,s=RegExp("^"+l.call(c).replace(/[\\^$.*+?()[\]{}|]/g,"\\$&").replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g,"$1.*?")+"$")
return N=i=>!(!r(i)||t(i))&&(e(i)?s:o).test(n(i))})(),t=L?R:(L=1,R=(e,t)=>null==e?void 0:e[t])
return U=(r,n)=>{var o=t(r,n)
return e(o)?o:void 0}}function ht(){if(F)return $
F=1
var e=pt()(Object,"create")
return $=e}function dt(){return oe?ne:(oe=1,ne=(e,t)=>e===t||e!=e&&t!=t)}function yt(){if(ae)return ie
ae=1
var e=dt()
return ie=(t,r)=>{for(var n=t.length;n--;)if(e(t[n][0],r))return n
return-1}}function vt(){if(ve)return ye
ve=1
var e=re?te:(re=1,te=function(){this.__data__=[],this.size=0}),t=function(){if(ce)return le
ce=1
var e=yt(),t=Array.prototype.splice
return le=function(r){var n=this.__data__,o=e(n,r)
return!(o<0||(o==n.length-1?n.pop():t.call(n,o,1),--this.size,0))}}(),r=function(){if(ue)return se
ue=1
var e=yt()
return se=function(t){var r=this.__data__,n=e(r,t)
return n<0?void 0:r[n][1]}}(),n=function(){if(pe)return fe
pe=1
var e=yt()
return fe=function(t){return e(this.__data__,t)>-1}}(),o=function(){if(de)return he
de=1
var e=yt()
return he=function(t,r){var n=this.__data__,o=e(n,t)
return o<0?(++this.size,n.push([t,r])):n[o][1]=r,this}}()
function i(e){var t=-1,r=null==e?0:e.length
for(this.clear();++t<r;){var n=e[t]
this.set(n[0],n[1])}}return i.prototype.clear=e,i.prototype.delete=t,i.prototype.get=r,i.prototype.has=n,i.prototype.set=o,ye=i}function mt(){if(be)return me
be=1
var e=pt()(nt(),"Map")
return me=e}function bt(){if(Se)return je
Se=1
var e=Oe?xe:(Oe=1,xe=e=>{var t=typeof e
return"string"==t||"number"==t||"symbol"==t||"boolean"==t?"__proto__"!==e:null===e})
return je=(t,r)=>{var n=t.__data__
return e(r)?n["string"==typeof r?"string":"hash"]:n.map}}function gt(){if(De)return Ie
De=1
var e=function(){if(we)return ge
we=1
var e=function(){if(ee)return Q
ee=1
var e=function(){if(W)return q
W=1
var e=ht()
return q=function(){this.__data__=e?e(null):{},this.size=0}}(),t=H?X:(H=1,X=function(e){var t=this.has(e)&&delete this.__data__[e]
return this.size-=t?1:0,t}),r=function(){if(Y)return V
Y=1
var e=ht(),t=Object.prototype.hasOwnProperty
return V=function(r){var n=this.__data__
if(e){var o=n[r]
return"__lodash_hash_undefined__"===o?void 0:o}return t.call(n,r)?n[r]:void 0}}(),n=function(){if(K)return G
K=1
var e=ht(),t=Object.prototype.hasOwnProperty
return G=function(r){var n=this.__data__
return e?void 0!==n[r]:t.call(n,r)}}(),o=function(){if(J)return Z
J=1
var e=ht()
return Z=function(t,r){var n=this.__data__
return this.size+=this.has(t)?0:1,n[t]=e&&void 0===r?"__lodash_hash_undefined__":r,this}}()
function i(e){var t=-1,r=null==e?0:e.length
for(this.clear();++t<r;){var n=e[t]
this.set(n[0],n[1])}}return i.prototype.clear=e,i.prototype.delete=t,i.prototype.get=r,i.prototype.has=n,i.prototype.set=o,Q=i}(),t=vt(),r=mt()
return ge=function(){this.size=0,this.__data__={hash:new e,map:new(r||t),string:new e}}}(),t=function(){if(Ae)return Pe
Ae=1
var e=bt()
return Pe=function(t){var r=e(this,t).delete(t)
return this.size-=r?1:0,r}}(),r=function(){if(Me)return Ee
Me=1
var e=bt()
return Ee=function(t){return e(this,t).get(t)}}(),n=function(){if(Te)return _e
Te=1
var e=bt()
return _e=function(t){return e(this,t).has(t)}}(),o=function(){if(Ce)return ke
Ce=1
var e=bt()
return ke=function(t,r){var n=e(this,t),o=n.size
return n.set(t,r),this.size+=n.size==o?0:1,this}}()
function i(e){var t=-1,r=null==e?0:e.length
for(this.clear();++t<r;){var n=e[t]
this.set(n[0],n[1])}}return i.prototype.clear=e,i.prototype.delete=t,i.prototype.get=r,i.prototype.has=n,i.prototype.set=o,Ie=i}function wt(){if(Be)return Ne
Be=1
var e=gt()
function t(r,n){if("function"!=typeof r||null!=n&&"function"!=typeof n)throw new TypeError("Expected a function")
var o=function(){var e=arguments,t=n?n.apply(this,e):e[0],i=o.cache
if(i.has(t))return i.get(t)
var a=r.apply(this,e)
return o.cache=i.set(t,a)||i,a}
return o.cache=new(t.Cache||e),o}return t.Cache=e,Ne=t}function xt(){return Fe?$e:(Fe=1,$e=(e,t)=>{for(var r=-1,n=null==e?0:e.length,o=Array(n);++r<n;)o[r]=t(e[r],r,e)
return o})}function Ot(){if(He)return Xe
He=1
var e=(()=>{if(We)return qe
We=1
var e=ot(),t=xt(),r=tt(),n=lt(),o=e?e.prototype:void 0,i=o?o.toString:void 0
return qe=function e(o){if("string"==typeof o)return o
if(r(o))return t(o,e)+""
if(n(o))return i?i.call(o):""
var a=o+""
return"0"==a&&1/o==-1/0?"-0":a},qe})()
return Xe=t=>null==t?"":e(t)}function jt(){if(Ye)return Ve
Ye=1
var e=tt(),t=ct(),r=(()=>{if(ze)return Ue
ze=1
var e=(()=>{if(Le)return Re
Le=1
var e=wt()
return Re=t=>{var r=e(t,e=>(500===n.size&&n.clear(),e)),n=r.cache
return r}})(),t=/[^.[\]]+|\[(?:(-?\d+(?:\.\d+)?)|(["'])((?:(?!\2)[^\\]|\\.)*?)\2)\]|(?=(?:\.|\[\])(?:\.|\[\]|$))/g,r=/\\(\\)?/g,n=e(e=>{var n=[]
return 46===e.charCodeAt(0)&&n.push(""),e.replace(t,(e,t,o,i)=>{n.push(o?i.replace(r,"$1"):t||e)}),n})
return Ue=n})(),n=Ot()
return Ve=(o,i)=>e(o)?o:t(o,i)?[o]:r(n(o))}function St(){if(Ke)return Ge
Ke=1
var e=lt()
return Ge=t=>{if("string"==typeof t||e(t))return t
var r=t+""
return"0"==r&&1/t==-1/0?"-0":r}}function Pt(){if(Je)return Ze
Je=1
var e=jt(),t=St()
return Ze=(r,n)=>{for(var o=0,i=(n=e(n,r)).length;null!=r&&o<i;)r=r[t(n[o++])]
return o&&o==i?r:void 0}}function At(){if(et)return Qe
et=1
var e=Pt()
return Qe=(t,r,n)=>{var o=null==t?void 0:e(t,r)
return void 0===o?n:o}}const Et=r(At())
var Mt,_t
const Tt=r(_t?Mt:(_t=1,Mt=e=>null==e))
var kt,Ct
const It=r((()=>{if(Ct)return kt
Ct=1
var e=it(),t=tt(),r=at()
return kt=n=>"string"==typeof n||!t(n)&&r(n)&&"[object String]"==e(n)})()),Dt=r(ut()),Nt=r(st())
var Bt,Rt,Lt,Ut,zt,$t,Ft={exports:{}},qt={},Wt=(Rt||(Rt=1,Ft.exports=(()=>{if(Bt)return qt
Bt=1
var e,t=Symbol.for("react.element"),r=Symbol.for("react.portal"),n=Symbol.for("react.fragment"),o=Symbol.for("react.strict_mode"),i=Symbol.for("react.profiler"),a=Symbol.for("react.provider"),l=Symbol.for("react.context"),c=Symbol.for("react.server_context"),s=Symbol.for("react.forward_ref"),u=Symbol.for("react.suspense"),f=Symbol.for("react.suspense_list"),p=Symbol.for("react.memo"),h=Symbol.for("react.lazy"),d=Symbol.for("react.offscreen")
function y(e){if("object"==typeof e&&null!==e){var d=e.$$typeof
switch(d){case t:switch(e=e.type){case n:case i:case o:case u:case f:return e
default:switch(e=e&&e.$$typeof){case c:case l:case s:case h:case p:case a:return e
default:return d}}case r:return d}}}return e=Symbol.for("react.module.reference"),qt.ContextConsumer=l,qt.ContextProvider=a,qt.Element=t,qt.ForwardRef=s,qt.Fragment=n,qt.Lazy=h,qt.Memo=p,qt.Portal=r,qt.Profiler=i,qt.StrictMode=o,qt.Suspense=u,qt.SuspenseList=f,qt.isAsyncMode=()=>!1,qt.isConcurrentMode=()=>!1,qt.isContextConsumer=e=>y(e)===l,qt.isContextProvider=e=>y(e)===a,qt.isElement=e=>"object"==typeof e&&null!==e&&e.$$typeof===t,qt.isForwardRef=e=>y(e)===s,qt.isFragment=e=>y(e)===n,qt.isLazy=e=>y(e)===h,qt.isMemo=e=>y(e)===p,qt.isPortal=e=>y(e)===r,qt.isProfiler=e=>y(e)===i,qt.isStrictMode=e=>y(e)===o,qt.isSuspense=e=>y(e)===u,qt.isSuspenseList=e=>y(e)===f,qt.isValidElementType=t=>"string"==typeof t||"function"==typeof t||t===n||t===i||t===o||t===u||t===f||t===d||"object"==typeof t&&null!==t&&(t.$$typeof===h||t.$$typeof===p||t.$$typeof===a||t.$$typeof===l||t.$$typeof===s||t.$$typeof===e||void 0!==t.getModuleId),qt.typeOf=y,qt})()),Ft.exports)
function Xt(){if(Ut)return Lt
Ut=1
var e=it(),t=at()
return Lt=r=>"number"==typeof r||t(r)&&"[object Number]"==e(r)}const Ht=r((()=>{if($t)return zt
$t=1
var e=Xt()
return zt=t=>e(t)&&t!=+t})()),Vt=r(Xt())
var Yt=e=>0===e?0:e>0?1:-1,Gt=e=>It(e)&&e.indexOf("%")===e.length-1,Kt=e=>Vt(e)&&!Ht(e),Zt=e=>Kt(e)||It(e),Jt=0,Qt=e=>{var t=++Jt
return"".concat(e||"").concat(t)},er=function(e,t){var r,n=arguments.length>2&&void 0!==arguments[2]?arguments[2]:0,o=arguments.length>3&&void 0!==arguments[3]&&arguments[3]
if(!Kt(e)&&!It(e))return n
if(Gt(e)){var i=e.indexOf("%")
r=t*parseFloat(e.slice(0,i))/100}else r=+e
return Ht(r)&&(r=n),o&&r>t&&(r=t),r},tr=e=>{if(!e)return null
var t=Object.keys(e)
return t&&t.length?e[t[0]]:null},rr=(e,t)=>Kt(e)&&Kt(t)?r=>e+r*(t-e):()=>t
function nr(e,t,r){return e&&e.length?e.find(e=>e&&("function"==typeof t?t(e):Et(e,t))===r):null}var or=(e,t)=>Kt(e)&&Kt(t)?e-t:It(e)&&It(t)?e.localeCompare(t):e instanceof Date&&t instanceof Date?e.getTime()-t.getTime():String(e).localeCompare(String(t))
function ir(e,t){for(var r in e)if({}.hasOwnProperty.call(e,r)&&(!{}.hasOwnProperty.call(t,r)||e[r]!==t[r]))return!1
for(var n in t)if({}.hasOwnProperty.call(t,n)&&!{}.hasOwnProperty.call(e,n))return!1
return!0}function ar(e){return(ar="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}var lr=["aria-activedescendant","aria-atomic","aria-autocomplete","aria-busy","aria-checked","aria-colcount","aria-colindex","aria-colspan","aria-controls","aria-current","aria-describedby","aria-details","aria-disabled","aria-errormessage","aria-expanded","aria-flowto","aria-haspopup","aria-hidden","aria-invalid","aria-keyshortcuts","aria-label","aria-labelledby","aria-level","aria-live","aria-modal","aria-multiline","aria-multiselectable","aria-orientation","aria-owns","aria-placeholder","aria-posinset","aria-pressed","aria-readonly","aria-relevant","aria-required","aria-roledescription","aria-rowcount","aria-rowindex","aria-rowspan","aria-selected","aria-setsize","aria-sort","aria-valuemax","aria-valuemin","aria-valuenow","aria-valuetext","className","color","height","id","lang","max","media","method","min","name","style","target","width","role","tabIndex","accentHeight","accumulate","additive","alignmentBaseline","allowReorder","alphabetic","amplitude","arabicForm","ascent","attributeName","attributeType","autoReverse","azimuth","baseFrequency","baselineShift","baseProfile","bbox","begin","bias","by","calcMode","capHeight","clip","clipPath","clipPathUnits","clipRule","colorInterpolation","colorInterpolationFilters","colorProfile","colorRendering","contentScriptType","contentStyleType","cursor","cx","cy","d","decelerate","descent","diffuseConstant","direction","display","divisor","dominantBaseline","dur","dx","dy","edgeMode","elevation","enableBackground","end","exponent","externalResourcesRequired","fill","fillOpacity","fillRule","filter","filterRes","filterUnits","floodColor","floodOpacity","focusable","fontFamily","fontSize","fontSizeAdjust","fontStretch","fontStyle","fontVariant","fontWeight","format","from","fx","fy","g1","g2","glyphName","glyphOrientationHorizontal","glyphOrientationVertical","glyphRef","gradientTransform","gradientUnits","hanging","horizAdvX","horizOriginX","href","ideographic","imageRendering","in2","in","intercept","k1","k2","k3","k4","k","kernelMatrix","kernelUnitLength","kerning","keyPoints","keySplines","keyTimes","lengthAdjust","letterSpacing","lightingColor","limitingConeAngle","local","markerEnd","markerHeight","markerMid","markerStart","markerUnits","markerWidth","mask","maskContentUnits","maskUnits","mathematical","mode","numOctaves","offset","opacity","operator","order","orient","orientation","origin","overflow","overlinePosition","overlineThickness","paintOrder","panose1","pathLength","patternContentUnits","patternTransform","patternUnits","pointerEvents","pointsAtX","pointsAtY","pointsAtZ","preserveAlpha","preserveAspectRatio","primitiveUnits","r","radius","refX","refY","renderingIntent","repeatCount","repeatDur","requiredExtensions","requiredFeatures","restart","result","rotate","rx","ry","seed","shapeRendering","slope","spacing","specularConstant","specularExponent","speed","spreadMethod","startOffset","stdDeviation","stemh","stemv","stitchTiles","stopColor","stopOpacity","strikethroughPosition","strikethroughThickness","string","stroke","strokeDasharray","strokeDashoffset","strokeLinecap","strokeLinejoin","strokeMiterlimit","strokeOpacity","strokeWidth","surfaceScale","systemLanguage","tableValues","targetX","targetY","textAnchor","textDecoration","textLength","textRendering","to","transform","u1","u2","underlinePosition","underlineThickness","unicode","unicodeBidi","unicodeRange","unitsPerEm","vAlphabetic","values","vectorEffect","version","vertAdvY","vertOriginX","vertOriginY","vHanging","vIdeographic","viewTarget","visibility","vMathematical","widths","wordSpacing","writingMode","x1","x2","x","xChannelSelector","xHeight","xlinkActuate","xlinkArcrole","xlinkHref","xlinkRole","xlinkShow","xlinkTitle","xlinkType","xmlBase","xmlLang","xmlns","xmlnsXlink","xmlSpace","y1","y2","y","yChannelSelector","z","zoomAndPan","ref","key","angle"],cr=["points","pathLength"],sr={svg:["viewBox","children"],polygon:cr,polyline:cr},ur=["dangerouslySetInnerHTML","onCopy","onCopyCapture","onCut","onCutCapture","onPaste","onPasteCapture","onCompositionEnd","onCompositionEndCapture","onCompositionStart","onCompositionStartCapture","onCompositionUpdate","onCompositionUpdateCapture","onFocus","onFocusCapture","onBlur","onBlurCapture","onChange","onChangeCapture","onBeforeInput","onBeforeInputCapture","onInput","onInputCapture","onReset","onResetCapture","onSubmit","onSubmitCapture","onInvalid","onInvalidCapture","onLoad","onLoadCapture","onError","onErrorCapture","onKeyDown","onKeyDownCapture","onKeyPress","onKeyPressCapture","onKeyUp","onKeyUpCapture","onAbort","onAbortCapture","onCanPlay","onCanPlayCapture","onCanPlayThrough","onCanPlayThroughCapture","onDurationChange","onDurationChangeCapture","onEmptied","onEmptiedCapture","onEncrypted","onEncryptedCapture","onEnded","onEndedCapture","onLoadedData","onLoadedDataCapture","onLoadedMetadata","onLoadedMetadataCapture","onLoadStart","onLoadStartCapture","onPause","onPauseCapture","onPlay","onPlayCapture","onPlaying","onPlayingCapture","onProgress","onProgressCapture","onRateChange","onRateChangeCapture","onSeeked","onSeekedCapture","onSeeking","onSeekingCapture","onStalled","onStalledCapture","onSuspend","onSuspendCapture","onTimeUpdate","onTimeUpdateCapture","onVolumeChange","onVolumeChangeCapture","onWaiting","onWaitingCapture","onAuxClick","onAuxClickCapture","onClick","onClickCapture","onContextMenu","onContextMenuCapture","onDoubleClick","onDoubleClickCapture","onDrag","onDragCapture","onDragEnd","onDragEndCapture","onDragEnter","onDragEnterCapture","onDragExit","onDragExitCapture","onDragLeave","onDragLeaveCapture","onDragOver","onDragOverCapture","onDragStart","onDragStartCapture","onDrop","onDropCapture","onMouseDown","onMouseDownCapture","onMouseEnter","onMouseLeave","onMouseMove","onMouseMoveCapture","onMouseOut","onMouseOutCapture","onMouseOver","onMouseOverCapture","onMouseUp","onMouseUpCapture","onSelect","onSelectCapture","onTouchCancel","onTouchCancelCapture","onTouchEnd","onTouchEndCapture","onTouchMove","onTouchMoveCapture","onTouchStart","onTouchStartCapture","onPointerDown","onPointerDownCapture","onPointerMove","onPointerMoveCapture","onPointerUp","onPointerUpCapture","onPointerCancel","onPointerCancelCapture","onPointerEnter","onPointerEnterCapture","onPointerLeave","onPointerLeaveCapture","onPointerOver","onPointerOverCapture","onPointerOut","onPointerOutCapture","onGotPointerCapture","onGotPointerCaptureCapture","onLostPointerCapture","onLostPointerCaptureCapture","onScroll","onScrollCapture","onWheel","onWheelCapture","onAnimationStart","onAnimationStartCapture","onAnimationEnd","onAnimationEndCapture","onAnimationIteration","onAnimationIterationCapture","onTransitionEnd","onTransitionEndCapture"],fr=(e,t)=>{if(!e||"function"==typeof e||"boolean"==typeof e)return null
var r=e
if(n.isValidElement(e)&&(r=e.props),!Nt(r))return null
var o={}
return Object.keys(r).forEach(e=>{ur.includes(e)&&(o[e]=t||(t=>r[e](r,t)))}),o},pr=(e,t,r)=>{if(!Nt(e)||"object"!==ar(e))return null
var n=null
return Object.keys(e).forEach(o=>{var i=e[o]
ur.includes(o)&&"function"==typeof i&&(n||(n={}),n[o]=((e,t,r)=>n=>(e(t,r,n),null))(i,t,r))}),n},hr=["children"],dr=["children"]
function yr(e,t){if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o}function vr(e){return(vr="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}var mr={click:"onClick",mousedown:"onMouseDown",mouseup:"onMouseUp",mouseover:"onMouseOver",mousemove:"onMouseMove",mouseout:"onMouseOut",mouseenter:"onMouseEnter",mouseleave:"onMouseLeave",touchcancel:"onTouchCancel",touchend:"onTouchEnd",touchmove:"onTouchMove",touchstart:"onTouchStart",contextmenu:"onContextMenu",dblclick:"onDoubleClick"},br=e=>"string"==typeof e?e:e?e.displayName||e.name||"Component":"",gr=null,wr=null,xr=function e(t){if(t===gr&&Array.isArray(wr))return wr
var r=[]
return n.Children.forEach(t,t=>{Tt(t)||(Wt.isFragment(t)?r=r.concat(e(t.props.children)):r.push(t))}),wr=r,gr=t,r}
function Or(e,t){var r=[],n=[]
return n=Array.isArray(t)?t.map(e=>br(e)):[br(t)],xr(e).forEach(e=>{var t=Et(e,"type.displayName")||Et(e,"type.name");-1!==n.indexOf(t)&&r.push(e)}),r}function jr(e,t){var r=Or(e,t)
return r&&r[0]}var Sr=e=>{if(!e||!e.props)return!1
var t=e.props,r=t.width,n=t.height
return!(!Kt(r)||r<=0||!Kt(n)||n<=0)},Pr=["a","altGlyph","altGlyphDef","altGlyphItem","animate","animateColor","animateMotion","animateTransform","circle","clipPath","color-profile","cursor","defs","desc","ellipse","feBlend","feColormatrix","feComponentTransfer","feComposite","feConvolveMatrix","feDiffuseLighting","feDisplacementMap","feDistantLight","feFlood","feFuncA","feFuncB","feFuncG","feFuncR","feGaussianBlur","feImage","feMerge","feMergeNode","feMorphology","feOffset","fePointLight","feSpecularLighting","feSpotLight","feTile","feTurbulence","filter","font","font-face","font-face-format","font-face-name","font-face-url","foreignObject","g","glyph","glyphRef","hkern","image","line","lineGradient","marker","mask","metadata","missing-glyph","mpath","path","pattern","polygon","polyline","radialGradient","rect","script","set","stop","style","svg","switch","symbol","text","textPath","title","tref","tspan","use","view","vkern"],Ar=e=>e&&"object"===vr(e)&&"clipDot"in e,Er=(e,t,r)=>{if(!e||"function"==typeof e||"boolean"==typeof e)return null
var o=e
if(n.isValidElement(e)&&(o=e.props),!Nt(o))return null
var i={}
return Object.keys(o).forEach(e=>{var n;((e,t,r,n)=>{var o,i=null!==(o=null==sr?void 0:sr[n])&&void 0!==o?o:[]
return t.startsWith("data-")||!Dt(e)&&(n&&i.includes(t)||lr.includes(t))||r&&ur.includes(t)})(null===(n=o)||void 0===n?void 0:n[e],e,t,r)&&(i[e]=o[e])}),i},Mr=function e(t,r){if(t===r)return!0
var o=n.Children.count(t)
if(o!==n.Children.count(r))return!1
if(0===o)return!0
if(1===o)return _r(Array.isArray(t)?t[0]:t,Array.isArray(r)?r[0]:r)
for(var i=0;i<o;i++){var a=t[i],l=r[i]
if(Array.isArray(a)||Array.isArray(l)){if(!e(a,l))return!1}else if(!_r(a,l))return!1}return!0},_r=(e,t)=>{if(Tt(e)&&Tt(t))return!0
if(!Tt(e)&&!Tt(t)){var r=e.props||{},n=r.children,o=yr(r,hr),i=t.props||{},a=i.children,l=yr(i,dr)
return n&&a?ir(o,l)&&Mr(n,a):!n&&!a&&ir(o,l)}return!1},Tr=(e,t)=>{var r=[],n={}
return xr(e).forEach((e,o)=>{if((e=>e&&e.type&&It(e.type)&&Pr.indexOf(e.type)>=0)(e))r.push(e)
else if(e){var i=br(e.type),a=t[i]||{},l=a.handler,c=a.once
if(l&&(!c||!n[i])){var s=l(e,i,o)
r.push(s),n[i]=!0}}}),r},kr=["children","width","height","viewBox","className","style","title","desc"]
function Cr(){return Cr=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},Cr.apply(this,arguments)}function Ir(t){var r=t.children,n=t.width,i=t.height,a=t.viewBox,l=t.className,c=t.style,s=t.title,u=t.desc,f=((e,t)=>{if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o})(t,kr),p=a||{width:n,height:i,x:0,y:0},h=e("recharts-surface",l)
return o.createElement("svg",Cr({},Er(f,!0,"svg"),{className:h,width:n,height:i,style:c,viewBox:"".concat(p.x," ").concat(p.y," ").concat(p.width," ").concat(p.height)}),o.createElement("title",null,s),o.createElement("desc",null,u),r)}var Dr=["children","className"]
function Nr(){return Nr=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},Nr.apply(this,arguments)}var Br,Rr,Lr,Ur,zr,$r,Fr,qr,Wr,Xr,Hr,Vr,Yr,Gr,Kr,Zr,Jr=o.forwardRef((t,r)=>{var n=t.children,i=t.className,a=((e,t)=>{if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o})(t,Dr),l=e("recharts-layer",i)
return o.createElement("g",Nr({className:l},Er(a,!0),{ref:r}),n)}),Qr=function(){for(var e=arguments.length,t=new Array(e>2?e-2:0),r=2;r<e;r++)t[r-2]=arguments[r]}
function en(){if($r)return zr
$r=1
var e=RegExp("[\\u200d\\ud800-\\udfff\\u0300-\\u036f\\ufe20-\\ufe2f\\u20d0-\\u20ff\\ufe0e\\ufe0f]")
return zr=t=>e.test(t)}const tn=r((()=>{if(Zr)return Kr
Zr=1
var e=(()=>{if(Gr)return Yr
Gr=1
var e=(()=>{if(Ur)return Lr
Ur=1
var e=Rr?Br:(Rr=1,Br=(e,t,r)=>{var n=-1,o=e.length
t<0&&(t=-t>o?0:o+t),(r=r>o?o:r)<0&&(r+=o),o=t>r?0:r-t>>>0,t>>>=0
for(var i=Array(o);++n<o;)i[n]=e[n+t]
return i})
return Lr=(t,r,n)=>{var o=t.length
return n=void 0===n?o:n,!r&&n>=o?t:e(t,r,n)}})(),t=en(),r=(()=>{if(Vr)return Hr
Vr=1
var e=qr?Fr:(qr=1,Fr=e=>e.split("")),t=en(),r=(()=>{if(Xr)return Wr
Xr=1
var e="\\ud800-\\udfff",t="["+e+"]",r="[\\u0300-\\u036f\\ufe20-\\ufe2f\\u20d0-\\u20ff]",n="\\ud83c[\\udffb-\\udfff]",o="[^"+e+"]",i="(?:\\ud83c[\\udde6-\\uddff]){2}",a="[\\ud800-\\udbff][\\udc00-\\udfff]",l="(?:"+r+"|"+n+")?",c="[\\ufe0e\\ufe0f]?",s=c+l+"(?:\\u200d(?:"+[o,i,a].join("|")+")"+c+l+")*",u="(?:"+[o+r+"?",r,i,a,t].join("|")+")",f=RegExp(n+"(?="+n+")|"+u+s,"g")
return Wr=e=>e.match(f)||[]})()
return Hr=n=>t(n)?r(n):e(n)})(),n=Ot()
return Yr=o=>i=>{i=n(i)
var a=t(i)?r(i):void 0,l=a?a[0]:i.charAt(0),c=a?e(a,1).join(""):i.slice(1)
return l[o]()+c}})()("toUpperCase")
return Kr=e})())
function rn(e){return()=>e}const nn=Math.cos,on=Math.sin,an=Math.sqrt,ln=Math.PI,cn=2*ln,sn=Math.PI,un=2*sn,fn=1e-6,pn=un-fn
function hn(e){this._+=e[0]
for(let t=1,r=e.length;t<r;++t)this._+=arguments[t]+e[t]}class dn{constructor(e){this._x0=this._y0=this._x1=this._y1=null,this._="",this._append=null==e?hn:function(e){let t=Math.floor(e)
if(!(t>=0))throw new Error(`invalid digits: ${e}`)
if(t>15)return hn
const r=10**t
return function(e){this._+=e[0]
for(let t=1,n=e.length;t<n;++t)this._+=Math.round(arguments[t]*r)/r+e[t]}}(e)}moveTo(e,t){this._append`M${this._x0=this._x1=+e},${this._y0=this._y1=+t}`}closePath(){null!==this._x1&&(this._x1=this._x0,this._y1=this._y0,this._append`Z`)}lineTo(e,t){this._append`L${this._x1=+e},${this._y1=+t}`}quadraticCurveTo(e,t,r,n){this._append`Q${+e},${+t},${this._x1=+r},${this._y1=+n}`}bezierCurveTo(e,t,r,n,o,i){this._append`C${+e},${+t},${+r},${+n},${this._x1=+o},${this._y1=+i}`}arcTo(e,t,r,n,o){if(e=+e,t=+t,r=+r,n=+n,(o=+o)<0)throw new Error(`negative radius: ${o}`)
let i=this._x1,a=this._y1,l=r-e,c=n-t,s=i-e,u=a-t,f=s*s+u*u
if(null===this._x1)this._append`M${this._x1=e},${this._y1=t}`
else if(f>fn)if(Math.abs(u*l-c*s)>fn&&o){let p=r-i,h=n-a,d=l*l+c*c,y=p*p+h*h,v=Math.sqrt(d),m=Math.sqrt(f),b=o*Math.tan((sn-Math.acos((d+f-y)/(2*v*m)))/2),g=b/m,w=b/v
Math.abs(g-1)>fn&&this._append`L${e+g*s},${t+g*u}`,this._append`A${o},${o},0,0,${+(u*p>s*h)},${this._x1=e+w*l},${this._y1=t+w*c}`}else this._append`L${this._x1=e},${this._y1=t}`}arc(e,t,r,n,o,i){if(e=+e,t=+t,i=!!i,(r=+r)<0)throw new Error(`negative radius: ${r}`)
let a=r*Math.cos(n),l=r*Math.sin(n),c=e+a,s=t+l,u=1^i,f=i?n-o:o-n
null===this._x1?this._append`M${c},${s}`:(Math.abs(this._x1-c)>fn||Math.abs(this._y1-s)>fn)&&this._append`L${c},${s}`,r&&(f<0&&(f=f%un+un),f>pn?this._append`A${r},${r},0,1,${u},${e-a},${t-l}A${r},${r},0,1,${u},${this._x1=c},${this._y1=s}`:f>fn&&this._append`A${r},${r},0,${+(f>=sn)},${u},${this._x1=e+r*Math.cos(o)},${this._y1=t+r*Math.sin(o)}`)}rect(e,t,r,n){this._append`M${this._x0=this._x1=+e},${this._y0=this._y1=+t}h${r=+r}v${+n}h${-r}Z`}toString(){return this._}}function yn(e){let t=3
return e.digits=function(r){if(!arguments.length)return t
if(null==r)t=null
else{const e=Math.floor(r)
if(!(e>=0))throw new RangeError(`invalid digits: ${r}`)
t=e}return e},()=>new dn(t)}function vn(e){return"object"==typeof e&&"length"in e?e:Array.from(e)}function mn(e){this._context=e}function bn(e){return new mn(e)}function gn(e){return e[0]}function wn(e){return e[1]}function xn(e,t){var r=rn(!0),n=null,o=bn,i=null,a=yn(l)
function l(l){var c,s,u,f=(l=vn(l)).length,p=!1
for(null==n&&(i=o(u=a())),c=0;c<=f;++c)!(c<f&&r(s=l[c],c,l))===p&&((p=!p)?i.lineStart():i.lineEnd()),p&&i.point(+e(s,c,l),+t(s,c,l))
if(u)return i=null,u+""||null}return e="function"==typeof e?e:void 0===e?gn:rn(e),t="function"==typeof t?t:void 0===t?wn:rn(t),l.x=function(t){return arguments.length?(e="function"==typeof t?t:rn(+t),l):e},l.y=function(e){return arguments.length?(t="function"==typeof e?e:rn(+e),l):t},l.defined=function(e){return arguments.length?(r="function"==typeof e?e:rn(!!e),l):r},l.curve=function(e){return arguments.length?(o=e,null!=n&&(i=o(n)),l):o},l.context=function(e){return arguments.length?(null==e?n=i=null:i=o(n=e),l):n},l}function On(e,t,r){var n=null,o=rn(!0),i=null,a=bn,l=null,c=yn(s)
function s(s){var u,f,p,h,d,y=(s=vn(s)).length,v=!1,m=new Array(y),b=new Array(y)
for(null==i&&(l=a(d=c())),u=0;u<=y;++u){if(!(u<y&&o(h=s[u],u,s))===v)if(v=!v)f=u,l.areaStart(),l.lineStart()
else{for(l.lineEnd(),l.lineStart(),p=u-1;p>=f;--p)l.point(m[p],b[p])
l.lineEnd(),l.areaEnd()}v&&(m[u]=+e(h,u,s),b[u]=+t(h,u,s),l.point(n?+n(h,u,s):m[u],r?+r(h,u,s):b[u]))}if(d)return l=null,d+""||null}function u(){return xn().defined(o).curve(a).context(i)}return e="function"==typeof e?e:void 0===e?gn:rn(+e),t="function"==typeof t?t:rn(void 0===t?0:+t),r="function"==typeof r?r:void 0===r?wn:rn(+r),s.x=function(t){return arguments.length?(e="function"==typeof t?t:rn(+t),n=null,s):e},s.x0=function(t){return arguments.length?(e="function"==typeof t?t:rn(+t),s):e},s.x1=function(e){return arguments.length?(n=null==e?null:"function"==typeof e?e:rn(+e),s):n},s.y=function(e){return arguments.length?(t="function"==typeof e?e:rn(+e),r=null,s):t},s.y0=function(e){return arguments.length?(t="function"==typeof e?e:rn(+e),s):t},s.y1=function(e){return arguments.length?(r=null==e?null:"function"==typeof e?e:rn(+e),s):r},s.lineX0=s.lineY0=()=>u().x(e).y(t),s.lineY1=()=>u().x(e).y(r),s.lineX1=()=>u().x(n).y(t),s.defined=function(e){return arguments.length?(o="function"==typeof e?e:rn(!!e),s):o},s.curve=function(e){return arguments.length?(a=e,null!=i&&(l=a(i)),s):a},s.context=function(e){return arguments.length?(null==e?i=l=null:l=a(i=e),s):i},s}mn.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._point=0},lineEnd:function(){(this._line||0!==this._line&&1===this._point)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t)
break
case 1:this._point=2
default:this._context.lineTo(e,t)}}}
class jn{constructor(e,t){this._context=e,this._x=t}areaStart(){this._line=0}areaEnd(){this._line=NaN}lineStart(){this._point=0}lineEnd(){(this._line||0!==this._line&&1===this._point)&&this._context.closePath(),this._line=1-this._line}point(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t)
break
case 1:this._point=2
default:this._x?this._context.bezierCurveTo(this._x0=(this._x0+e)/2,this._y0,this._x0,t,e,t):this._context.bezierCurveTo(this._x0,this._y0=(this._y0+t)/2,e,this._y0,e,t)}this._x0=e,this._y0=t}}const Sn={draw(e,t){const r=an(t/ln)
e.moveTo(r,0),e.arc(0,0,r,0,cn)}},Pn={draw(e,t){const r=an(t/5)/2
e.moveTo(-3*r,-r),e.lineTo(-r,-r),e.lineTo(-r,-3*r),e.lineTo(r,-3*r),e.lineTo(r,-r),e.lineTo(3*r,-r),e.lineTo(3*r,r),e.lineTo(r,r),e.lineTo(r,3*r),e.lineTo(-r,3*r),e.lineTo(-r,r),e.lineTo(-3*r,r),e.closePath()}},An=an(1/3),En=2*An,Mn={draw(e,t){const r=an(t/En),n=r*An
e.moveTo(0,-r),e.lineTo(n,0),e.lineTo(0,r),e.lineTo(-n,0),e.closePath()}},_n={draw(e,t){const r=an(t),n=-r/2
e.rect(n,n,r,r)}},Tn=on(ln/10)/on(7*ln/10),kn=on(cn/10)*Tn,Cn=-nn(cn/10)*Tn,In={draw(e,t){const r=an(.8908130915292852*t),n=kn*r,o=Cn*r
e.moveTo(0,-r),e.lineTo(n,o)
for(let i=1;i<5;++i){const t=cn*i/5,a=nn(t),l=on(t)
e.lineTo(l*r,-a*r),e.lineTo(a*n-l*o,l*n+a*o)}e.closePath()}},Dn=an(3),Nn={draw(e,t){const r=-an(t/(3*Dn))
e.moveTo(0,2*r),e.lineTo(-Dn*r,-r),e.lineTo(Dn*r,-r),e.closePath()}},Bn=-.5,Rn=an(3)/2,Ln=1/an(12),Un=3*(Ln/2+1),zn={draw(e,t){const r=an(t/Un),n=r/2,o=r*Ln,i=n,a=r*Ln+r,l=-i,c=a
e.moveTo(n,o),e.lineTo(i,a),e.lineTo(l,c),e.lineTo(Bn*n-Rn*o,Rn*n+Bn*o),e.lineTo(Bn*i-Rn*a,Rn*i+Bn*a),e.lineTo(Bn*l-Rn*c,Rn*l+Bn*c),e.lineTo(Bn*n+Rn*o,Bn*o-Rn*n),e.lineTo(Bn*i+Rn*a,Bn*a-Rn*i),e.lineTo(Bn*l+Rn*c,Bn*c-Rn*l),e.closePath()}}
function $n(){}function Fn(e,t,r){e._context.bezierCurveTo((2*e._x0+e._x1)/3,(2*e._y0+e._y1)/3,(e._x0+2*e._x1)/3,(e._y0+2*e._y1)/3,(e._x0+4*e._x1+t)/6,(e._y0+4*e._y1+r)/6)}function qn(e){this._context=e}function Wn(e){this._context=e}function Xn(e){this._context=e}function Hn(e){this._context=e}function Vn(e){return e<0?-1:1}function Yn(e,t,r){var n=e._x1-e._x0,o=t-e._x1,i=(e._y1-e._y0)/(n||o<0&&-0),a=(r-e._y1)/(o||n<0&&-0),l=(i*o+a*n)/(n+o)
return(Vn(i)+Vn(a))*Math.min(Math.abs(i),Math.abs(a),.5*Math.abs(l))||0}function Gn(e,t){var r=e._x1-e._x0
return r?(3*(e._y1-e._y0)/r-t)/2:t}function Kn(e,t,r){var n=e._x0,o=e._y0,i=e._x1,a=e._y1,l=(i-n)/3
e._context.bezierCurveTo(n+l,o+l*t,i-l,a-l*r,i,a)}function Zn(e){this._context=e}function Jn(e){this._context=new Qn(e)}function Qn(e){this._context=e}function eo(e){this._context=e}function to(e){var t,r,n=e.length-1,o=new Array(n),i=new Array(n),a=new Array(n)
for(o[0]=0,i[0]=2,a[0]=e[0]+2*e[1],t=1;t<n-1;++t)o[t]=1,i[t]=4,a[t]=4*e[t]+2*e[t+1]
for(o[n-1]=2,i[n-1]=7,a[n-1]=8*e[n-1]+e[n],t=1;t<n;++t)r=o[t]/i[t-1],i[t]-=r,a[t]-=r*a[t-1]
for(o[n-1]=a[n-1]/i[n-1],t=n-2;t>=0;--t)o[t]=(a[t]-o[t+1])/i[t]
for(i[n-1]=(e[n]+o[n-1])/2,t=0;t<n-1;++t)i[t]=2*e[t+1]-o[t+1]
return[o,i]}function ro(e,t){this._context=e,this._t=t}function no(e,t){if((o=e.length)>1)for(var r,n,o,i=1,a=e[t[0]],l=a.length;i<o;++i)for(n=a,a=e[t[i]],r=0;r<l;++r)a[r][1]+=a[r][0]=isNaN(n[r][1])?n[r][0]:n[r][1]}function oo(e){for(var t=e.length,r=new Array(t);--t>=0;)r[t]=t
return r}function io(e,t){return e[t]}function ao(e){const t=[]
return t.key=e,t}function lo(e){return(lo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}qn.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._y0=this._y1=NaN,this._point=0},lineEnd:function(){switch(this._point){case 3:Fn(this,this._x1,this._y1)
case 2:this._context.lineTo(this._x1,this._y1)}(this._line||0!==this._line&&1===this._point)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t)
break
case 1:this._point=2
break
case 2:this._point=3,this._context.lineTo((5*this._x0+this._x1)/6,(5*this._y0+this._y1)/6)
default:Fn(this,e,t)}this._x0=this._x1,this._x1=e,this._y0=this._y1,this._y1=t}},Wn.prototype={areaStart:$n,areaEnd:$n,lineStart:function(){this._x0=this._x1=this._x2=this._x3=this._x4=this._y0=this._y1=this._y2=this._y3=this._y4=NaN,this._point=0},lineEnd:function(){switch(this._point){case 1:this._context.moveTo(this._x2,this._y2),this._context.closePath()
break
case 2:this._context.moveTo((this._x2+2*this._x3)/3,(this._y2+2*this._y3)/3),this._context.lineTo((this._x3+2*this._x2)/3,(this._y3+2*this._y2)/3),this._context.closePath()
break
case 3:this.point(this._x2,this._y2),this.point(this._x3,this._y3),this.point(this._x4,this._y4)}},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._x2=e,this._y2=t
break
case 1:this._point=2,this._x3=e,this._y3=t
break
case 2:this._point=3,this._x4=e,this._y4=t,this._context.moveTo((this._x0+4*this._x1+e)/6,(this._y0+4*this._y1+t)/6)
break
default:Fn(this,e,t)}this._x0=this._x1,this._x1=e,this._y0=this._y1,this._y1=t}},Xn.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._y0=this._y1=NaN,this._point=0},lineEnd:function(){(this._line||0!==this._line&&3===this._point)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1
break
case 1:this._point=2
break
case 2:this._point=3
var r=(this._x0+4*this._x1+e)/6,n=(this._y0+4*this._y1+t)/6
this._line?this._context.lineTo(r,n):this._context.moveTo(r,n)
break
case 3:this._point=4
default:Fn(this,e,t)}this._x0=this._x1,this._x1=e,this._y0=this._y1,this._y1=t}},Hn.prototype={areaStart:$n,areaEnd:$n,lineStart:function(){this._point=0},lineEnd:function(){this._point&&this._context.closePath()},point:function(e,t){e=+e,t=+t,this._point?this._context.lineTo(e,t):(this._point=1,this._context.moveTo(e,t))}},Zn.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x0=this._x1=this._y0=this._y1=this._t0=NaN,this._point=0},lineEnd:function(){switch(this._point){case 2:this._context.lineTo(this._x1,this._y1)
break
case 3:Kn(this,this._t0,Gn(this,this._t0))}(this._line||0!==this._line&&1===this._point)&&this._context.closePath(),this._line=1-this._line},point:function(e,t){var r=NaN
if(t=+t,(e=+e)!==this._x1||t!==this._y1){switch(this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t)
break
case 1:this._point=2
break
case 2:this._point=3,Kn(this,Gn(this,r=Yn(this,e,t)),r)
break
default:Kn(this,this._t0,r=Yn(this,e,t))}this._x0=this._x1,this._x1=e,this._y0=this._y1,this._y1=t,this._t0=r}}},(Jn.prototype=Object.create(Zn.prototype)).point=function(e,t){Zn.prototype.point.call(this,t,e)},Qn.prototype={moveTo:function(e,t){this._context.moveTo(t,e)},closePath:function(){this._context.closePath()},lineTo:function(e,t){this._context.lineTo(t,e)},bezierCurveTo:function(e,t,r,n,o,i){this._context.bezierCurveTo(t,e,n,r,i,o)}},eo.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x=[],this._y=[]},lineEnd:function(){var e=this._x,t=this._y,r=e.length
if(r)if(this._line?this._context.lineTo(e[0],t[0]):this._context.moveTo(e[0],t[0]),2===r)this._context.lineTo(e[1],t[1])
else for(var n=to(e),o=to(t),i=0,a=1;a<r;++i,++a)this._context.bezierCurveTo(n[0][i],o[0][i],n[1][i],o[1][i],e[a],t[a]);(this._line||0!==this._line&&1===r)&&this._context.closePath(),this._line=1-this._line,this._x=this._y=null},point:function(e,t){this._x.push(+e),this._y.push(+t)}},ro.prototype={areaStart:function(){this._line=0},areaEnd:function(){this._line=NaN},lineStart:function(){this._x=this._y=NaN,this._point=0},lineEnd:function(){0<this._t&&this._t<1&&2===this._point&&this._context.lineTo(this._x,this._y),(this._line||0!==this._line&&1===this._point)&&this._context.closePath(),this._line>=0&&(this._t=1-this._t,this._line=1-this._line)},point:function(e,t){switch(e=+e,t=+t,this._point){case 0:this._point=1,this._line?this._context.lineTo(e,t):this._context.moveTo(e,t)
break
case 1:this._point=2
default:if(this._t<=0)this._context.lineTo(this._x,t),this._context.lineTo(e,t)
else{var r=this._x*(1-this._t)+e*this._t
this._context.lineTo(r,this._y),this._context.lineTo(r,t)}}this._x=e,this._y=t}}
var co=["type","size","sizeType"]
function so(){return so=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},so.apply(this,arguments)}function uo(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function fo(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?uo(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=lo(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=lo(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==lo(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):uo(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}var po={symbolCircle:Sn,symbolCross:Pn,symbolDiamond:Mn,symbolSquare:_n,symbolStar:In,symbolTriangle:Nn,symbolWye:zn},ho=Math.PI/180,yo=function(t){var r,n,i=t.type,a=void 0===i?"circle":i,l=t.size,c=void 0===l?64:l,s=t.sizeType,u=void 0===s?"area":s,f=fo(fo({},((e,t)=>{if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o})(t,co)),{},{type:a,size:c,sizeType:u}),p=f.className,h=f.cx,d=f.cy,y=Er(f,!0)
return h===+h&&d===+d&&c===+c?o.createElement("path",so({},y,{className:e("recharts-symbols",p),transform:"translate(".concat(h,", ").concat(d,")"),d:(r=(e=>{var t="symbol".concat(tn(e))
return po[t]||Sn})(a),n=function(e,t){let r=null,n=yn(o)
function o(){let o
if(r||(r=o=n()),e.apply(this,arguments).draw(r,+t.apply(this,arguments)),o)return r=null,o+""||null}return e="function"==typeof e?e:rn(e||Sn),t="function"==typeof t?t:rn(void 0===t?64:+t),o.type=function(t){return arguments.length?(e="function"==typeof t?t:rn(t),o):e},o.size=function(e){return arguments.length?(t="function"==typeof e?e:rn(+e),o):t},o.context=function(e){return arguments.length?(r=e??null,o):r},o}().type(r).size(((e,t,r)=>{if("area"===t)return e
switch(r){case"cross":return 5*e*e/9
case"diamond":return.5*e*e/Math.sqrt(3)
case"square":return e*e
case"star":var n=18*ho
return 1.25*e*e*(Math.tan(n)-Math.tan(2*n)*Math.pow(Math.tan(n),2))
case"triangle":return Math.sqrt(3)*e*e/4
case"wye":return(21-10*Math.sqrt(3))*e*e/8
default:return Math.PI*e*e/4}})(c,u,a)),n())})):null}
function vo(e){return(vo="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function mo(){return mo=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},mo.apply(this,arguments)}function bo(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function go(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{}))}catch(t){}return(go=()=>!!e)()}function wo(e){return(wo=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}function xo(e,t){return(xo=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function Oo(e,t,r){return(t=jo(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function jo(e){var t=(e=>{if("object"!=vo(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=vo(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==vo(t)?t:t+""}yo.registerSymbol=(e,t)=>{po["symbol".concat(tn(e))]=t}
var So,Po,Ao,Eo,Mo,_o,To,ko,Co,Io,Do,No,Bo,Ro,Lo,Uo,zo,$o,Fo,qo,Wo,Xo,Ho,Vo,Yo,Go,Ko,Zo,Jo,Qo,ei,ti,ri,ni,oi,ii,ai,li,ci,si,ui,fi,pi,hi,di,yi,vi,mi,bi=32,gi=function(){function t(){return((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,t),e=this,n=arguments,r=wo(r=t),((e,t)=>{if(t&&("object"===vo(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return(e=>{if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e})(e)})(e,go()?Reflect.construct(r,n||[],wo(e).constructor):r.apply(e,n))
var e,r,n}return((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&xo(e,t)})(t,n.PureComponent),r=t,i=[{key:"renderIcon",value:function(e){var t=this.props.inactiveColor,r=16,n=bi/6,i=bi/3,a=e.inactive?t:e.color
if("plainline"===e.type)return o.createElement("line",{strokeWidth:4,fill:"none",stroke:a,strokeDasharray:e.payload.strokeDasharray,x1:0,y1:r,x2:bi,y2:r,className:"recharts-legend-icon"})
if("line"===e.type)return o.createElement("path",{strokeWidth:4,fill:"none",stroke:a,d:"M0,".concat(r,"h").concat(i,"\n            A").concat(n,",").concat(n,",0,1,1,").concat(2*i,",").concat(r,"\n            H").concat(bi,"M").concat(2*i,",").concat(r,"\n            A").concat(n,",").concat(n,",0,1,1,").concat(i,",").concat(r),className:"recharts-legend-icon"})
if("rect"===e.type)return o.createElement("path",{stroke:"none",fill:a,d:"M0,".concat(4,"h").concat(bi,"v").concat(24,"h").concat(-32,"z"),className:"recharts-legend-icon"})
if(o.isValidElement(e.legendIcon)){var l=function(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?bo(Object(r),!0).forEach(t=>{Oo(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):bo(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}({},e)
return delete l.legendIcon,o.cloneElement(e.legendIcon,l)}return o.createElement(yo,{fill:a,cx:r,cy:r,size:bi,sizeType:"diameter",type:e.type})}},{key:"renderItems",value:function(){var t=this,r=this.props,n=r.payload,i=r.iconSize,a=r.layout,l=r.formatter,c=r.inactiveColor,s={x:0,y:0,width:bi,height:bi},u={display:"horizontal"===a?"inline-block":"block",marginRight:10},f={display:"inline-block",verticalAlign:"middle",marginRight:4}
return n.map((r,n)=>{var a=r.formatter||l,p=e(Oo(Oo({"recharts-legend-item":!0},"legend-item-".concat(n),!0),"inactive",r.inactive))
if("none"===r.type)return null
var h=Dt(r.value)?null:r.value
Qr(!Dt(r.value),'The name property is also required when using a function for the dataKey of a chart\'s cartesian components. Ex: <Bar name="Name of my Data"/>')
var d=r.inactive?c:r.color
return o.createElement("li",mo({className:p,style:u,key:"legend-item-".concat(n)},pr(t.props,r,n)),o.createElement(Ir,{width:i,height:i,viewBox:s,style:f},t.renderIcon(r)),o.createElement("span",{className:"recharts-legend-item-text",style:{color:d}},a?a(h,r,n):h))})}},{key:"render",value:function(){var e=this.props,t=e.payload,r=e.layout,n=e.align
if(!t||!t.length)return null
var i={padding:0,margin:0,textAlign:"horizontal"===r?n:"left"}
return o.createElement("ul",{className:"recharts-default-legend",style:i},this.renderItems())}}],i&&((e,t)=>{for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,jo(n.key),n)}})(r.prototype,i),Object.defineProperty(r,"prototype",{writable:!1}),r
var r,i}()
function wi(){if(No)return Do
No=1
var e=vt(),t=function(){if(Po)return So
Po=1
var e=vt()
return So=function(){this.__data__=new e,this.size=0}}(),r=Eo?Ao:(Eo=1,Ao=function(e){var t=this.__data__,r=t.delete(e)
return this.size=t.size,r}),n=_o?Mo:(_o=1,Mo=function(e){return this.__data__.get(e)}),o=ko?To:(ko=1,To=function(e){return this.__data__.has(e)}),i=function(){if(Io)return Co
Io=1
var e=vt(),t=mt(),r=gt()
return Co=function(n,o){var i=this.__data__
if(i instanceof e){var a=i.__data__
if(!t||a.length<199)return a.push([n,o]),this.size=++i.size,this
i=this.__data__=new r(a)}return i.set(n,o),this.size=i.size,this}}()
function a(t){var r=this.__data__=new e(t)
this.size=r.size}return a.prototype.clear=t,a.prototype.delete=r,a.prototype.get=n,a.prototype.has=o,a.prototype.set=i,Do=a}function xi(){if($o)return zo
$o=1
var e=gt(),t=Ro?Bo:(Ro=1,Bo=function(e){return this.__data__.set(e,"__lodash_hash_undefined__"),this}),r=Uo?Lo:(Uo=1,Lo=function(e){return this.__data__.has(e)})
function n(t){var r=-1,n=null==t?0:t.length
for(this.__data__=new e;++r<n;)this.add(t[r])}return n.prototype.add=n.prototype.push=t,n.prototype.has=r,zo=n}function Oi(){return qo?Fo:(qo=1,Fo=(e,t)=>{for(var r=-1,n=null==e?0:e.length;++r<n;)if(t(e[r],r,e))return!0
return!1})}function ji(){return Xo?Wo:(Xo=1,Wo=(e,t)=>e.has(t))}function Si(){if(Vo)return Ho
Vo=1
var e=xi(),t=Oi(),r=ji()
return Ho=(n,o,i,a,l,c)=>{var s=1&i,u=n.length,f=o.length
if(u!=f&&!(s&&f>u))return!1
var p=c.get(n),h=c.get(o)
if(p&&h)return p==o&&h==n
var d=-1,y=!0,v=2&i?new e:void 0
for(c.set(n,o),c.set(o,n);++d<u;){var m=n[d],b=o[d]
if(a)var g=s?a(b,m,d,o,n,c):a(m,b,d,n,o,c)
if(void 0!==g){if(g)continue
y=!1
break}if(v){if(!t(o,(e,t)=>{if(!r(v,t)&&(m===e||l(m,e,i,a,c)))return v.push(t)})){y=!1
break}}else if(m!==b&&!l(m,b,i,a,c)){y=!1
break}}return c.delete(n),c.delete(o),y}}function Pi(){return Qo?Jo:(Qo=1,Jo=e=>{var t=-1,r=Array(e.size)
return e.forEach(e=>{r[++t]=e}),r})}function Ai(){return ni?ri:(ni=1,ri=(e,t)=>{for(var r=-1,n=t.length,o=e.length;++r<n;)e[o+r]=t[r]
return e})}function Ei(){if(mi)return vi
mi=1
var e=(()=>{if(yi)return di
yi=1
var e=it(),t=at()
return di=r=>t(r)&&"[object Arguments]"==e(r)})(),t=at(),r=Object.prototype,n=r.hasOwnProperty,o=r.propertyIsEnumerable,i=e(function(){return arguments}())?e:e=>t(e)&&n.call(e,"callee")&&!o.call(e,"callee")
return vi=i}Oo(gi,"displayName","Legend"),Oo(gi,"defaultProps",{iconSize:14,layout:"horizontal",align:"center",verticalAlign:"middle",inactiveColor:"#ccc"})
var Mi,_i,Ti,ki,Ci,Ii,Di,Ni,Bi,Ri,Li,Ui={exports:{}}
function zi(){return Ti||(Ti=1,e=Ui,t=Ui.exports,r=nt(),n=_i?Mi:(_i=1,Mi=()=>!1),l=((a=(i=(o=t&&!t.nodeType&&t)&&e&&!e.nodeType&&e)&&i.exports===o?r.Buffer:void 0)?a.isBuffer:void 0)||n,e.exports=l),Ui.exports
var e,t,r,n,o,i,a,l}function $i(){if(Ci)return ki
Ci=1
var e=/^(?:0|[1-9]\d*)$/
return ki=(t,r)=>{var n=typeof t
return!!(r=r??9007199254740991)&&("number"==n||"symbol"!=n&&e.test(t))&&t>-1&&t%1==0&&t<r}}function Fi(){return Di?Ii:(Di=1,Ii=e=>"number"==typeof e&&e>-1&&e%1==0&&e<=9007199254740991)}function qi(){return Li?Ri:(Li=1,Ri=e=>t=>e(t))}var Wi,Xi,Hi,Vi,Yi,Gi,Ki,Zi,Ji,Qi,ea,ta,ra,na,oa,ia,aa,la,ca,sa,ua,fa,pa,ha,da,ya,va,ma,ba,ga,wa,xa,Oa,ja,Sa,Pa,Aa,Ea,Ma,_a,Ta,ka,Ca,Ia,Da,Na,Ba,Ra,La,Ua,za,$a,Fa,qa,Wa,Xa,Ha,Va,Ya,Ga,Ka,Za,Ja,Qa,el,tl,rl,nl,ol,il,al,ll,cl,sl,ul,fl,pl,hl,dl,yl,vl,ml,bl,gl={exports:{}}
function wl(){if(Hi)return Xi
Hi=1
var e=(()=>{if(Bi)return Ni
Bi=1
var e=it(),t=Fi(),r=at(),n={}
return n["[object Float32Array]"]=n["[object Float64Array]"]=n["[object Int8Array]"]=n["[object Int16Array]"]=n["[object Int32Array]"]=n["[object Uint8Array]"]=n["[object Uint8ClampedArray]"]=n["[object Uint16Array]"]=n["[object Uint32Array]"]=!0,n["[object Arguments]"]=n["[object Array]"]=n["[object ArrayBuffer]"]=n["[object Boolean]"]=n["[object DataView]"]=n["[object Date]"]=n["[object Error]"]=n["[object Function]"]=n["[object Map]"]=n["[object Number]"]=n["[object Object]"]=n["[object RegExp]"]=n["[object Set]"]=n["[object String]"]=n["[object WeakMap]"]=!1,Ni=o=>r(o)&&t(o.length)&&!!n[e(o)]})(),t=qi(),r=(()=>{return Wi||(Wi=1,e=gl,t=gl.exports,r=rt(),n=t&&!t.nodeType&&t,o=n&&e&&!e.nodeType&&e,i=o&&o.exports===n&&r.process,a=(()=>{try{return o&&o.require&&o.require("util").types||i&&i.binding&&i.binding("util")}catch(e){}})(),e.exports=a),gl.exports
var e,t,r,n,o,i,a})(),n=r&&r.isTypedArray,o=n?t(n):e
return Xi=o}function xl(){return Ji?Zi:(Ji=1,Zi=(e,t)=>r=>e(t(r)))}function Ol(){if(oa)return na
oa=1
var e=ut(),t=Fi()
return na=r=>null!=r&&t(r.length)&&!e(r)}function jl(){if(aa)return ia
aa=1
var e=(()=>{if(Yi)return Vi
Yi=1
var e=hi?pi:(hi=1,pi=(e,t)=>{for(var r=-1,n=Array(e);++r<e;)n[r]=t(r)
return n}),t=Ei(),r=tt(),n=zi(),o=$i(),i=wl(),a=Object.prototype.hasOwnProperty
return Vi=(l,c)=>{var s=r(l),u=!s&&t(l),f=!s&&!u&&n(l),p=!s&&!u&&!f&&i(l),h=s||u||f||p,d=h?e(l.length,String):[],y=d.length
for(var v in l)!c&&!a.call(l,v)||h&&("length"==v||f&&("offset"==v||"parent"==v)||p&&("buffer"==v||"byteLength"==v||"byteOffset"==v)||o(v,y))||d.push(v)
return d}})(),t=(()=>{if(ra)return ta
ra=1
var e=(()=>{if(Ki)return Gi
Ki=1
var e=Object.prototype
return Gi=t=>{var r=t&&t.constructor
return t===("function"==typeof r&&r.prototype||e)}})(),t=(()=>{if(ea)return Qi
ea=1
var e=xl()(Object.keys,Object)
return Qi=e})(),r=Object.prototype.hasOwnProperty
return ta=n=>{if(!e(n))return t(n)
var o=[]
for(var i in Object(n))r.call(n,i)&&"constructor"!=i&&o.push(i)
return o}})(),r=Ol()
return ia=n=>r(n)?e(n):t(n)}function Sl(){if(va)return ya
va=1
var e=pt()(nt(),"Set")
return ya=e}function Pl(){if(Sa)return ja
Sa=1
var e=(()=>{if(Oa)return xa
Oa=1
var e=wi(),t=Si(),r=(()=>{if(ti)return ei
ti=1
var e=ot(),t=(()=>{if(Go)return Yo
Go=1
var e=nt().Uint8Array
return Yo=e})(),r=dt(),n=Si(),o=Zo?Ko:(Zo=1,Ko=e=>{var t=-1,r=Array(e.size)
return e.forEach((e,n)=>{r[++t]=[n,e]}),r}),i=Pi(),a=e?e.prototype:void 0,l=a?a.valueOf:void 0
return ei=(e,a,c,s,u,f,p)=>{switch(c){case"[object DataView]":if(e.byteLength!=a.byteLength||e.byteOffset!=a.byteOffset)return!1
e=e.buffer,a=a.buffer
case"[object ArrayBuffer]":return!(e.byteLength!=a.byteLength||!f(new t(e),new t(a)))
case"[object Boolean]":case"[object Date]":case"[object Number]":return r(+e,+a)
case"[object Error]":return e.name==a.name&&e.message==a.message
case"[object RegExp]":case"[object String]":return e==a+""
case"[object Map]":var h=o
case"[object Set]":var d=1&s
if(h||(h=i),e.size!=a.size&&!d)return!1
var y=p.get(e)
if(y)return y==a
s|=2,p.set(e,a)
var v=n(h(e),h(a),s,u,f,p)
return p.delete(e),v
case"[object Symbol]":if(l)return l.call(e)==l.call(a)}return!1}})(),n=(()=>{if(ua)return sa
ua=1
var e=(()=>{if(ca)return la
ca=1
var e=(()=>{if(ii)return oi
ii=1
var e=Ai(),t=tt()
return oi=(r,n,o)=>{var i=n(r)
return t(r)?i:e(i,o(r))}})(),t=(()=>{if(fi)return ui
fi=1
var e=li?ai:(li=1,ai=(e,t)=>{for(var r=-1,n=null==e?0:e.length,o=0,i=[];++r<n;){var a=e[r]
t(a,r,e)&&(i[o++]=a)}return i}),t=si?ci:(si=1,ci=()=>[]),r=Object.prototype.propertyIsEnumerable,n=Object.getOwnPropertySymbols
return ui=n?t=>null==t?[]:(t=Object(t),e(n(t),e=>r.call(t,e))):t})(),r=jl()
return la=n=>e(n,r,t)})(),t=Object.prototype.hasOwnProperty
return sa=(r,n,o,i,a,l)=>{var c=1&o,s=e(r),u=s.length
if(u!=e(n).length&&!c)return!1
for(var f=u;f--;){var p=s[f]
if(!(c?p in n:t.call(n,p)))return!1}var h=l.get(r),d=l.get(n)
if(h&&d)return h==n&&d==r
var y=!0
l.set(r,n),l.set(n,r)
for(var v=c;++f<u;){var m=r[p=s[f]],b=n[p]
if(i)var g=c?i(b,m,p,n,r,l):i(m,b,p,r,n,l)
if(!(void 0===g?m===b||a(m,b,o,i,l):g)){y=!1
break}v||(v="constructor"==p)}if(y&&!v){var w=r.constructor,x=n.constructor
w==x||!("constructor"in r)||!("constructor"in n)||"function"==typeof w&&w instanceof w&&"function"==typeof x&&x instanceof x||(y=!1)}return l.delete(r),l.delete(n),y}})(),o=(()=>{if(wa)return ga
wa=1
var e=(()=>{if(pa)return fa
pa=1
var e=pt()(nt(),"DataView")
return fa=e})(),t=mt(),r=(()=>{if(da)return ha
da=1
var e=pt()(nt(),"Promise")
return ha=e})(),n=Sl(),o=(()=>{if(ba)return ma
ba=1
var e=pt()(nt(),"WeakMap")
return ma=e})(),i=it(),a=ft(),l="[object Map]",c="[object Promise]",s="[object Set]",u="[object WeakMap]",f="[object DataView]",p=a(e),h=a(t),d=a(r),y=a(n),v=a(o),m=i
return(e&&m(new e(new ArrayBuffer(1)))!=f||t&&m(new t)!=l||r&&m(r.resolve())!=c||n&&m(new n)!=s||o&&m(new o)!=u)&&(m=e=>{var t=i(e),r="[object Object]"==t?e.constructor:void 0,n=r?a(r):""
if(n)switch(n){case p:return f
case h:return l
case d:return c
case y:return s
case v:return u}return t}),ga=m})(),i=tt(),a=zi(),l=wl(),c="[object Arguments]",s="[object Array]",u="[object Object]",f=Object.prototype.hasOwnProperty
return xa=(p,h,d,y,v,m)=>{var b=i(p),g=i(h),w=b?s:o(p),x=g?s:o(h),O=(w=w==c?u:w)==u,j=(x=x==c?u:x)==u,S=w==x
if(S&&a(p)){if(!a(h))return!1
b=!0,O=!1}if(S&&!O)return m||(m=new e),b||l(p)?t(p,h,d,y,v,m):r(p,h,w,d,y,v,m)
if(!(1&d)){var P=O&&f.call(p,"__wrapped__"),A=j&&f.call(h,"__wrapped__")
if(P||A){var E=P?p.value():p,M=A?h.value():h
return m||(m=new e),v(E,M,d,y,m)}}return!!S&&(m||(m=new e),n(p,h,d,y,v,m))}})(),t=at()
return ja=function r(n,o,i,a,l){return n===o||(null==n||null==o||!t(n)&&!t(o)?n!=n&&o!=o:e(n,o,i,a,r,l))}}function Al(){if(Ma)return Ea
Ma=1
var e=st()
return Ea=t=>t==t&&!e(t)}function El(){return Ca?ka:(Ca=1,ka=(e,t)=>r=>null!=r&&r[e]===t&&(void 0!==t||e in Object(r)))}function Ml(){return Wa?qa:(Wa=1,qa=e=>e)}function _l(){if(Ja)return Za
Ja=1
var e=(()=>{if(Da)return Ia
Da=1
var e=(()=>{if(Aa)return Pa
Aa=1
var e=wi(),t=Pl()
return Pa=(r,n,o,i)=>{var a=o.length,l=a,c=!i
if(null==r)return!l
for(r=Object(r);a--;){var s=o[a]
if(c&&s[2]?s[1]!==r[s[0]]:!(s[0]in r))return!1}for(;++a<l;){var u=(s=o[a])[0],f=r[u],p=s[1]
if(c&&s[2]){if(void 0===f&&!(u in r))return!1}else{var h=new e
if(i)var d=i(f,p,u,r,n,h)
if(!(void 0===d?t(p,f,3,i,h):d))return!1}}return!0}})(),t=(()=>{if(Ta)return _a
Ta=1
var e=Al(),t=jl()
return _a=r=>{for(var n=t(r),o=n.length;o--;){var i=n[o],a=r[i]
n[o]=[i,a,e(a)]}return n}})(),r=El()
return Ia=n=>{var o=t(n)
return 1==o.length&&o[0][2]?r(o[0][0],o[0][1]):t=>t===n||e(t,n,o)}})(),t=(()=>{if(Fa)return $a
Fa=1
var e=Pl(),t=At(),r=(()=>{if(za)return Ua
za=1
var e=Ba?Na:(Ba=1,Na=(e,t)=>null!=e&&t in Object(e)),t=(()=>{if(La)return Ra
La=1
var e=jt(),t=Ei(),r=tt(),n=$i(),o=Fi(),i=St()
return Ra=(a,l,c)=>{for(var s=-1,u=(l=e(l,a)).length,f=!1;++s<u;){var p=i(l[s])
if(!(f=null!=a&&c(a,p)))break
a=a[p]}return f||++s!=u?f:!!(u=null==a?0:a.length)&&o(u)&&n(p,u)&&(r(a)||t(a))}})()
return Ua=(r,n)=>null!=r&&t(r,n,e)})(),n=ct(),o=Al(),i=El(),a=St()
return $a=(l,c)=>n(l)&&o(c)?i(a(l),c):n=>{var o=t(n,l)
return void 0===o&&o===c?r(n,l):e(c,o,3)}})(),r=Ml(),n=tt(),o=(()=>{if(Ka)return Ga
Ka=1
var e=Ha?Xa:(Ha=1,Xa=e=>t=>null==t?void 0:t[e]),t=(()=>{if(Ya)return Va
Ya=1
var e=Pt()
return Va=t=>r=>e(r,t)})(),r=ct(),n=St()
return Ga=o=>r(o)?e(n(o)):t(o)})()
return Za=i=>"function"==typeof i?i:null==i?r:"object"==typeof i?n(i)?t(i[0],i[1]):e(i):o(i)}function Tl(){return el?Qa:(el=1,Qa=(e,t,r,n)=>{for(var o=e.length,i=r+(n?1:-1);n?i--:++i<o;)if(t(e[i],i,e))return i
return-1})}const kl=r((()=>{if(bl)return ml
bl=1
var e=_l(),t=(()=>{if(vl)return yl
vl=1
var e=xi(),t=(()=>{if(cl)return ll
cl=1
var e=(()=>{if(al)return il
al=1
var e=Tl(),t=rl?tl:(rl=1,tl=e=>e!=e),r=ol?nl:(ol=1,nl=(e,t,r)=>{for(var n=r-1,o=e.length;++n<o;)if(e[n]===t)return n
return-1})
return il=(n,o,i)=>o==o?r(n,o,i):e(n,t,i)})()
return ll=(t,r)=>!(null==t||!t.length)&&e(t,r,0)>-1})(),r=ul?sl:(ul=1,sl=(e,t,r)=>{for(var n=-1,o=null==e?0:e.length;++n<o;)if(r(t,e[n]))return!0
return!1}),n=ji(),o=(()=>{if(dl)return hl
dl=1
var e=Sl(),t=pl?fl:(pl=1,fl=()=>{}),r=Pi(),n=e&&1/r(new e([,-0]))[1]==1/0?t=>new e(t):t
return hl=n})(),i=Pi()
return yl=(a,l,c)=>{var s=-1,u=t,f=a.length,p=!0,h=[],d=h
if(c)p=!1,u=r
else if(f>=200){var y=l?null:o(a)
if(y)return i(y)
p=!1,u=n,d=new e}else d=l?[]:h
e:for(;++s<f;){var v=a[s],m=l?l(v):v
if(v=c||0!==v?v:0,p&&m==m){for(var b=d.length;b--;)if(d[b]===m)continue e
l&&d.push(m),h.push(v)}else u(d,m,c)||(d!==h&&d.push(m),h.push(v))}return h}})()
return ml=(r,n)=>r&&r.length?t(r,e(n,2)):[]})())
function Cl(e,t,r){return!0===t?kl(e,r):Dt(t)?kl(e,t):e}function Il(e){return(Il="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}var Dl=["ref"]
function Nl(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Bl(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Nl(Object(r),!0).forEach(t=>{$l(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Nl(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function Rl(e,t){for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,Fl(n.key),n)}}function Ll(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{}))}catch(t){}return(Ll=()=>!!e)()}function Ul(e){return(Ul=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}function zl(e,t){return(zl=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function $l(e,t,r){return(t=Fl(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function Fl(e){var t=(e=>{if("object"!=Il(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Il(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==Il(t)?t:t+""}function ql(e){return e.value}var Wl,Xl,Hl,Vl,Yl,Gl,Kl,Zl,Jl,Ql,ec,tc,rc,nc,oc,ic,ac,lc,cc,sc,uc,fc,pc,hc,dc,yc,vc,mc,bc,gc,wc,xc,Oc,jc,Sc,Pc,Ac,Ec,Mc,_c,Tc,kc,Cc,Ic,Dc=function(){function e(){var t,r,n,o;((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,e)
for(var i=arguments.length,a=new Array(i),l=0;l<i;l++)a[l]=arguments[l]
return $l((r=this,n=e,o=[].concat(a),n=Ul(n),t=((e,t)=>{if(t&&("object"===Il(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return(e=>{if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e})(e)})(r,Ll()?Reflect.construct(n,o||[],Ul(r).constructor):n.apply(r,o))),"lastBoundingBox",{width:-1,height:-1}),t}return((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&zl(e,t)})(e,n.PureComponent),t=e,i=[{key:"getWithHeight",value:function(e,t){var r=Bl(Bl({},this.defaultProps),e.props).layout
return"vertical"===r&&Kt(e.props.height)?{height:e.props.height}:"horizontal"===r?{width:e.props.width||t}:null}}],(r=[{key:"componentDidMount",value:function(){this.updateBBox()}},{key:"componentDidUpdate",value:function(){this.updateBBox()}},{key:"getBBox",value:function(){if(this.wrapperNode&&this.wrapperNode.getBoundingClientRect){var e=this.wrapperNode.getBoundingClientRect()
return e.height=this.wrapperNode.offsetHeight,e.width=this.wrapperNode.offsetWidth,e}return null}},{key:"updateBBox",value:function(){var e=this.props.onBBoxUpdate,t=this.getBBox()
t?(Math.abs(t.width-this.lastBoundingBox.width)>1||Math.abs(t.height-this.lastBoundingBox.height)>1)&&(this.lastBoundingBox.width=t.width,this.lastBoundingBox.height=t.height,e&&e(t)):-1===this.lastBoundingBox.width&&-1===this.lastBoundingBox.height||(this.lastBoundingBox.width=-1,this.lastBoundingBox.height=-1,e&&e(null))}},{key:"getBBoxSnapshot",value:function(){return this.lastBoundingBox.width>=0&&this.lastBoundingBox.height>=0?Bl({},this.lastBoundingBox):{width:0,height:0}}},{key:"getDefaultPosition",value:function(e){var t,r,n=this.props,o=n.layout,i=n.align,a=n.verticalAlign,l=n.margin,c=n.chartWidth,s=n.chartHeight
return e&&(void 0!==e.left&&null!==e.left||void 0!==e.right&&null!==e.right)||(t="center"===i&&"vertical"===o?{left:((c||0)-this.getBBoxSnapshot().width)/2}:"right"===i?{right:l&&l.right||0}:{left:l&&l.left||0}),e&&(void 0!==e.top&&null!==e.top||void 0!==e.bottom&&null!==e.bottom)||(r="middle"===a?{top:((s||0)-this.getBBoxSnapshot().height)/2}:"bottom"===a?{bottom:l&&l.bottom||0}:{top:l&&l.top||0}),Bl(Bl({},t),r)}},{key:"render",value:function(){var e=this,t=this.props,r=t.content,n=t.width,i=t.height,a=t.wrapperStyle,l=t.payloadUniqBy,c=t.payload,s=Bl(Bl({position:"absolute",width:n||"auto",height:i||"auto"},this.getDefaultPosition(a)),a)
return o.createElement("div",{className:"recharts-legend-wrapper",style:s,ref:t=>{e.wrapperNode=t}},((e,t)=>{if(o.isValidElement(e))return o.cloneElement(e,t)
if("function"==typeof e)return o.createElement(e,t)
t.ref
var r=((e,t)=>{if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o})(t,Dl)
return o.createElement(gi,r)})(r,Bl(Bl({},this.props),{},{payload:Cl(c,l,ql)})))}}])&&Rl(t.prototype,r),i&&Rl(t,i),Object.defineProperty(t,"prototype",{writable:!1}),t
var t,r,i}()
function Nc(){if(Vl)return Hl
Vl=1
var e=Ai(),t=(()=>{if(Xl)return Wl
Xl=1
var e=ot(),t=Ei(),r=tt(),n=e?e.isConcatSpreadable:void 0
return Wl=e=>r(e)||t(e)||!!(n&&e&&e[n])})()
return Hl=function r(n,o,i,a,l){var c=-1,s=n.length
for(i||(i=t),l||(l=[]);++c<s;){var u=n[c]
o>0&&i(u)?o>1?r(u,o-1,i,a,l):e(l,u):a||(l[l.length]=u)}return l}}function Bc(){if(Ql)return Jl
Ql=1
var e=(()=>{if(Zl)return Kl
Zl=1
var e=(Gl?Yl:(Gl=1,Yl=e=>(t,r,n)=>{for(var o=-1,i=Object(t),a=n(t),l=a.length;l--;){var c=a[e?l:++o]
if(!1===r(i[c],c,i))break}return t}))()
return Kl=e})(),t=jl()
return Jl=(r,n)=>r&&e(r,n,t)}function Rc(){if(nc)return rc
nc=1
var e=Bc(),t=(()=>{if(tc)return ec
tc=1
var e=Ol()
return ec=(t,r)=>(n,o)=>{if(null==n)return n
if(!e(n))return t(n,o)
for(var i=n.length,a=r?i:-1,l=Object(n);(r?a--:++a<i)&&!1!==o(l[a],a,l););return n}})()(e)
return rc=t}function Lc(){if(ic)return oc
ic=1
var e=Rc(),t=Ol()
return oc=(r,n)=>{var o=-1,i=t(r)?Array(r.length):[]
return e(r,(e,t,r)=>{i[++o]=n(e,t,r)}),i}}function Uc(){if(xc)return wc
xc=1
var e=pt(),t=(()=>{try{var t=e(Object,"defineProperty")
return t({},"",{}),t}catch(r){}})()
return wc=t}function zc(){if(kc)return Tc
kc=1
var e=dt(),t=Ol(),r=$i(),n=st()
return Tc=(o,i,a)=>{if(!n(a))return!1
var l=typeof i
return!!("number"==l?t(a)&&r(i,a.length):"string"==l&&i in a)&&e(a[i],o)}}$l(Dc,"displayName","Legend"),$l(Dc,"defaultProps",{iconSize:14,layout:"horizontal",align:"center",verticalAlign:"bottom"})
const $c=r(function(){if(Ic)return Cc
Ic=1
var e=Nc(),t=(()=>{if(hc)return pc
hc=1
var e=xt(),t=Pt(),r=_l(),n=Lc(),o=lc?ac:(lc=1,ac=(e,t)=>{var r=e.length
for(e.sort(t);r--;)e[r]=e[r].value
return e}),i=qi(),a=(()=>{if(fc)return uc
fc=1
var e=(()=>{if(sc)return cc
sc=1
var e=lt()
return cc=(t,r)=>{if(t!==r){var n=void 0!==t,o=null===t,i=t==t,a=e(t),l=void 0!==r,c=null===r,s=r==r,u=e(r)
if(!c&&!u&&!a&&t>r||a&&l&&s&&!c&&!u||o&&l&&s||!n&&s||!i)return 1
if(!o&&!a&&!u&&t<r||u&&n&&i&&!o&&!a||c&&n&&i||!l&&i||!s)return-1}return 0}})()
return uc=(t,r,n)=>{for(var o=-1,i=t.criteria,a=r.criteria,l=i.length,c=n.length;++o<l;){var s=e(i[o],a[o])
if(s)return o>=c?s:s*("desc"==n[o]?-1:1)}return t.index-r.index}})(),l=Ml(),c=tt()
return pc=(s,u,f)=>{u=u.length?e(u,e=>c(e)?r=>t(r,1===e.length?e[0]:e):e):[l]
var p=-1
u=e(u,i(r))
var h=n(s,t=>({criteria:e(u,e=>e(t)),index:++p,value:t}))
return o(h,(e,t)=>a(e,t,f))}})(),r=function(){if(_c)return Mc
_c=1
var e=Ml(),t=function(){if(mc)return vc
mc=1
var e=yc?dc:(yc=1,dc=(e,t,r)=>{switch(r.length){case 0:return e.call(t)
case 1:return e.call(t,r[0])
case 2:return e.call(t,r[0],r[1])
case 3:return e.call(t,r[0],r[1],r[2])}return e.apply(t,r)}),t=Math.max
return vc=function(r,n,o){return n=t(void 0===n?r.length-1:n,0),function(){for(var i=arguments,a=-1,l=t(i.length-n,0),c=Array(l);++a<l;)c[a]=i[n+a]
a=-1
for(var s=Array(n+1);++a<n;)s[a]=i[a]
return s[n]=o(c),e(r,this,s)}},vc}(),r=(()=>{if(Ec)return Ac
Ec=1
var e=(()=>{if(jc)return Oc
jc=1
var e=gc?bc:(gc=1,bc=e=>()=>e),t=Uc(),r=Ml()
return Oc=t?(r,n)=>t(r,"toString",{configurable:!0,enumerable:!1,value:e(n),writable:!0}):r})(),t=(()=>{if(Pc)return Sc
Pc=1
var e=Date.now
return Sc=t=>{var r=0,n=0
return function(){var o=e(),i=16-(o-n)
if(n=o,i>0){if(++r>=800)return arguments[0]}else r=0
return t.apply(void 0,arguments)}},Sc})(),r=t(e)
return Ac=r})()
return Mc=(n,o)=>r(t(n,o,e),n+"")}(),n=zc(),o=r((r,o)=>{if(null==r)return[]
var i=o.length
return i>1&&n(r,o[0],o[1])?o=[]:i>2&&n(o[0],o[1],o[2])&&(o=[o[0]]),t(r,e(o,1),[])})
return Cc=o}())
function Fc(e){return(Fc="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function qc(){return qc=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},qc.apply(this,arguments)}function Wc(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function Xc(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Hc(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Xc(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=Fc(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Fc(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==Fc(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Xc(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function Vc(e){return Array.isArray(e)&&Zt(e[0])&&Zt(e[1])?e.join(" ~ "):e}var Yc=t=>{var r=t.separator,n=void 0===r?" : ":r,i=t.contentStyle,a=void 0===i?{}:i,l=t.itemStyle,c=void 0===l?{}:l,s=t.labelStyle,u=void 0===s?{}:s,f=t.payload,p=t.formatter,h=t.itemSorter,d=t.wrapperClassName,y=t.labelClassName,v=t.label,m=t.labelFormatter,b=t.accessibilityLayer,g=void 0!==b&&b,w=Hc({margin:0,padding:10,backgroundColor:"#fff",border:"1px solid #ccc",whiteSpace:"nowrap"},a),x=Hc({margin:0},u),O=!Tt(v),j=O?v:"",S=e("recharts-default-tooltip",d),P=e("recharts-tooltip-label",y)
O&&m&&null!=f&&(j=m(v,f))
var A=g?{role:"status","aria-live":"assertive"}:{}
return o.createElement("div",qc({className:S,style:w},A),o.createElement("p",{className:P,style:x},o.isValidElement(j)?j:"".concat(j)),(()=>{if(f&&f.length){var e=(h?$c(f,h):f).map((e,t)=>{if("none"===e.type)return null
var r,i=Hc({display:"block",paddingTop:4,paddingBottom:4,color:e.color||"#000"},c),a=e.formatter||p||Vc,l=e.value,s=e.name,u=l,h=s
if(a&&null!=u&&null!=h){var d=a(l,s,e,t,f)
if(Array.isArray(d)){var y=(e=>{if(Array.isArray(e))return e})(r=d)||(e=>{var t=null==e?null:"undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"]
if(null!=t){var r,n,o,i,a=[],l=!0,c=!1
try{for(o=(t=t.call(e)).next;!(l=(r=o.call(t)).done)&&(a.push(r.value),2!==a.length);l=!0);}catch(s){c=!0,n=s}finally{try{if(!l&&null!=t.return&&(i=t.return(),Object(i)!==i))return}finally{if(c)throw n}}return a}})(r)||(e=>{if(e){if("string"==typeof e)return Wc(e,2)
var t=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===t&&e.constructor&&(t=e.constructor.name),"Map"===t||"Set"===t?Array.from(e):"Arguments"===t||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t)?Wc(e,2):void 0}})(r)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()
u=y[0],h=y[1]}else u=d}return o.createElement("li",{className:"recharts-tooltip-item",key:"tooltip-item-".concat(t),style:i},Zt(h)?o.createElement("span",{className:"recharts-tooltip-item-name"},h):null,Zt(h)?o.createElement("span",{className:"recharts-tooltip-item-separator"},n):null,o.createElement("span",{className:"recharts-tooltip-item-value"},u),o.createElement("span",{className:"recharts-tooltip-item-unit"},e.unit||""))})
return o.createElement("ul",{className:"recharts-tooltip-item-list",style:{padding:0,margin:0}},e)}return null})())}
function Gc(e){return(Gc="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Kc(e,t,r){var n
return n=(e=>{if("object"!=Gc(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Gc(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(t),(t="symbol"==Gc(n)?n:n+"")in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}var Zc="recharts-tooltip-wrapper",Jc={visibility:"hidden"}
function Qc(t){var r=t.coordinate,n=t.translateX,o=t.translateY
return e(Zc,Kc(Kc(Kc(Kc({},"".concat(Zc,"-right"),Kt(n)&&r&&Kt(r.x)&&n>=r.x),"".concat(Zc,"-left"),Kt(n)&&r&&Kt(r.x)&&n<r.x),"".concat(Zc,"-bottom"),Kt(o)&&r&&Kt(r.y)&&o>=r.y),"".concat(Zc,"-top"),Kt(o)&&r&&Kt(r.y)&&o<r.y))}function es(e){var t=e.allowEscapeViewBox,r=e.coordinate,n=e.key,o=e.offsetTopLeft,i=e.position,a=e.reverseDirection,l=e.tooltipDimension,c=e.viewBox,s=e.viewBoxDimension
if(i&&Kt(i[n]))return i[n]
var u=r[n]-l-o,f=r[n]+o
return t[n]?a[n]?u:f:a[n]?u<c[n]?Math.max(f,c[n]):Math.max(u,c[n]):f+l>c[n]+s?Math.max(u,c[n]):Math.max(f,c[n])}function ts(e){return(ts="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function rs(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function ns(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?rs(Object(r),!0).forEach(t=>{ls(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):rs(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function os(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{}))}catch(t){}return(os=()=>!!e)()}function is(e){return(is=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}function as(e,t){return(as=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function ls(e,t,r){return(t=cs(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function cs(e){var t=(e=>{if("object"!=ts(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=ts(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==ts(t)?t:t+""}var ss=function(){function e(){var t,r,n,o;((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,e)
for(var i=arguments.length,a=new Array(i),l=0;l<i;l++)a[l]=arguments[l]
return ls((r=this,n=e,o=[].concat(a),n=is(n),t=((e,t)=>{if(t&&("object"===ts(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return(e=>{if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e})(e)})(r,os()?Reflect.construct(n,o||[],is(r).constructor):n.apply(r,o))),"state",{dismissed:!1,dismissedAtCoordinate:{x:0,y:0},lastBoundingBox:{width:-1,height:-1}}),ls(t,"handleKeyDown",e=>{var r,n,o,i
"Escape"===e.key&&t.setState({dismissed:!0,dismissedAtCoordinate:{x:null!==(r=null===(n=t.props.coordinate)||void 0===n?void 0:n.x)&&void 0!==r?r:0,y:null!==(o=null===(i=t.props.coordinate)||void 0===i?void 0:i.y)&&void 0!==o?o:0}})}),t}return((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&as(e,t)})(e,n.PureComponent),t=e,(r=[{key:"updateBBox",value:function(){if(this.wrapperNode&&this.wrapperNode.getBoundingClientRect){var e=this.wrapperNode.getBoundingClientRect();(Math.abs(e.width-this.state.lastBoundingBox.width)>1||Math.abs(e.height-this.state.lastBoundingBox.height)>1)&&this.setState({lastBoundingBox:{width:e.width,height:e.height}})}else-1===this.state.lastBoundingBox.width&&-1===this.state.lastBoundingBox.height||this.setState({lastBoundingBox:{width:-1,height:-1}})}},{key:"componentDidMount",value:function(){document.addEventListener("keydown",this.handleKeyDown),this.updateBBox()}},{key:"componentWillUnmount",value:function(){document.removeEventListener("keydown",this.handleKeyDown)}},{key:"componentDidUpdate",value:function(){var e,t
this.props.active&&this.updateBBox(),this.state.dismissed&&((null===(e=this.props.coordinate)||void 0===e?void 0:e.x)===this.state.dismissedAtCoordinate.x&&(null===(t=this.props.coordinate)||void 0===t?void 0:t.y)===this.state.dismissedAtCoordinate.y||(this.state.dismissed=!1))}},{key:"render",value:function(){var e=this,t=this.props,r=t.active,n=t.allowEscapeViewBox,i=t.animationDuration,a=t.animationEasing,l=t.children,c=t.coordinate,s=t.hasPayload,u=t.isAnimationActive,f=t.offset,p=t.position,h=t.reverseDirection,d=t.useTranslate3d,y=t.viewBox,v=t.wrapperStyle,m=(e=>{var t,r,n=e.allowEscapeViewBox,o=e.coordinate,i=e.offsetTopLeft,a=e.position,l=e.reverseDirection,c=e.tooltipBox,s=e.useTranslate3d,u=e.viewBox
return{cssProperties:c.height>0&&c.width>0&&o?(e=>{var t=e.translateX,r=e.translateY
return{transform:e.useTranslate3d?"translate3d(".concat(t,"px, ").concat(r,"px, 0)"):"translate(".concat(t,"px, ").concat(r,"px)")}})({translateX:t=es({allowEscapeViewBox:n,coordinate:o,key:"x",offsetTopLeft:i,position:a,reverseDirection:l,tooltipDimension:c.width,viewBox:u,viewBoxDimension:u.width}),translateY:r=es({allowEscapeViewBox:n,coordinate:o,key:"y",offsetTopLeft:i,position:a,reverseDirection:l,tooltipDimension:c.height,viewBox:u,viewBoxDimension:u.height}),useTranslate3d:s}):Jc,cssClasses:Qc({translateX:t,translateY:r,coordinate:o})}})({allowEscapeViewBox:n,coordinate:c,offsetTopLeft:f,position:p,reverseDirection:h,tooltipBox:this.state.lastBoundingBox,useTranslate3d:d,viewBox:y}),b=m.cssClasses,g=m.cssProperties,w=ns(ns({transition:u&&r?"transform ".concat(i,"ms ").concat(a):void 0},g),{},{pointerEvents:"none",visibility:!this.state.dismissed&&r&&s?"visible":"hidden",position:"absolute",top:0,left:0},v)
return o.createElement("div",{tabIndex:-1,className:b,style:w,ref:t=>{e.wrapperNode=t}},l)}}])&&((e,t)=>{for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,cs(n.key),n)}})(t.prototype,r),Object.defineProperty(t,"prototype",{writable:!1}),t
var t,r}(),us={isSsr:!("undefined"!=typeof window&&window.document&&window.document.createElement&&window.setTimeout)}
function fs(e){return(fs="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function ps(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function hs(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?ps(Object(r),!0).forEach(t=>{ms(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):ps(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function ds(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{}))}catch(t){}return(ds=()=>!!e)()}function ys(e){return(ys=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}function vs(e,t){return(vs=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function ms(e,t,r){return(t=bs(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function bs(e){var t=(e=>{if("object"!=fs(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=fs(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==fs(t)?t:t+""}function gs(e){return e.dataKey}var ws,xs,Os,js,Ss,Ps,As,Es,Ms,_s,Ts,ks,Cs=function(){function e(){return((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,e),t=this,n=arguments,r=ys(r=e),((e,t)=>{if(t&&("object"===fs(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return(e=>{if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e})(e)})(t,ds()?Reflect.construct(r,n||[],ys(t).constructor):r.apply(t,n))
var t,r,n}return((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&vs(e,t)})(e,n.PureComponent),t=e,(r=[{key:"render",value:function(){var e=this,t=this.props,r=t.active,n=t.allowEscapeViewBox,i=t.animationDuration,a=t.animationEasing,l=t.content,c=t.coordinate,s=t.filterNull,u=t.isAnimationActive,f=t.offset,p=t.payload,h=t.payloadUniqBy,d=t.position,y=t.reverseDirection,v=t.useTranslate3d,m=t.viewBox,b=t.wrapperStyle,g=null!=p?p:[]
s&&g.length&&(g=Cl(p.filter(t=>null!=t.value&&(!0!==t.hide||e.props.includeHidden)),h,gs))
var w=g.length>0
return o.createElement(ss,{allowEscapeViewBox:n,animationDuration:i,animationEasing:a,isAnimationActive:u,active:r,coordinate:c,hasPayload:w,offset:f,position:d,reverseDirection:y,useTranslate3d:v,viewBox:m,wrapperStyle:b},((e,t)=>o.isValidElement(e)?o.cloneElement(e,t):"function"==typeof e?o.createElement(e,t):o.createElement(Yc,t))(l,hs(hs({},this.props),{},{payload:g})))}}])&&((e,t)=>{for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,bs(n.key),n)}})(t.prototype,r),Object.defineProperty(t,"prototype",{writable:!1}),t
var t,r}()
function Is(){if(Es)return As
Es=1
var e=(()=>{if(Ps)return Ss
Ps=1
var e=(()=>{if(js)return Os
js=1
var e=/\s/
return Os=t=>{for(var r=t.length;r--&&e.test(t.charAt(r)););return r}})(),t=/^\s+/
return Ss=r=>r?r.slice(0,e(r)+1).replace(t,""):r})(),t=st(),r=lt(),n=/^[-+]0x[0-9a-f]+$/i,o=/^0b[01]+$/i,i=/^0o[0-7]+$/i,a=parseInt
return As=l=>{if("number"==typeof l)return l
if(r(l))return NaN
if(t(l)){var c="function"==typeof l.valueOf?l.valueOf():l
l=t(c)?c+"":c}if("string"!=typeof l)return 0===l?l:+l
l=e(l)
var s=o.test(l)
return s||i.test(l)?a(l.slice(2),s?2:8):n.test(l)?NaN:+l}}ms(Cs,"displayName","Tooltip"),ms(Cs,"defaultProps",{accessibilityLayer:!1,allowEscapeViewBox:{x:!1,y:!1},animationDuration:400,animationEasing:"ease",contentStyle:{},coordinate:{x:0,y:0},cursor:!0,cursorStyle:{},filterNull:!0,isAnimationActive:!us.isSsr,itemStyle:{},labelStyle:{},offset:10,reverseDirection:{x:!1,y:!1},separator:" : ",trigger:"hover",useTranslate3d:!1,viewBox:{x:0,y:0,height:0,width:0},wrapperStyle:{}})
const Ds=r(function(){if(ks)return Ts
ks=1
var e=function(){if(_s)return Ms
_s=1
var e=st(),t=(()=>{if(xs)return ws
xs=1
var e=nt()
return ws=()=>e.Date.now()})(),r=Is(),n=Math.max,o=Math.min
return Ms=function(i,a,l){var c,s,u,f,p,h,d=0,y=!1,v=!1,m=!0
if("function"!=typeof i)throw new TypeError("Expected a function")
function b(e){var t=c,r=s
return c=s=void 0,d=e,f=i.apply(r,t)}function g(e){var t=e-h
return void 0===h||t>=a||t<0||v&&e-d>=u}function w(){var e=t()
if(g(e))return x(e)
p=setTimeout(w,(e=>{var t=a-(e-h)
return v?o(t,u-(e-d)):t})(e))}function x(e){return p=void 0,m&&c?b(e):(c=s=void 0,f)}function O(){var e=t(),r=g(e)
if(c=arguments,s=this,h=e,r){if(void 0===p)return(e=>(d=e,p=setTimeout(w,a),y?b(e):f))(h)
if(v)return clearTimeout(p),p=setTimeout(w,a),b(h)}return void 0===p&&(p=setTimeout(w,a)),f}return a=r(a)||0,e(l)&&(y=!!l.leading,u=(v="maxWait"in l)?n(r(l.maxWait)||0,a):u,m="trailing"in l?!!l.trailing:m),O.cancel=()=>{void 0!==p&&clearTimeout(p),d=0,c=h=s=p=void 0},O.flush=()=>void 0===p?f:x(t()),O},Ms}(),t=st()
return Ts=(r,n,o)=>{var i=!0,a=!0
if("function"!=typeof r)throw new TypeError("Expected a function")
return t(o)&&(i="leading"in o?!!o.leading:i,a="trailing"in o?!!o.trailing:a),e(r,n,{leading:i,maxWait:n,trailing:a})}}())
function Ns(e){return(Ns="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Bs(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Rs(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Bs(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=Ns(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Ns(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==Ns(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Bs(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function Ls(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}var Us=n.forwardRef((t,r)=>{var i=t.aspect,a=t.initialDimension,l=void 0===a?{width:-1,height:-1}:a,c=t.width,s=void 0===c?"100%":c,u=t.height,f=void 0===u?"100%":u,p=t.minWidth,h=void 0===p?0:p,d=t.minHeight,y=t.maxHeight,v=t.children,m=t.debounce,b=void 0===m?0:m,g=t.id,w=t.className,x=t.onResize,O=t.style,j=void 0===O?{}:O,S=n.useRef(null),P=n.useRef()
P.current=x,n.useImperativeHandle(r,()=>Object.defineProperty(S.current,"current",{get:()=>S.current,configurable:!0}))
var A,E=(e=>{if(Array.isArray(e))return e})(A=n.useState({containerWidth:l.width,containerHeight:l.height}))||(e=>{var t=null==e?null:"undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"]
if(null!=t){var r,n,o,i,a=[],l=!0,c=!1
try{for(o=(t=t.call(e)).next;!(l=(r=o.call(t)).done)&&(a.push(r.value),2!==a.length);l=!0);}catch(s){c=!0,n=s}finally{try{if(!l&&null!=t.return&&(i=t.return(),Object(i)!==i))return}finally{if(c)throw n}}return a}})(A)||(e=>{if(e){if("string"==typeof e)return Ls(e,2)
var t=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===t&&e.constructor&&(t=e.constructor.name),"Map"===t||"Set"===t?Array.from(e):"Arguments"===t||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t)?Ls(e,2):void 0}})(A)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})(),M=E[0],_=E[1],T=n.useCallback((e,t)=>{_(r=>{var n=Math.round(e),o=Math.round(t)
return r.containerWidth===n&&r.containerHeight===o?r:{containerWidth:n,containerHeight:o}})},[])
n.useEffect(()=>{var e=e=>{var t,r=e[0].contentRect,n=r.width,o=r.height
T(n,o),null===(t=P.current)||void 0===t||t.call(P,n,o)}
b>0&&(e=Ds(e,b,{trailing:!0,leading:!1}))
var t=new ResizeObserver(e),r=S.current.getBoundingClientRect(),n=r.width,o=r.height
return T(n,o),t.observe(S.current),()=>{t.disconnect()}},[T,b])
var k=n.useMemo(()=>{var e=M.containerWidth,t=M.containerHeight
if(e<0||t<0)return null
Qr(Gt(s)||Gt(f),"The width(%s) and height(%s) are both fixed numbers,\n       maybe you don't need to use a ResponsiveContainer.",s,f),Qr(!i||i>0,"The aspect(%s) must be greater than zero.",i)
var r=Gt(s)?e:s,a=Gt(f)?t:f
i&&i>0&&(r?a=r/i:a&&(r=a*i),y&&a>y&&(a=y)),Qr(r>0||a>0,"The width(%s) and height(%s) of chart should be greater than 0,\n       please check the style of container, or the props width(%s) and height(%s),\n       or add a minWidth(%s) or minHeight(%s) or use aspect(%s) to control the\n       height and width.",r,a,s,f,h,d,i)
var l=!Array.isArray(v)&&br(v.type).endsWith("Chart")
return o.Children.map(v,e=>o.isValidElement(e)?n.cloneElement(e,Rs({width:r,height:a},l?{style:Rs({height:"100%",width:"100%",maxHeight:a,maxWidth:r},e.props.style)}:{})):e)},[i,v,f,y,d,h,M,s])
return o.createElement("div",{id:g?"".concat(g):void 0,className:e("recharts-responsive-container",w),style:Rs(Rs({},j),{},{width:s,height:f,minWidth:h,minHeight:d,maxHeight:y}),ref:S},k)}),zs=()=>null
function $s(e){return($s="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Fs(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function qs(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Fs(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=$s(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=$s(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==$s(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Fs(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}zs.displayName="Cell"
var Ws={widthCache:{},cacheCount:0},Xs={position:"absolute",top:"-20000px",left:0,padding:0,margin:0,border:"none",whiteSpace:"pre"},Hs="recharts_measurement_span",Vs=function(e){if(null==e||us.isSsr)return{width:0,height:0}
var t,r=(t=qs({},arguments.length>1&&void 0!==arguments[1]?arguments[1]:{}),Object.keys(t).forEach(e=>{t[e]||delete t[e]}),t),n=JSON.stringify({text:e,copyStyle:r})
if(Ws.widthCache[n])return Ws.widthCache[n]
try{var o=document.getElementById(Hs)
o||((o=document.createElement("span")).setAttribute("id",Hs),o.setAttribute("aria-hidden","true"),document.body.appendChild(o))
var i=qs(qs({},Xs),r)
Object.assign(o.style,i),o.textContent="".concat(e)
var a=o.getBoundingClientRect(),l={width:a.width,height:a.height}
return Ws.widthCache[n]=l,++Ws.cacheCount>2e3&&(Ws.cacheCount=0,Ws.widthCache={}),l}catch(c){return{width:0,height:0}}}
function Ys(e){return(Ys="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Gs(e,t){return(e=>{if(Array.isArray(e))return e})(e)||((e,t)=>{var r=null==e?null:"undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"]
if(null!=r){var n,o,i,a,l=[],c=!0,s=!1
try{if(i=(r=r.call(e)).next,0===t){if(Object(r)!==r)return
c=!1}else for(;!(c=(n=i.call(r)).done)&&(l.push(n.value),l.length!==t);c=!0);}catch(u){s=!0,o=u}finally{try{if(!c&&null!=r.return&&(a=r.return(),Object(a)!==a))return}finally{if(s)throw o}}return l}})(e,t)||((e,t)=>{if(e){if("string"==typeof e)return Ks(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?Ks(e,t):void 0}})(e,t)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()}function Ks(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function Zs(e,t){for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,Js(n.key),n)}}function Js(e){var t=(e=>{if("object"!=Ys(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Ys(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==Ys(t)?t:t+""}var Qs=/(-?\d+(?:\.\d+)?[a-zA-Z%]*)([*/])(-?\d+(?:\.\d+)?[a-zA-Z%]*)/,eu=/(-?\d+(?:\.\d+)?[a-zA-Z%]*)([+-])(-?\d+(?:\.\d+)?[a-zA-Z%]*)/,tu=/^px|cm|vh|vw|em|rem|%|mm|in|pt|pc|ex|ch|vmin|vmax|Q$/,ru=/(-?\d+(?:\.\d+)?)([a-zA-Z%]+)?/,nu={cm:96/2.54,mm:96/25.4,pt:96/72,pc:16,in:96,Q:96/101.6,px:1},ou=Object.keys(nu),iu="NaN",au=function(){function e(t,r){((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,e),this.num=t,this.unit=r,this.num=t,this.unit=r,Number.isNaN(t)&&(this.unit=""),""===r||tu.test(r)||(this.num=NaN,this.unit=""),ou.includes(r)&&(this.num=((e,t)=>e*nu[t])(t,r),this.unit="px")}return t=e,n=[{key:"parse",value:t=>{var r,n=Gs(null!==(r=ru.exec(t))&&void 0!==r?r:[],3),o=n[1],i=n[2]
return new e(parseFloat(o),null!=i?i:"")}}],(r=[{key:"add",value:function(t){return this.unit!==t.unit?new e(NaN,""):new e(this.num+t.num,this.unit)}},{key:"subtract",value:function(t){return this.unit!==t.unit?new e(NaN,""):new e(this.num-t.num,this.unit)}},{key:"multiply",value:function(t){return""!==this.unit&&""!==t.unit&&this.unit!==t.unit?new e(NaN,""):new e(this.num*t.num,this.unit||t.unit)}},{key:"divide",value:function(t){return""!==this.unit&&""!==t.unit&&this.unit!==t.unit?new e(NaN,""):new e(this.num/t.num,this.unit||t.unit)}},{key:"toString",value:function(){return"".concat(this.num).concat(this.unit)}},{key:"isNaN",value:function(){return Number.isNaN(this.num)}}])&&Zs(t.prototype,r),n&&Zs(t,n),Object.defineProperty(t,"prototype",{writable:!1}),t
var t,r,n}()
function lu(e){if(e.includes(iu))return iu
for(var t=e;t.includes("*")||t.includes("/");){var r,n=Gs(null!==(r=Qs.exec(t))&&void 0!==r?r:[],4),o=n[1],i=n[2],a=n[3],l=au.parse(null!=o?o:""),c=au.parse(null!=a?a:""),s="*"===i?l.multiply(c):l.divide(c)
if(s.isNaN())return iu
t=t.replace(Qs,s.toString())}for(;t.includes("+")||/.-\d+(?:\.\d+)?/.test(t);){var u,f=Gs(null!==(u=eu.exec(t))&&void 0!==u?u:[],4),p=f[1],h=f[2],d=f[3],y=au.parse(null!=p?p:""),v=au.parse(null!=d?d:""),m="+"===h?y.add(v):y.subtract(v)
if(m.isNaN())return iu
t=t.replace(eu,m.toString())}return t}var cu=/\(([^()]*)\)/
function su(e){var t=(e=>{try{return(e=>{var t=e.replace(/\s+/g,"")
return t=(e=>{for(var t=e;t.includes("(");){var r=Gs(cu.exec(t),2)[1]
t=t.replace(cu,lu(r))}return t})(t),lu(t)})(e)}catch(t){return iu}})(e.slice(5,-1))
return t===iu?"":t}var uu=["x","y","lineHeight","capHeight","scaleToFit","textAnchor","verticalAnchor","fill"],fu=["dx","dy","angle","className","breakAll"]
function pu(){return pu=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},pu.apply(this,arguments)}function hu(e,t){if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o}function du(e,t){return(e=>{if(Array.isArray(e))return e})(e)||((e,t)=>{var r=null==e?null:"undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"]
if(null!=r){var n,o,i,a,l=[],c=!0,s=!1
try{if(i=(r=r.call(e)).next,0===t){if(Object(r)!==r)return
c=!1}else for(;!(c=(n=i.call(r)).done)&&(l.push(n.value),l.length!==t);c=!0);}catch(u){s=!0,o=u}finally{try{if(!c&&null!=r.return&&(a=r.return(),Object(a)!==a))return}finally{if(s)throw o}}return l}})(e,t)||((e,t)=>{if(e){if("string"==typeof e)return yu(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?yu(e,t):void 0}})(e,t)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()}function yu(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}var vu=/[ \f\n\r\t\v\u2028\u2029]+/,mu=e=>{var t=e.children,r=e.breakAll,n=e.style
try{var o=[]
return Tt(t)||(o=r?t.toString().split(""):t.toString().split(vu)),{wordsWithComputedWidth:o.map(e=>({word:e,width:Vs(e,n).width})),spaceWidth:r?0:Vs(" ",n).width}}catch(i){return null}},bu=e=>[{words:Tt(e)?[]:e.toString().split(vu)}],gu="#808080",wu=t=>{var r=t.x,i=void 0===r?0:r,a=t.y,l=void 0===a?0:a,c=t.lineHeight,s=void 0===c?"1em":c,u=t.capHeight,f=void 0===u?"0.71em":u,p=t.scaleToFit,h=void 0!==p&&p,d=t.textAnchor,y=void 0===d?"start":d,v=t.verticalAnchor,m=void 0===v?"end":v,b=t.fill,g=void 0===b?gu:b,w=hu(t,uu),x=n.useMemo(()=>(e=>{var t=e.width,r=e.scaleToFit,n=e.children,o=e.style,i=e.breakAll,a=e.maxLines
if((t||r)&&!us.isSsr){var l=mu({breakAll:i,children:n,style:o})
return l?((e,t,r,n,o)=>{var i=e.maxLines,a=e.children,l=e.style,c=e.breakAll,s=Kt(i),u=a,f=function(){return(arguments.length>0&&void 0!==arguments[0]?arguments[0]:[]).reduce((e,t)=>{var i=t.word,a=t.width,l=e[e.length-1]
if(l&&(null==n||o||l.width+a+r<Number(n)))l.words.push(i),l.width+=a+r
else{var c={words:[i],width:a}
e.push(c)}return e},[])},p=f(t)
if(!s)return p
for(var h,d=e=>{var t=u.slice(0,e),r=mu({breakAll:c,style:l,children:t+"…"}).wordsWithComputedWidth,o=f(r),a=o.length>i||(e=>e.reduce((e,t)=>e.width>t.width?e:t))(o).width>Number(n)
return[a,o]},y=0,v=u.length-1,m=0;y<=v&&m<=u.length-1;){var b=Math.floor((y+v)/2),g=du(d(b-1),2),w=g[0],x=g[1],O=du(d(b),1)[0]
if(w||O||(y=b+1),w&&O&&(v=b-1),!w&&O){h=x
break}m++}return h||p})({breakAll:i,children:n,maxLines:a,style:o},l.wordsWithComputedWidth,l.spaceWidth,t,r):bu(n)}return bu(n)})({breakAll:w.breakAll,children:w.children,maxLines:w.maxLines,scaleToFit:h,style:w.style,width:w.width}),[w.breakAll,w.children,w.maxLines,h,w.style,w.width]),O=w.dx,j=w.dy,S=w.angle,P=w.className,A=w.breakAll,E=hu(w,fu)
if(!Zt(i)||!Zt(l))return null
var M,_=i+(Kt(O)?O:0),T=l+(Kt(j)?j:0)
switch(m){case"start":M=su("calc(".concat(f,")"))
break
case"middle":M=su("calc(".concat((x.length-1)/2," * -").concat(s," + (").concat(f," / 2))"))
break
default:M=su("calc(".concat(x.length-1," * -").concat(s,")"))}var k=[]
if(h){var C=x[0].width,I=w.width
k.push("scale(".concat((Kt(I)?I/C:1)/C,")"))}return S&&k.push("rotate(".concat(S,", ").concat(_,", ").concat(T,")")),k.length&&(E.transform=k.join(" ")),o.createElement("text",pu({},Er(E,!0),{x:_,y:T,className:e("recharts-text",P),textAnchor:y,fill:g.includes("url")?gu:g}),x.map((e,t)=>{var r=e.words.join(A?"":" ")
return o.createElement("tspan",{x:_,dy:0===t?M:s,key:"".concat(r,"-").concat(t)},r)}))}
function xu(e,t){return null==e||null==t?NaN:e<t?-1:e>t?1:e>=t?0:NaN}function Ou(e,t){return null==e||null==t?NaN:t<e?-1:t>e?1:t>=e?0:NaN}function ju(e){let t,r,n
function o(e,n,o=0,i=e.length){if(o<i){if(0!==t(n,n))return i
do{const t=o+i>>>1
r(e[t],n)<0?o=t+1:i=t}while(o<i)}return o}return 2!==e.length?(t=xu,r=(t,r)=>xu(e(t),r),n=(t,r)=>e(t)-r):(t=e===xu||e===Ou?e:Su,r=e,n=e),{left:o,center:(e,t,r=0,i=e.length)=>{const a=o(e,t,r,i-1)
return a>r&&n(e[a-1],t)>-n(e[a],t)?a-1:a},right:(e,n,o=0,i=e.length)=>{if(o<i){if(0!==t(n,n))return i
do{const t=o+i>>>1
r(e[t],n)<=0?o=t+1:i=t}while(o<i)}return o}}}function Su(){return 0}function Pu(e){return null===e?NaN:+e}const Au=ju(xu).right
ju(Pu).center
class Eu extends Map{constructor(e,t=_u){if(super(),Object.defineProperties(this,{_intern:{value:new Map},_key:{value:t}}),null!=e)for(const[r,n]of e)this.set(r,n)}get(e){return super.get(Mu(this,e))}has(e){return super.has(Mu(this,e))}set(e,t){return super.set((({_intern:e,_key:t},r)=>{const n=t(r)
return e.has(n)?e.get(n):(e.set(n,r),r)})(this,e),t)}delete(e){return super.delete((({_intern:e,_key:t},r)=>{const n=t(r)
return e.has(n)&&(r=e.get(n),e.delete(n)),r})(this,e))}}function Mu({_intern:e,_key:t},r){const n=t(r)
return e.has(n)?e.get(n):r}function _u(e){return null!==e&&"object"==typeof e?e.valueOf():e}function Tu(e,t){return(null==e||!(e>=e))-(null==t||!(t>=t))||(e<t?-1:e>t?1:0)}const ku=Math.sqrt(50),Cu=Math.sqrt(10),Iu=Math.sqrt(2)
function Du(e,t,r){const n=(t-e)/Math.max(0,r),o=Math.floor(Math.log10(n)),i=n/Math.pow(10,o),a=i>=ku?10:i>=Cu?5:i>=Iu?2:1
let l,c,s
return o<0?(s=Math.pow(10,-o)/a,l=Math.round(e*s),c=Math.round(t*s),l/s<e&&++l,c/s>t&&--c,s=-s):(s=Math.pow(10,o)*a,l=Math.round(e/s),c=Math.round(t/s),l*s<e&&++l,c*s>t&&--c),c<l&&.5<=r&&r<2?Du(e,t,2*r):[l,c,s]}function Nu(e,t,r){if(!((r=+r)>0))return[]
if((e=+e)===(t=+t))return[e]
const n=t<e,[o,i,a]=n?Du(t,e,r):Du(e,t,r)
if(!(i>=o))return[]
const l=i-o+1,c=new Array(l)
if(n)if(a<0)for(let s=0;s<l;++s)c[s]=(i-s)/-a
else for(let s=0;s<l;++s)c[s]=(i-s)*a
else if(a<0)for(let s=0;s<l;++s)c[s]=(o+s)/-a
else for(let s=0;s<l;++s)c[s]=(o+s)*a
return c}function Bu(e,t,r){return Du(e=+e,t=+t,r=+r)[2]}function Ru(e,t,r){r=+r
const n=(t=+t)<(e=+e),o=n?Bu(t,e,r):Bu(e,t,r)
return(n?-1:1)*(o<0?1/-o:o)}function Lu(e){let t
for(const r of e)null!=r&&(t<r||void 0===t&&r>=r)&&(t=r)
return t}function Uu(e){let t
for(const r of e)null!=r&&(t>r||void 0===t&&r>=r)&&(t=r)
return t}function zu(e,t,r=0,n=1/0,o){if(t=Math.floor(t),r=Math.floor(Math.max(0,r)),n=Math.floor(Math.min(e.length-1,n)),!(r<=t&&t<=n))return e
for(o=void 0===o?Tu:((e=xu)=>{if(e===xu)return Tu
if("function"!=typeof e)throw new TypeError("compare is not a function")
return(t,r)=>{const n=e(t,r)
return n||0===n?n:(0===e(r,r))-(0===e(t,t))}})(o);n>r;){if(n-r>600){const i=n-r+1,a=t-r+1,l=Math.log(i),c=.5*Math.exp(2*l/3),s=.5*Math.sqrt(l*c*(i-c)/i)*(a-i/2<0?-1:1)
zu(e,t,Math.max(r,Math.floor(t-a*c/i+s)),Math.min(n,Math.floor(t+(i-a)*c/i+s)),o)}const i=e[t]
let a=r,l=n
for($u(e,r,t),o(e[n],i)>0&&$u(e,r,n);a<l;){for($u(e,a,l),++a,--l;o(e[a],i)<0;)++a
for(;o(e[l],i)>0;)--l}0===o(e[r],i)?$u(e,r,l):(++l,$u(e,l,n)),l<=t&&(r=l+1),t<=l&&(n=l-1)}return e}function $u(e,t,r){const n=e[t]
e[t]=e[r],e[r]=n}function Fu(e,t,r=Pu){if((n=e.length)&&!isNaN(t=+t)){if(t<=0||n<2)return+r(e[0],0,e)
if(t>=1)return+r(e[n-1],n-1,e)
var n,o=(n-1)*t,i=Math.floor(o),a=+r(e[i],i,e)
return a+(+r(e[i+1],i+1,e)-a)*(o-i)}}function qu(e,t){switch(arguments.length){case 0:break
case 1:this.range(e)
break
default:this.range(t).domain(e)}return this}function Wu(e,t){switch(arguments.length){case 0:break
case 1:"function"==typeof e?this.interpolator(e):this.range(e)
break
default:this.domain(e),"function"==typeof t?this.interpolator(t):this.range(t)}return this}const Xu=Symbol("implicit")
function Hu(){var e=new Eu,t=[],r=[],n=Xu
function o(o){let i=e.get(o)
if(void 0===i){if(n!==Xu)return n
e.set(o,i=t.push(o)-1)}return r[i%r.length]}return o.domain=function(r){if(!arguments.length)return t.slice()
t=[],e=new Eu
for(const n of r)e.has(n)||e.set(n,t.push(n)-1)
return o},o.range=function(e){return arguments.length?(r=Array.from(e),o):r.slice()},o.unknown=function(e){return arguments.length?(n=e,o):n},o.copy=()=>Hu(t,r).unknown(n),qu.apply(o,arguments),o}function Vu(){var e,t,r=Hu().unknown(void 0),n=r.domain,o=r.range,i=0,a=1,l=!1,c=0,s=0,u=.5
function f(){var r=n().length,f=a<i,p=f?a:i,h=f?i:a
e=(h-p)/Math.max(1,r-c+2*s),l&&(e=Math.floor(e)),p+=(h-p-e*(r-c))*u,t=e*(1-c),l&&(p=Math.round(p),t=Math.round(t))
var d=function(e,t,r){e=+e,t=+t,r=(o=arguments.length)<2?(t=e,e=0,1):o<3?1:+r
for(var n=-1,o=0|Math.max(0,Math.ceil((t-e)/r)),i=new Array(o);++n<o;)i[n]=e+n*r
return i}(r).map(t=>p+e*t)
return o(f?d.reverse():d)}return delete r.unknown,r.domain=function(e){return arguments.length?(n(e),f()):n()},r.range=function(e){return arguments.length?([i,a]=e,i=+i,a=+a,f()):[i,a]},r.rangeRound=e=>([i,a]=e,i=+i,a=+a,l=!0,f()),r.bandwidth=()=>t,r.step=()=>e,r.round=function(e){return arguments.length?(l=!!e,f()):l},r.padding=function(e){return arguments.length?(c=Math.min(1,s=+e),f()):c},r.paddingInner=function(e){return arguments.length?(c=Math.min(1,e),f()):c},r.paddingOuter=function(e){return arguments.length?(s=+e,f()):s},r.align=function(e){return arguments.length?(u=Math.max(0,Math.min(1,e)),f()):u},r.copy=()=>Vu(n(),[i,a]).round(l).paddingInner(c).paddingOuter(s).align(u),qu.apply(f(),arguments)}function Yu(e){var t=e.copy
return e.padding=e.paddingOuter,delete e.paddingInner,delete e.paddingOuter,e.copy=()=>Yu(t()),e}function Gu(){return Yu(Vu.apply(null,arguments).paddingInner(1))}function Ku(e,t,r){e.prototype=t.prototype=r,r.constructor=e}function Zu(e,t){var r=Object.create(e.prototype)
for(var n in t)r[n]=t[n]
return r}function Ju(){}var Qu=.7,ef=1/Qu,tf="\\s*([+-]?\\d+)\\s*",rf="\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)\\s*",nf="\\s*([+-]?(?:\\d*\\.)?\\d+(?:[eE][+-]?\\d+)?)%\\s*",of=/^#([0-9a-f]{3,8})$/,af=new RegExp(`^rgb\\(${tf},${tf},${tf}\\)$`),lf=new RegExp(`^rgb\\(${nf},${nf},${nf}\\)$`),cf=new RegExp(`^rgba\\(${tf},${tf},${tf},${rf}\\)$`),sf=new RegExp(`^rgba\\(${nf},${nf},${nf},${rf}\\)$`),uf=new RegExp(`^hsl\\(${rf},${nf},${nf}\\)$`),ff=new RegExp(`^hsla\\(${rf},${nf},${nf},${rf}\\)$`),pf={aliceblue:15792383,antiquewhite:16444375,aqua:65535,aquamarine:8388564,azure:15794175,beige:16119260,bisque:16770244,black:0,blanchedalmond:16772045,blue:255,blueviolet:9055202,brown:10824234,burlywood:14596231,cadetblue:6266528,chartreuse:8388352,chocolate:13789470,coral:16744272,cornflowerblue:6591981,cornsilk:16775388,crimson:14423100,cyan:65535,darkblue:139,darkcyan:35723,darkgoldenrod:12092939,darkgray:11119017,darkgreen:25600,darkgrey:11119017,darkkhaki:12433259,darkmagenta:9109643,darkolivegreen:5597999,darkorange:16747520,darkorchid:10040012,darkred:9109504,darksalmon:15308410,darkseagreen:9419919,darkslateblue:4734347,darkslategray:3100495,darkslategrey:3100495,darkturquoise:52945,darkviolet:9699539,deeppink:16716947,deepskyblue:49151,dimgray:6908265,dimgrey:6908265,dodgerblue:2003199,firebrick:11674146,floralwhite:16775920,forestgreen:2263842,fuchsia:16711935,gainsboro:14474460,ghostwhite:16316671,gold:16766720,goldenrod:14329120,gray:8421504,green:32768,greenyellow:11403055,grey:8421504,honeydew:15794160,hotpink:16738740,indianred:13458524,indigo:4915330,ivory:16777200,khaki:15787660,lavender:15132410,lavenderblush:16773365,lawngreen:8190976,lemonchiffon:16775885,lightblue:11393254,lightcoral:15761536,lightcyan:14745599,lightgoldenrodyellow:16448210,lightgray:13882323,lightgreen:9498256,lightgrey:13882323,lightpink:16758465,lightsalmon:16752762,lightseagreen:2142890,lightskyblue:8900346,lightslategray:7833753,lightslategrey:7833753,lightsteelblue:11584734,lightyellow:16777184,lime:65280,limegreen:3329330,linen:16445670,magenta:16711935,maroon:8388608,mediumaquamarine:6737322,mediumblue:205,mediumorchid:12211667,mediumpurple:9662683,mediumseagreen:3978097,mediumslateblue:8087790,mediumspringgreen:64154,mediumturquoise:4772300,mediumvioletred:13047173,midnightblue:1644912,mintcream:16121850,mistyrose:16770273,moccasin:16770229,navajowhite:16768685,navy:128,oldlace:16643558,olive:8421376,olivedrab:7048739,orange:16753920,orangered:16729344,orchid:14315734,palegoldenrod:15657130,palegreen:10025880,paleturquoise:11529966,palevioletred:14381203,papayawhip:16773077,peachpuff:16767673,peru:13468991,pink:16761035,plum:14524637,powderblue:11591910,purple:8388736,rebeccapurple:6697881,red:16711680,rosybrown:12357519,royalblue:4286945,saddlebrown:9127187,salmon:16416882,sandybrown:16032864,seagreen:3050327,seashell:16774638,sienna:10506797,silver:12632256,skyblue:8900331,slateblue:6970061,slategray:7372944,slategrey:7372944,snow:16775930,springgreen:65407,steelblue:4620980,tan:13808780,teal:32896,thistle:14204888,tomato:16737095,turquoise:4251856,violet:15631086,wheat:16113331,white:16777215,whitesmoke:16119285,yellow:16776960,yellowgreen:10145074}
function hf(){return this.rgb().formatHex()}function df(){return this.rgb().formatRgb()}function yf(e){var t,r
return e=(e+"").trim().toLowerCase(),(t=of.exec(e))?(r=t[1].length,t=parseInt(t[1],16),6===r?vf(t):3===r?new gf(t>>8&15|t>>4&240,t>>4&15|240&t,(15&t)<<4|15&t,1):8===r?mf(t>>24&255,t>>16&255,t>>8&255,(255&t)/255):4===r?mf(t>>12&15|t>>8&240,t>>8&15|t>>4&240,t>>4&15|240&t,((15&t)<<4|15&t)/255):null):(t=af.exec(e))?new gf(t[1],t[2],t[3],1):(t=lf.exec(e))?new gf(255*t[1]/100,255*t[2]/100,255*t[3]/100,1):(t=cf.exec(e))?mf(t[1],t[2],t[3],t[4]):(t=sf.exec(e))?mf(255*t[1]/100,255*t[2]/100,255*t[3]/100,t[4]):(t=uf.exec(e))?Pf(t[1],t[2]/100,t[3]/100,1):(t=ff.exec(e))?Pf(t[1],t[2]/100,t[3]/100,t[4]):pf.hasOwnProperty(e)?vf(pf[e]):"transparent"===e?new gf(NaN,NaN,NaN,0):null}function vf(e){return new gf(e>>16&255,e>>8&255,255&e,1)}function mf(e,t,r,n){return n<=0&&(e=t=r=NaN),new gf(e,t,r,n)}function bf(e,t,r,n){return 1===arguments.length?((o=e)instanceof Ju||(o=yf(o)),o?new gf((o=o.rgb()).r,o.g,o.b,o.opacity):new gf):new gf(e,t,r,n??1)
var o}function gf(e,t,r,n){this.r=+e,this.g=+t,this.b=+r,this.opacity=+n}function wf(){return`#${Sf(this.r)}${Sf(this.g)}${Sf(this.b)}`}function xf(){const e=Of(this.opacity)
return`${1===e?"rgb(":"rgba("}${jf(this.r)}, ${jf(this.g)}, ${jf(this.b)}${1===e?")":`, ${e})`}`}function Of(e){return isNaN(e)?1:Math.max(0,Math.min(1,e))}function jf(e){return Math.max(0,Math.min(255,Math.round(e)||0))}function Sf(e){return((e=jf(e))<16?"0":"")+e.toString(16)}function Pf(e,t,r,n){return n<=0?e=t=r=NaN:r<=0||r>=1?e=t=NaN:t<=0&&(e=NaN),new Ef(e,t,r,n)}function Af(e){if(e instanceof Ef)return new Ef(e.h,e.s,e.l,e.opacity)
if(e instanceof Ju||(e=yf(e)),!e)return new Ef
if(e instanceof Ef)return e
var t=(e=e.rgb()).r/255,r=e.g/255,n=e.b/255,o=Math.min(t,r,n),i=Math.max(t,r,n),a=NaN,l=i-o,c=(i+o)/2
return l?(a=t===i?(r-n)/l+6*(r<n):r===i?(n-t)/l+2:(t-r)/l+4,l/=c<.5?i+o:2-i-o,a*=60):l=c>0&&c<1?0:a,new Ef(a,l,c,e.opacity)}function Ef(e,t,r,n){this.h=+e,this.s=+t,this.l=+r,this.opacity=+n}function Mf(e){return(e=(e||0)%360)<0?e+360:e}function _f(e){return Math.max(0,Math.min(1,e||0))}function Tf(e,t,r){return 255*(e<60?t+(r-t)*e/60:e<180?r:e<240?t+(r-t)*(240-e)/60:t)}Ku(Ju,yf,{copy(e){return Object.assign(new this.constructor,this,e)},displayable(){return this.rgb().displayable()},hex:hf,formatHex:hf,formatHex8:function(){return this.rgb().formatHex8()},formatHsl:function(){return Af(this).formatHsl()},formatRgb:df,toString:df}),Ku(gf,bf,Zu(Ju,{brighter(e){return e=null==e?ef:Math.pow(ef,e),new gf(this.r*e,this.g*e,this.b*e,this.opacity)},darker(e){return e=null==e?Qu:Math.pow(Qu,e),new gf(this.r*e,this.g*e,this.b*e,this.opacity)},rgb(){return this},clamp(){return new gf(jf(this.r),jf(this.g),jf(this.b),Of(this.opacity))},displayable(){return-.5<=this.r&&this.r<255.5&&-.5<=this.g&&this.g<255.5&&-.5<=this.b&&this.b<255.5&&0<=this.opacity&&this.opacity<=1},hex:wf,formatHex:wf,formatHex8:function(){return`#${Sf(this.r)}${Sf(this.g)}${Sf(this.b)}${Sf(255*(isNaN(this.opacity)?1:this.opacity))}`},formatRgb:xf,toString:xf})),Ku(Ef,function(e,t,r,n){return 1===arguments.length?Af(e):new Ef(e,t,r,n??1)},Zu(Ju,{brighter(e){return e=null==e?ef:Math.pow(ef,e),new Ef(this.h,this.s,this.l*e,this.opacity)},darker(e){return e=null==e?Qu:Math.pow(Qu,e),new Ef(this.h,this.s,this.l*e,this.opacity)},rgb(){var e=this.h%360+360*(this.h<0),t=isNaN(e)||isNaN(this.s)?0:this.s,r=this.l,n=r+(r<.5?r:1-r)*t,o=2*r-n
return new gf(Tf(e>=240?e-240:e+120,o,n),Tf(e,o,n),Tf(e<120?e+240:e-120,o,n),this.opacity)},clamp(){return new Ef(Mf(this.h),_f(this.s),_f(this.l),Of(this.opacity))},displayable(){return(0<=this.s&&this.s<=1||isNaN(this.s))&&0<=this.l&&this.l<=1&&0<=this.opacity&&this.opacity<=1},formatHsl(){const e=Of(this.opacity)
return`${1===e?"hsl(":"hsla("}${Mf(this.h)}, ${100*_f(this.s)}%, ${100*_f(this.l)}%${1===e?")":`, ${e})`}`}}))
const kf=e=>()=>e
function Cf(e,t){var r=t-e
return r?((e,t)=>r=>e+r*t)(e,r):kf(isNaN(e)?t:e)}const If=function e(t){var r=(e=>1===(e=+e)?Cf:(t,r)=>r-t?((e,t,r)=>(e=Math.pow(e,r),t=Math.pow(t,r)-e,r=1/r,n=>Math.pow(e+n*t,r)))(t,r,e):kf(isNaN(t)?r:t))(t)
function n(e,t){var n=r((e=bf(e)).r,(t=bf(t)).r),o=r(e.g,t.g),i=r(e.b,t.b),a=Cf(e.opacity,t.opacity)
return t=>(e.r=n(t),e.g=o(t),e.b=i(t),e.opacity=a(t),e+"")}return n.gamma=e,n}(1)
function Df(e,t){t||(t=[])
var r,n=e?Math.min(t.length,e.length):0,o=t.slice()
return i=>{for(r=0;r<n;++r)o[r]=e[r]*(1-i)+t[r]*i
return o}}function Nf(e,t){var r,n=t?t.length:0,o=e?Math.min(n,e.length):0,i=new Array(o),a=new Array(n)
for(r=0;r<o;++r)i[r]=Ff(e[r],t[r])
for(;r<n;++r)a[r]=t[r]
return e=>{for(r=0;r<o;++r)a[r]=i[r](e)
return a}}function Bf(e,t){var r=new Date
return e=+e,t=+t,n=>(r.setTime(e*(1-n)+t*n),r)}function Rf(e,t){return e=+e,t=+t,r=>e*(1-r)+t*r}function Lf(e,t){var r,n={},o={}
for(r in null!==e&&"object"==typeof e||(e={}),null!==t&&"object"==typeof t||(t={}),t)r in e?n[r]=Ff(e[r],t[r]):o[r]=t[r]
return e=>{for(r in n)o[r]=n[r](e)
return o}}var Uf=/[-+]?(?:\d+\.?\d*|\.?\d+)(?:[eE][-+]?\d+)?/g,zf=new RegExp(Uf.source,"g")
function $f(e,t){var r,n,o,i=Uf.lastIndex=zf.lastIndex=0,a=-1,l=[],c=[]
for(e+="",t+="";(r=Uf.exec(e))&&(n=zf.exec(t));)(o=n.index)>i&&(o=t.slice(i,o),l[a]?l[a]+=o:l[++a]=o),(r=r[0])===(n=n[0])?l[a]?l[a]+=n:l[++a]=n:(l[++a]=null,c.push({i:a,x:Rf(r,n)})),i=zf.lastIndex
return i<t.length&&(o=t.slice(i),l[a]?l[a]+=o:l[++a]=o),l.length<2?c[0]?(e=>t=>e(t)+"")(c[0].x):(e=>()=>e)(t):(t=c.length,e=>{for(var r,n=0;n<t;++n)l[(r=c[n]).i]=r.x(e)
return l.join("")})}function Ff(e,t){var r,n,o=typeof t
return null==t||"boolean"===o?kf(t):("number"===o?Rf:"string"===o?(r=yf(t))?(t=r,If):$f:t instanceof yf?If:t instanceof Date?Bf:(n=t,!ArrayBuffer.isView(n)||n instanceof DataView?Array.isArray(t)?Nf:"function"!=typeof t.valueOf&&"function"!=typeof t.toString||isNaN(t)?Lf:Rf:Df))(e,t)}function qf(e,t){return e=+e,t=+t,r=>Math.round(e*(1-r)+t*r)}function Wf(e){return+e}var Xf=[0,1]
function Hf(e){return e}function Vf(e,t){return(t-=e=+e)?r=>(r-e)/t:(r=isNaN(t)?NaN:.5,()=>r)
var r}function Yf(e,t,r){var n=e[0],o=e[1],i=t[0],a=t[1]
return o<n?(n=Vf(o,n),i=r(a,i)):(n=Vf(n,o),i=r(i,a)),e=>i(n(e))}function Gf(e,t,r){var n=Math.min(e.length,t.length)-1,o=new Array(n),i=new Array(n),a=-1
for(e[n]<e[0]&&(e=e.slice().reverse(),t=t.slice().reverse());++a<n;)o[a]=Vf(e[a],e[a+1]),i[a]=r(t[a],t[a+1])
return t=>{var r=Au(e,t,1,n)-1
return i[r](o[r](t))}}function Kf(e,t){return t.domain(e.domain()).range(e.range()).interpolate(e.interpolate()).clamp(e.clamp()).unknown(e.unknown())}function Zf(){var e,t,r,n,o,i,a=Xf,l=Xf,c=Ff,s=Hf
function u(){var e,t,r,c=Math.min(a.length,l.length)
return s!==Hf&&(e=a[0],t=a[c-1],e>t&&(r=e,e=t,t=r),s=r=>Math.max(e,Math.min(t,r))),n=c>2?Gf:Yf,o=i=null,f}function f(t){return null==t||isNaN(t=+t)?r:(o||(o=n(a.map(e),l,c)))(e(s(t)))}return f.invert=r=>s(t((i||(i=n(l,a.map(e),Rf)))(r))),f.domain=function(e){return arguments.length?(a=Array.from(e,Wf),u()):a.slice()},f.range=function(e){return arguments.length?(l=Array.from(e),u()):l.slice()},f.rangeRound=e=>(l=Array.from(e),c=qf,u()),f.clamp=function(e){return arguments.length?(s=!!e||Hf,u()):s!==Hf},f.interpolate=function(e){return arguments.length?(c=e,u()):c},f.unknown=function(e){return arguments.length?(r=e,f):r},(r,n)=>(e=r,t=n,u())}function Jf(){return Zf()(Hf,Hf)}function Qf(e,t){if(!isFinite(e)||0===e)return null
var r=(e=t?e.toExponential(t-1):e.toExponential()).indexOf("e"),n=e.slice(0,r)
return[n.length>1?n[0]+n.slice(2):n,+e.slice(r+1)]}function ep(e){return(e=Qf(Math.abs(e)))?e[1]:NaN}var tp,rp=/^(?:(.)?([<>=^]))?([+\-( ])?([$#])?(0)?(\d+)?(,)?(\.\d+)?(~)?([a-z%])?$/i
function np(e){if(!(t=rp.exec(e)))throw new Error("invalid format: "+e)
var t
return new op({fill:t[1],align:t[2],sign:t[3],symbol:t[4],zero:t[5],width:t[6],comma:t[7],precision:t[8]&&t[8].slice(1),trim:t[9],type:t[10]})}function op(e){this.fill=void 0===e.fill?" ":e.fill+"",this.align=void 0===e.align?">":e.align+"",this.sign=void 0===e.sign?"-":e.sign+"",this.symbol=void 0===e.symbol?"":e.symbol+"",this.zero=!!e.zero,this.width=void 0===e.width?void 0:+e.width,this.comma=!!e.comma,this.precision=void 0===e.precision?void 0:+e.precision,this.trim=!!e.trim,this.type=void 0===e.type?"":e.type+""}function ip(e,t){var r=Qf(e,t)
if(!r)return e+""
var n=r[0],o=r[1]
return o<0?"0."+new Array(-o).join("0")+n:n.length>o+1?n.slice(0,o+1)+"."+n.slice(o+1):n+new Array(o-n.length+2).join("0")}np.prototype=op.prototype,op.prototype.toString=function(){return this.fill+this.align+this.sign+this.symbol+(this.zero?"0":"")+(void 0===this.width?"":Math.max(1,0|this.width))+(this.comma?",":"")+(void 0===this.precision?"":"."+Math.max(0,0|this.precision))+(this.trim?"~":"")+this.type}
const ap={"%":(e,t)=>(100*e).toFixed(t),b:e=>Math.round(e).toString(2),c:e=>e+"",d:e=>Math.abs(e=Math.round(e))>=1e21?e.toLocaleString("en").replace(/,/g,""):e.toString(10),e:(e,t)=>e.toExponential(t),f:(e,t)=>e.toFixed(t),g:(e,t)=>e.toPrecision(t),o:e=>Math.round(e).toString(8),p:(e,t)=>ip(100*e,t),r:ip,s:(e,t)=>{var r=Qf(e,t)
if(!r)return tp=void 0,e.toPrecision(t)
var n=r[0],o=r[1],i=o-(tp=3*Math.max(-8,Math.min(8,Math.floor(o/3))))+1,a=n.length
return i===a?n:i>a?n+new Array(i-a+1).join("0"):i>0?n.slice(0,i)+"."+n.slice(i):"0."+new Array(1-i).join("0")+Qf(e,Math.max(0,t+i-1))[0]},X:e=>Math.round(e).toString(16).toUpperCase(),x:e=>Math.round(e).toString(16)}
function lp(e){return e}var cp,sp,up,fp=Array.prototype.map,pp=["y","z","a","f","p","n","µ","m","","k","M","G","T","P","E","Z","Y"]
function hp(e,t,r,n){var o,i=Ru(e,t,r)
switch((n=np(n??",f")).type){case"s":var a=Math.max(Math.abs(e),Math.abs(t))
return null!=n.precision||isNaN(o=((e,t)=>Math.max(0,3*Math.max(-8,Math.min(8,Math.floor(ep(t)/3)))-ep(Math.abs(e))))(i,a))||(n.precision=o),up(n,a)
case"":case"e":case"g":case"p":case"r":null!=n.precision||isNaN(o=((e,t)=>(e=Math.abs(e),t=Math.abs(t)-e,Math.max(0,ep(t)-ep(e))+1))(i,Math.max(Math.abs(e),Math.abs(t))))||(n.precision=o-("e"===n.type))
break
case"f":case"%":null!=n.precision||isNaN(o=(e=>Math.max(0,-ep(Math.abs(e))))(i))||(n.precision=o-2*("%"===n.type))}return sp(n)}function dp(e){var t=e.domain
return e.ticks=e=>{var r=t()
return Nu(r[0],r[r.length-1],e??10)},e.tickFormat=(e,r)=>{var n=t()
return hp(n[0],n[n.length-1],e??10,r)},e.nice=r=>{null==r&&(r=10)
var n,o,i=t(),a=0,l=i.length-1,c=i[a],s=i[l],u=10
for(s<c&&(o=c,c=s,s=o,o=a,a=l,l=o);u-- >0;){if((o=Bu(c,s,r))===n)return i[a]=c,i[l]=s,t(i)
if(o>0)c=Math.floor(c/o)*o,s=Math.ceil(s/o)*o
else{if(!(o<0))break
c=Math.ceil(c*o)/o,s=Math.floor(s*o)/o}n=o}return e},e}function yp(){var e=Jf()
return e.copy=()=>Kf(e,yp()),qu.apply(e,arguments),dp(e)}function vp(e,t){var r,n=0,o=(e=e.slice()).length-1,i=e[n],a=e[o]
return a<i&&(r=n,n=o,o=r,r=i,i=a,a=r),e[n]=t.floor(i),e[o]=t.ceil(a),e}function mp(e){return Math.log(e)}function bp(e){return Math.exp(e)}function gp(e){return-Math.log(-e)}function wp(e){return-Math.exp(-e)}function xp(e){return isFinite(e)?+("1e"+e):e<0?0:e}function Op(e){return(t,r)=>-e(-t,r)}function jp(e){const t=e(mp,bp),r=t.domain
let n,o,i=10
function a(){return n=(e=>e===Math.E?Math.log:10===e&&Math.log10||2===e&&Math.log2||(e=Math.log(e),t=>Math.log(t)/e))(i),o=(e=>10===e?xp:e===Math.E?Math.exp:t=>Math.pow(e,t))(i),r()[0]<0?(n=Op(n),o=Op(o),e(gp,wp)):e(mp,bp),t}return t.base=function(e){return arguments.length?(i=+e,a()):i},t.domain=function(e){return arguments.length?(r(e),a()):r()},t.ticks=e=>{const t=r()
let a=t[0],l=t[t.length-1]
const c=l<a
c&&([a,l]=[l,a])
let s,u,f=n(a),p=n(l)
const h=null==e?10:+e
let d=[]
if(!(i%1)&&p-f<h){if(f=Math.floor(f),p=Math.ceil(p),a>0){for(;f<=p;++f)for(s=1;s<i;++s)if(u=f<0?s/o(-f):s*o(f),!(u<a)){if(u>l)break
d.push(u)}}else for(;f<=p;++f)for(s=i-1;s>=1;--s)if(u=f>0?s/o(-f):s*o(f),!(u<a)){if(u>l)break
d.push(u)}2*d.length<h&&(d=Nu(a,l,h))}else d=Nu(f,p,Math.min(p-f,h)).map(o)
return c?d.reverse():d},t.tickFormat=(e,r)=>{if(null==e&&(e=10),null==r&&(r=10===i?"s":","),"function"!=typeof r&&(i%1||null!=(r=np(r)).precision||(r.trim=!0),r=sp(r)),e===1/0)return r
const a=Math.max(1,i*e/t.ticks().length)
return e=>{let t=e/o(Math.round(n(e)))
return t*i<i-.5&&(t*=i),t<=a?r(e):""}},t.nice=()=>r(vp(r(),{floor:e=>o(Math.floor(n(e))),ceil:e=>o(Math.ceil(n(e)))})),t}function Sp(e){return t=>Math.sign(t)*Math.log1p(Math.abs(t/e))}function Pp(e){return t=>Math.sign(t)*Math.expm1(Math.abs(t))*e}function Ap(e){var t=1,r=e(Sp(t),Pp(t))
return r.constant=function(r){return arguments.length?e(Sp(t=+r),Pp(t)):t},dp(r)}function Ep(e){return t=>t<0?-Math.pow(-t,e):Math.pow(t,e)}function Mp(e){return e<0?-Math.sqrt(-e):Math.sqrt(e)}function _p(e){return e<0?-e*e:e*e}function Tp(e){var t=e(Hf,Hf),r=1
return t.exponent=function(t){return arguments.length?1===(r=+t)?e(Hf,Hf):.5===r?e(Mp,_p):e(Ep(r),Ep(1/r)):r},dp(t)}function kp(){var e=Tp(Zf())
return e.copy=()=>Kf(e,kp()).exponent(e.exponent()),qu.apply(e,arguments),e}function Cp(e){return Math.sign(e)*e*e}cp=(e=>{var t,r,n=void 0===e.grouping||void 0===e.thousands?lp:(t=fp.call(e.grouping,Number),r=e.thousands+"",(e,n)=>{for(var o=e.length,i=[],a=0,l=t[0],c=0;o>0&&l>0&&(c+l+1>n&&(l=Math.max(1,n-c)),i.push(e.substring(o-=l,o+l)),!((c+=l+1)>n));)l=t[a=(a+1)%t.length]
return i.reverse().join(r)}),o=void 0===e.currency?"":e.currency[0]+"",i=void 0===e.currency?"":e.currency[1]+"",a=void 0===e.decimal?".":e.decimal+"",l=void 0===e.numerals?lp:(e=>t=>t.replace(/[0-9]/g,t=>e[+t]))(fp.call(e.numerals,String)),c=void 0===e.percent?"%":e.percent+"",s=void 0===e.minus?"−":e.minus+"",u=void 0===e.nan?"NaN":e.nan+""
function f(e,t){var r=(e=np(e)).fill,f=e.align,p=e.sign,h=e.symbol,d=e.zero,y=e.width,v=e.comma,m=e.precision,b=e.trim,g=e.type
"n"===g?(v=!0,g="g"):ap[g]||(void 0===m&&(m=12),b=!0,g="g"),(d||"0"===r&&"="===f)&&(d=!0,r="0",f="=")
var w=(t&&void 0!==t.prefix?t.prefix:"")+("$"===h?o:"#"===h&&/[boxX]/.test(g)?"0"+g.toLowerCase():""),x=("$"===h?i:/[%p]/.test(g)?c:"")+(t&&void 0!==t.suffix?t.suffix:""),O=ap[g],j=/[defgprs%]/.test(g)
function S(e){var t,o,i,c=w,h=x
if("c"===g)h=O(e)+h,e=""
else{var S=(e=+e)<0||1/e<0
if(e=isNaN(e)?u:O(Math.abs(e),m),b&&(e=(e=>{e:for(var t,r=e.length,n=1,o=-1;n<r;++n)switch(e[n]){case".":o=t=n
break
case"0":0===o&&(o=n),t=n
break
default:if(!+e[n])break e
o>0&&(o=0)}return o>0?e.slice(0,o)+e.slice(t+1):e})(e)),S&&0===+e&&"+"!==p&&(S=!1),c=(S?"("===p?p:s:"-"===p||"("===p?"":p)+c,h=("s"!==g||isNaN(e)||void 0===tp?"":pp[8+tp/3])+h+(S&&"("===p?")":""),j)for(t=-1,o=e.length;++t<o;)if(48>(i=e.charCodeAt(t))||i>57){h=(46===i?a+e.slice(t+1):e.slice(t))+h,e=e.slice(0,t)
break}}v&&!d&&(e=n(e,1/0))
var P=c.length+e.length+h.length,A=P<y?new Array(y-P+1).join(r):""
switch(v&&d&&(e=n(A+e,A.length?y-h.length:1/0),A=""),f){case"<":e=c+e+h+A
break
case"=":e=c+A+e+h
break
case"^":e=A.slice(0,P=A.length>>1)+c+e+h+A.slice(P)
break
default:e=A+c+e+h}return l(e)}return m=void 0===m?6:/[gprs]/.test(g)?Math.max(1,Math.min(21,m)):Math.max(0,Math.min(20,m)),S.toString=()=>e+"",S}return{format:f,formatPrefix:(e,t)=>{var r=3*Math.max(-8,Math.min(8,Math.floor(ep(t)/3))),n=Math.pow(10,-r),o=f(((e=np(e)).type="f",e),{suffix:pp[8+r/3]})
return e=>o(n*e)}}})({thousands:",",grouping:[3],currency:["$",""]}),sp=cp.format,up=cp.formatPrefix
const Ip=new Date,Dp=new Date
function Np(e,t,r,n){function o(t){return e(t=0===arguments.length?new Date:new Date(+t)),t}return o.floor=t=>(e(t=new Date(+t)),t),o.ceil=r=>(e(r=new Date(r-1)),t(r,1),e(r),r),o.round=e=>{const t=o(e),r=o.ceil(e)
return e-t<r-e?t:r},o.offset=(e,r)=>(t(e=new Date(+e),null==r?1:Math.floor(r)),e),o.range=(r,n,i)=>{const a=[]
if(r=o.ceil(r),i=null==i?1:Math.floor(i),!(r<n&&i>0))return a
let l
do{a.push(l=new Date(+r)),t(r,i),e(r)}while(l<r&&r<n)
return a},o.filter=r=>Np(t=>{if(t>=t)for(;e(t),!r(t);)t.setTime(t-1)},(e,n)=>{if(e>=e)if(n<0)for(;++n<=0;)for(;t(e,-1),!r(e););else for(;--n>=0;)for(;t(e,1),!r(e););}),r&&(o.count=(t,n)=>(Ip.setTime(+t),Dp.setTime(+n),e(Ip),e(Dp),Math.floor(r(Ip,Dp))),o.every=e=>(e=Math.floor(e),isFinite(e)&&e>0?e>1?o.filter(n?t=>n(t)%e===0:t=>o.count(0,t)%e===0):o:null)),o}const Bp=Np(()=>{},(e,t)=>{e.setTime(+e+t)},(e,t)=>t-e)
Bp.every=e=>(e=Math.floor(e),isFinite(e)&&e>0?e>1?Np(t=>{t.setTime(Math.floor(t/e)*e)},(t,r)=>{t.setTime(+t+r*e)},(t,r)=>(r-t)/e):Bp:null),Bp.range
const Rp=1e3,Lp=6e4,Up=36e5,zp=864e5,$p=6048e5,Fp=31536e6,qp=Np(e=>{e.setTime(e-e.getMilliseconds())},(e,t)=>{e.setTime(+e+t*Rp)},(e,t)=>(t-e)/Rp,e=>e.getUTCSeconds())
qp.range
const Wp=Np(e=>{e.setTime(e-e.getMilliseconds()-e.getSeconds()*Rp)},(e,t)=>{e.setTime(+e+t*Lp)},(e,t)=>(t-e)/Lp,e=>e.getMinutes())
Wp.range
const Xp=Np(e=>{e.setUTCSeconds(0,0)},(e,t)=>{e.setTime(+e+t*Lp)},(e,t)=>(t-e)/Lp,e=>e.getUTCMinutes())
Xp.range
const Hp=Np(e=>{e.setTime(e-e.getMilliseconds()-e.getSeconds()*Rp-e.getMinutes()*Lp)},(e,t)=>{e.setTime(+e+t*Up)},(e,t)=>(t-e)/Up,e=>e.getHours())
Hp.range
const Vp=Np(e=>{e.setUTCMinutes(0,0,0)},(e,t)=>{e.setTime(+e+t*Up)},(e,t)=>(t-e)/Up,e=>e.getUTCHours())
Vp.range
const Yp=Np(e=>e.setHours(0,0,0,0),(e,t)=>e.setDate(e.getDate()+t),(e,t)=>(t-e-(t.getTimezoneOffset()-e.getTimezoneOffset())*Lp)/zp,e=>e.getDate()-1)
Yp.range
const Gp=Np(e=>{e.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCDate(e.getUTCDate()+t)},(e,t)=>(t-e)/zp,e=>e.getUTCDate()-1)
Gp.range
const Kp=Np(e=>{e.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCDate(e.getUTCDate()+t)},(e,t)=>(t-e)/zp,e=>Math.floor(e/zp))
function Zp(e){return Np(t=>{t.setDate(t.getDate()-(t.getDay()+7-e)%7),t.setHours(0,0,0,0)},(e,t)=>{e.setDate(e.getDate()+7*t)},(e,t)=>(t-e-(t.getTimezoneOffset()-e.getTimezoneOffset())*Lp)/$p)}Kp.range
const Jp=Zp(0),Qp=Zp(1),eh=Zp(2),th=Zp(3),rh=Zp(4),nh=Zp(5),oh=Zp(6)
function ih(e){return Np(t=>{t.setUTCDate(t.getUTCDate()-(t.getUTCDay()+7-e)%7),t.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCDate(e.getUTCDate()+7*t)},(e,t)=>(t-e)/$p)}Jp.range,Qp.range,eh.range,th.range,rh.range,nh.range,oh.range
const ah=ih(0),lh=ih(1),ch=ih(2),sh=ih(3),uh=ih(4),fh=ih(5),ph=ih(6)
ah.range,lh.range,ch.range,sh.range,uh.range,fh.range,ph.range
const hh=Np(e=>{e.setDate(1),e.setHours(0,0,0,0)},(e,t)=>{e.setMonth(e.getMonth()+t)},(e,t)=>t.getMonth()-e.getMonth()+12*(t.getFullYear()-e.getFullYear()),e=>e.getMonth())
hh.range
const dh=Np(e=>{e.setUTCDate(1),e.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCMonth(e.getUTCMonth()+t)},(e,t)=>t.getUTCMonth()-e.getUTCMonth()+12*(t.getUTCFullYear()-e.getUTCFullYear()),e=>e.getUTCMonth())
dh.range
const yh=Np(e=>{e.setMonth(0,1),e.setHours(0,0,0,0)},(e,t)=>{e.setFullYear(e.getFullYear()+t)},(e,t)=>t.getFullYear()-e.getFullYear(),e=>e.getFullYear())
yh.every=e=>isFinite(e=Math.floor(e))&&e>0?Np(t=>{t.setFullYear(Math.floor(t.getFullYear()/e)*e),t.setMonth(0,1),t.setHours(0,0,0,0)},(t,r)=>{t.setFullYear(t.getFullYear()+r*e)}):null,yh.range
const vh=Np(e=>{e.setUTCMonth(0,1),e.setUTCHours(0,0,0,0)},(e,t)=>{e.setUTCFullYear(e.getUTCFullYear()+t)},(e,t)=>t.getUTCFullYear()-e.getUTCFullYear(),e=>e.getUTCFullYear())
function mh(e,t,r,n,o,i){const a=[[qp,1,Rp],[qp,5,5e3],[qp,15,15e3],[qp,30,3e4],[i,1,Lp],[i,5,3e5],[i,15,9e5],[i,30,18e5],[o,1,Up],[o,3,108e5],[o,6,216e5],[o,12,432e5],[n,1,zp],[n,2,1728e5],[r,1,$p],[t,1,2592e6],[t,3,7776e6],[e,1,Fp]]
function l(t,r,n){const o=Math.abs(r-t)/n,i=ju(([,,e])=>e).right(a,o)
if(i===a.length)return e.every(Ru(t/Fp,r/Fp,n))
if(0===i)return Bp.every(Math.max(Ru(t,r,n),1))
const[l,c]=a[o/a[i-1][2]<a[i][2]/o?i-1:i]
return l.every(c)}return[(e,t,r)=>{const n=t<e
n&&([e,t]=[t,e])
const o=r&&"function"==typeof r.range?r:l(e,t,r),i=o?o.range(e,+t+1):[]
return n?i.reverse():i},l]}vh.every=e=>isFinite(e=Math.floor(e))&&e>0?Np(t=>{t.setUTCFullYear(Math.floor(t.getUTCFullYear()/e)*e),t.setUTCMonth(0,1),t.setUTCHours(0,0,0,0)},(t,r)=>{t.setUTCFullYear(t.getUTCFullYear()+r*e)}):null,vh.range
const[bh,gh]=mh(vh,dh,ah,Kp,Vp,Xp),[wh,xh]=mh(yh,hh,Jp,Yp,Hp,Wp)
function Oh(e){if(0<=e.y&&e.y<100){var t=new Date(-1,e.m,e.d,e.H,e.M,e.S,e.L)
return t.setFullYear(e.y),t}return new Date(e.y,e.m,e.d,e.H,e.M,e.S,e.L)}function jh(e){if(0<=e.y&&e.y<100){var t=new Date(Date.UTC(-1,e.m,e.d,e.H,e.M,e.S,e.L))
return t.setUTCFullYear(e.y),t}return new Date(Date.UTC(e.y,e.m,e.d,e.H,e.M,e.S,e.L))}function Sh(e,t,r){return{y:e,m:t,d:r,H:0,M:0,S:0,L:0}}var Ph,Ah,Eh,Mh={"-":"",_:" ",0:"0"},_h=/^\s*\d+/,Th=/^%/,kh=/[\\^$*+?|[\]().{}]/g
function Ch(e,t,r){var n=e<0?"-":"",o=(n?-e:e)+"",i=o.length
return n+(i<r?new Array(r-i+1).join(t)+o:o)}function Ih(e){return e.replace(kh,"\\$&")}function Dh(e){return new RegExp("^(?:"+e.map(Ih).join("|")+")","i")}function Nh(e){return new Map(e.map((e,t)=>[e.toLowerCase(),t]))}function Bh(e,t,r){var n=_h.exec(t.slice(r,r+1))
return n?(e.w=+n[0],r+n[0].length):-1}function Rh(e,t,r){var n=_h.exec(t.slice(r,r+1))
return n?(e.u=+n[0],r+n[0].length):-1}function Lh(e,t,r){var n=_h.exec(t.slice(r,r+2))
return n?(e.U=+n[0],r+n[0].length):-1}function Uh(e,t,r){var n=_h.exec(t.slice(r,r+2))
return n?(e.V=+n[0],r+n[0].length):-1}function zh(e,t,r){var n=_h.exec(t.slice(r,r+2))
return n?(e.W=+n[0],r+n[0].length):-1}function $h(e,t,r){var n=_h.exec(t.slice(r,r+4))
return n?(e.y=+n[0],r+n[0].length):-1}function Fh(e,t,r){var n=_h.exec(t.slice(r,r+2))
return n?(e.y=+n[0]+(+n[0]>68?1900:2e3),r+n[0].length):-1}function qh(e,t,r){var n=/^(Z)|([+-]\d\d)(?::?(\d\d))?/.exec(t.slice(r,r+6))
return n?(e.Z=n[1]?0:-(n[2]+(n[3]||"00")),r+n[0].length):-1}function Wh(e,t,r){var n=_h.exec(t.slice(r,r+1))
return n?(e.q=3*n[0]-3,r+n[0].length):-1}function Xh(e,t,r){var n=_h.exec(t.slice(r,r+2))
return n?(e.m=n[0]-1,r+n[0].length):-1}function Hh(e,t,r){var n=_h.exec(t.slice(r,r+2))
return n?(e.d=+n[0],r+n[0].length):-1}function Vh(e,t,r){var n=_h.exec(t.slice(r,r+3))
return n?(e.m=0,e.d=+n[0],r+n[0].length):-1}function Yh(e,t,r){var n=_h.exec(t.slice(r,r+2))
return n?(e.H=+n[0],r+n[0].length):-1}function Gh(e,t,r){var n=_h.exec(t.slice(r,r+2))
return n?(e.M=+n[0],r+n[0].length):-1}function Kh(e,t,r){var n=_h.exec(t.slice(r,r+2))
return n?(e.S=+n[0],r+n[0].length):-1}function Zh(e,t,r){var n=_h.exec(t.slice(r,r+3))
return n?(e.L=+n[0],r+n[0].length):-1}function Jh(e,t,r){var n=_h.exec(t.slice(r,r+6))
return n?(e.L=Math.floor(n[0]/1e3),r+n[0].length):-1}function Qh(e,t,r){var n=Th.exec(t.slice(r,r+1))
return n?r+n[0].length:-1}function ed(e,t,r){var n=_h.exec(t.slice(r))
return n?(e.Q=+n[0],r+n[0].length):-1}function td(e,t,r){var n=_h.exec(t.slice(r))
return n?(e.s=+n[0],r+n[0].length):-1}function rd(e,t){return Ch(e.getDate(),t,2)}function nd(e,t){return Ch(e.getHours(),t,2)}function od(e,t){return Ch(e.getHours()%12||12,t,2)}function id(e,t){return Ch(1+Yp.count(yh(e),e),t,3)}function ad(e,t){return Ch(e.getMilliseconds(),t,3)}function ld(e,t){return ad(e,t)+"000"}function cd(e,t){return Ch(e.getMonth()+1,t,2)}function sd(e,t){return Ch(e.getMinutes(),t,2)}function ud(e,t){return Ch(e.getSeconds(),t,2)}function fd(e){var t=e.getDay()
return 0===t?7:t}function pd(e,t){return Ch(Jp.count(yh(e)-1,e),t,2)}function hd(e){var t=e.getDay()
return t>=4||0===t?rh(e):rh.ceil(e)}function dd(e,t){return e=hd(e),Ch(rh.count(yh(e),e)+(4===yh(e).getDay()),t,2)}function yd(e){return e.getDay()}function vd(e,t){return Ch(Qp.count(yh(e)-1,e),t,2)}function md(e,t){return Ch(e.getFullYear()%100,t,2)}function bd(e,t){return Ch((e=hd(e)).getFullYear()%100,t,2)}function gd(e,t){return Ch(e.getFullYear()%1e4,t,4)}function wd(e,t){var r=e.getDay()
return Ch((e=r>=4||0===r?rh(e):rh.ceil(e)).getFullYear()%1e4,t,4)}function xd(e){var t=e.getTimezoneOffset()
return(t>0?"-":(t*=-1,"+"))+Ch(t/60|0,"0",2)+Ch(t%60,"0",2)}function Od(e,t){return Ch(e.getUTCDate(),t,2)}function jd(e,t){return Ch(e.getUTCHours(),t,2)}function Sd(e,t){return Ch(e.getUTCHours()%12||12,t,2)}function Pd(e,t){return Ch(1+Gp.count(vh(e),e),t,3)}function Ad(e,t){return Ch(e.getUTCMilliseconds(),t,3)}function Ed(e,t){return Ad(e,t)+"000"}function Md(e,t){return Ch(e.getUTCMonth()+1,t,2)}function _d(e,t){return Ch(e.getUTCMinutes(),t,2)}function Td(e,t){return Ch(e.getUTCSeconds(),t,2)}function kd(e){var t=e.getUTCDay()
return 0===t?7:t}function Cd(e,t){return Ch(ah.count(vh(e)-1,e),t,2)}function Id(e){var t=e.getUTCDay()
return t>=4||0===t?uh(e):uh.ceil(e)}function Dd(e,t){return e=Id(e),Ch(uh.count(vh(e),e)+(4===vh(e).getUTCDay()),t,2)}function Nd(e){return e.getUTCDay()}function Bd(e,t){return Ch(lh.count(vh(e)-1,e),t,2)}function Rd(e,t){return Ch(e.getUTCFullYear()%100,t,2)}function Ld(e,t){return Ch((e=Id(e)).getUTCFullYear()%100,t,2)}function Ud(e,t){return Ch(e.getUTCFullYear()%1e4,t,4)}function zd(e,t){var r=e.getUTCDay()
return Ch((e=r>=4||0===r?uh(e):uh.ceil(e)).getUTCFullYear()%1e4,t,4)}function $d(){return"+0000"}function Fd(){return"%"}function qd(e){return+e}function Wd(e){return Math.floor(+e/1e3)}function Xd(e){return new Date(e)}function Hd(e){return e instanceof Date?+e:+new Date(+e)}function Vd(e,t,r,n,o,i,a,l,c,s){var u=Jf(),f=u.invert,p=u.domain,h=s(".%L"),d=s(":%S"),y=s("%I:%M"),v=s("%I %p"),m=s("%a %d"),b=s("%b %d"),g=s("%B"),w=s("%Y")
function x(e){return(c(e)<e?h:l(e)<e?d:a(e)<e?y:i(e)<e?v:n(e)<e?o(e)<e?m:b:r(e)<e?g:w)(e)}return u.invert=e=>new Date(f(e)),u.domain=function(e){return arguments.length?p(Array.from(e,Hd)):p().map(Xd)},u.ticks=t=>{var r=p()
return e(r[0],r[r.length-1],t??10)},u.tickFormat=(e,t)=>null==t?x:s(t),u.nice=e=>{var r=p()
return e&&"function"==typeof e.range||(e=t(r[0],r[r.length-1],e??10)),e?p(vp(r,e)):u},u.copy=()=>Kf(u,Vd(e,t,r,n,o,i,a,l,c,s)),u}function Yd(){var e,t,r,n,o,i=0,a=1,l=Hf,c=!1
function s(t){return null==t||isNaN(t=+t)?o:l(0===r?.5:(t=(n(t)-e)*r,c?Math.max(0,Math.min(1,t)):t))}function u(e){return function(t){var r,n
return arguments.length?([r,n]=t,l=e(r,n),s):[l(0),l(1)]}}return s.domain=function(o){return arguments.length?([i,a]=o,e=n(i=+i),t=n(a=+a),r=e===t?0:1/(t-e),s):[i,a]},s.clamp=function(e){return arguments.length?(c=!!e,s):c},s.interpolator=function(e){return arguments.length?(l=e,s):l},s.range=u(Ff),s.rangeRound=u(qf),s.unknown=function(e){return arguments.length?(o=e,s):o},o=>(n=o,e=o(i),t=o(a),r=e===t?0:1/(t-e),s)}function Gd(e,t){return t.domain(e.domain()).interpolator(e.interpolator()).clamp(e.clamp()).unknown(e.unknown())}function Kd(){var e=Tp(Yd())
return e.copy=()=>Gd(e,Kd()).exponent(e.exponent()),Wu.apply(e,arguments)}function Zd(){var e,t,r,n,o,i,a,l=0,c=.5,s=1,u=1,f=Hf,p=!1
function h(e){return isNaN(e=+e)?a:(e=.5+((e=+i(e))-t)*(u*e<u*t?n:o),f(p?Math.max(0,Math.min(1,e)):e))}function d(e){return function(t){var r,n,o
return arguments.length?([r,n,o]=t,f=((e,t)=>{void 0===t&&(t=e,e=Ff)
for(var r=0,n=t.length-1,o=t[0],i=new Array(n<0?0:n);r<n;)i[r]=e(o,o=t[++r])
return e=>{var t=Math.max(0,Math.min(n-1,Math.floor(e*=n)))
return i[t](e-t)}})(e,[r,n,o]),h):[f(0),f(.5),f(1)]}}return h.domain=function(a){return arguments.length?([l,c,s]=a,e=i(l=+l),t=i(c=+c),r=i(s=+s),n=e===t?0:.5/(t-e),o=t===r?0:.5/(r-t),u=t<e?-1:1,h):[l,c,s]},h.clamp=function(e){return arguments.length?(p=!!e,h):p},h.interpolator=function(e){return arguments.length?(f=e,h):f},h.range=d(Ff),h.rangeRound=d(qf),h.unknown=function(e){return arguments.length?(a=e,h):a},a=>(i=a,e=a(l),t=a(c),r=a(s),n=e===t?0:.5/(t-e),o=t===r?0:.5/(r-t),u=t<e?-1:1,h)}function Jd(){var e=Tp(Zd())
return e.copy=()=>Gd(e,Jd()).exponent(e.exponent()),Wu.apply(e,arguments)}Ph=(e=>{var t=e.dateTime,r=e.date,n=e.time,o=e.periods,i=e.days,a=e.shortDays,l=e.months,c=e.shortMonths,s=Dh(o),u=Nh(o),f=Dh(i),p=Nh(i),h=Dh(a),d=Nh(a),y=Dh(l),v=Nh(l),m=Dh(c),b=Nh(c),g={a:e=>a[e.getDay()],A:e=>i[e.getDay()],b:e=>c[e.getMonth()],B:e=>l[e.getMonth()],c:null,d:rd,e:rd,f:ld,g:bd,G:wd,H:nd,I:od,j:id,L:ad,m:cd,M:sd,p:e=>o[+(e.getHours()>=12)],q:e=>1+~~(e.getMonth()/3),Q:qd,s:Wd,S:ud,u:fd,U:pd,V:dd,w:yd,W:vd,x:null,X:null,y:md,Y:gd,Z:xd,"%":Fd},w={a:e=>a[e.getUTCDay()],A:e=>i[e.getUTCDay()],b:e=>c[e.getUTCMonth()],B:e=>l[e.getUTCMonth()],c:null,d:Od,e:Od,f:Ed,g:Ld,G:zd,H:jd,I:Sd,j:Pd,L:Ad,m:Md,M:_d,p:e=>o[+(e.getUTCHours()>=12)],q:e=>1+~~(e.getUTCMonth()/3),Q:qd,s:Wd,S:Td,u:kd,U:Cd,V:Dd,w:Nd,W:Bd,x:null,X:null,y:Rd,Y:Ud,Z:$d,"%":Fd},x={a:(e,t,r)=>{var n=h.exec(t.slice(r))
return n?(e.w=d.get(n[0].toLowerCase()),r+n[0].length):-1},A:(e,t,r)=>{var n=f.exec(t.slice(r))
return n?(e.w=p.get(n[0].toLowerCase()),r+n[0].length):-1},b:(e,t,r)=>{var n=m.exec(t.slice(r))
return n?(e.m=b.get(n[0].toLowerCase()),r+n[0].length):-1},B:(e,t,r)=>{var n=y.exec(t.slice(r))
return n?(e.m=v.get(n[0].toLowerCase()),r+n[0].length):-1},c:(e,r,n)=>S(e,t,r,n),d:Hh,e:Hh,f:Jh,g:Fh,G:$h,H:Yh,I:Yh,j:Vh,L:Zh,m:Xh,M:Gh,p:(e,t,r)=>{var n=s.exec(t.slice(r))
return n?(e.p=u.get(n[0].toLowerCase()),r+n[0].length):-1},q:Wh,Q:ed,s:td,S:Kh,u:Rh,U:Lh,V:Uh,w:Bh,W:zh,x:(e,t,n)=>S(e,r,t,n),X:(e,t,r)=>S(e,n,t,r),y:Fh,Y:$h,Z:qh,"%":Qh}
function O(e,t){return r=>{var n,o,i,a=[],l=-1,c=0,s=e.length
for(r instanceof Date||(r=new Date(+r));++l<s;)37===e.charCodeAt(l)&&(a.push(e.slice(c,l)),null!=(o=Mh[n=e.charAt(++l)])?n=e.charAt(++l):o="e"===n?" ":"0",(i=t[n])&&(n=i(r,o)),a.push(n),c=l+1)
return a.push(e.slice(c,l)),a.join("")}}function j(e,t){return r=>{var n,o,i=Sh(1900,void 0,1)
if(S(i,e,r+="",0)!=r.length)return null
if("Q"in i)return new Date(i.Q)
if("s"in i)return new Date(1e3*i.s+("L"in i?i.L:0))
if(t&&!("Z"in i)&&(i.Z=0),"p"in i&&(i.H=i.H%12+12*i.p),void 0===i.m&&(i.m="q"in i?i.q:0),"V"in i){if(i.V<1||i.V>53)return null
"w"in i||(i.w=1),"Z"in i?(o=(n=jh(Sh(i.y,0,1))).getUTCDay(),n=o>4||0===o?lh.ceil(n):lh(n),n=Gp.offset(n,7*(i.V-1)),i.y=n.getUTCFullYear(),i.m=n.getUTCMonth(),i.d=n.getUTCDate()+(i.w+6)%7):(o=(n=Oh(Sh(i.y,0,1))).getDay(),n=o>4||0===o?Qp.ceil(n):Qp(n),n=Yp.offset(n,7*(i.V-1)),i.y=n.getFullYear(),i.m=n.getMonth(),i.d=n.getDate()+(i.w+6)%7)}else("W"in i||"U"in i)&&("w"in i||(i.w="u"in i?i.u%7:"W"in i?1:0),o="Z"in i?jh(Sh(i.y,0,1)).getUTCDay():Oh(Sh(i.y,0,1)).getDay(),i.m=0,i.d="W"in i?(i.w+6)%7+7*i.W-(o+5)%7:i.w+7*i.U-(o+6)%7)
return"Z"in i?(i.H+=i.Z/100|0,i.M+=i.Z%100,jh(i)):Oh(i)}}function S(e,t,r,n){for(var o,i,a=0,l=t.length,c=r.length;a<l;){if(n>=c)return-1
if(37===(o=t.charCodeAt(a++))){if(o=t.charAt(a++),!(i=x[o in Mh?t.charAt(a++):o])||(n=i(e,r,n))<0)return-1}else if(o!=r.charCodeAt(n++))return-1}return n}return g.x=O(r,g),g.X=O(n,g),g.c=O(t,g),w.x=O(r,w),w.X=O(n,w),w.c=O(t,w),{format:e=>{var t=O(e+="",g)
return t.toString=()=>e,t},parse:e=>{var t=j(e+="",!1)
return t.toString=()=>e,t},utcFormat:e=>{var t=O(e+="",w)
return t.toString=()=>e,t},utcParse:e=>{var t=j(e+="",!0)
return t.toString=()=>e,t}}})({dateTime:"%x, %X",date:"%-m/%-d/%Y",time:"%-I:%M:%S %p",periods:["AM","PM"],days:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],shortDays:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],months:["January","February","March","April","May","June","July","August","September","October","November","December"],shortMonths:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]}),Ah=Ph.format,Ph.parse,Eh=Ph.utcFormat,Ph.utcParse
const Qd=Object.freeze(Object.defineProperty({__proto__:null,scaleBand:Vu,scaleDiverging:function e(){var t=dp(Zd()(Hf))
return t.copy=()=>Gd(t,e()),Wu.apply(t,arguments)},scaleDivergingLog:function e(){var t=jp(Zd()).domain([.1,1,10])
return t.copy=()=>Gd(t,e()).base(t.base()),Wu.apply(t,arguments)},scaleDivergingPow:Jd,scaleDivergingSqrt:function(){return Jd.apply(null,arguments).exponent(.5)},scaleDivergingSymlog:function e(){var t=Ap(Zd())
return t.copy=()=>Gd(t,e()).constant(t.constant()),Wu.apply(t,arguments)},scaleIdentity:function e(t){var r
function n(e){return null==e||isNaN(e=+e)?r:e}return n.invert=n,n.domain=n.range=function(e){return arguments.length?(t=Array.from(e,Wf),n):t.slice()},n.unknown=function(e){return arguments.length?(r=e,n):r},n.copy=()=>e(t).unknown(r),t=arguments.length?Array.from(t,Wf):[0,1],dp(n)},scaleImplicit:Xu,scaleLinear:yp,scaleLog:function e(){const t=jp(Zf()).domain([1,10])
return t.copy=()=>Kf(t,e()).base(t.base()),qu.apply(t,arguments),t},scaleOrdinal:Hu,scalePoint:Gu,scalePow:kp,scaleQuantile:function e(){var t,r=[],n=[],o=[]
function i(){var e=0,t=Math.max(1,n.length)
for(o=new Array(t-1);++e<t;)o[e-1]=Fu(r,e/t)
return a}function a(e){return null==e||isNaN(e=+e)?t:n[Au(o,e)]}return a.invertExtent=e=>{var t=n.indexOf(e)
return t<0?[NaN,NaN]:[t>0?o[t-1]:r[0],t<o.length?o[t]:r[r.length-1]]},a.domain=function(e){if(!arguments.length)return r.slice()
r=[]
for(let t of e)null==t||isNaN(t=+t)||r.push(t)
return r.sort(xu),i()},a.range=function(e){return arguments.length?(n=Array.from(e),i()):n.slice()},a.unknown=function(e){return arguments.length?(t=e,a):t},a.quantiles=()=>o.slice(),a.copy=()=>e().domain(r).range(n).unknown(t),qu.apply(a,arguments)},scaleQuantize:function e(){var t,r=0,n=1,o=1,i=[.5],a=[0,1]
function l(e){return null!=e&&e<=e?a[Au(i,e,0,o)]:t}function c(){var e=-1
for(i=new Array(o);++e<o;)i[e]=((e+1)*n-(e-o)*r)/(o+1)
return l}return l.domain=function(e){return arguments.length?([r,n]=e,r=+r,n=+n,c()):[r,n]},l.range=function(e){return arguments.length?(o=(a=Array.from(e)).length-1,c()):a.slice()},l.invertExtent=e=>{var t=a.indexOf(e)
return t<0?[NaN,NaN]:t<1?[r,i[0]]:t>=o?[i[o-1],n]:[i[t-1],i[t]]},l.unknown=function(e){return arguments.length?(t=e,l):l},l.thresholds=()=>i.slice(),l.copy=()=>e().domain([r,n]).range(a).unknown(t),qu.apply(dp(l),arguments)},scaleRadial:function e(){var t,r=Jf(),n=[0,1],o=!1
function i(e){var n=(e=>Math.sign(e)*Math.sqrt(Math.abs(e)))(r(e))
return isNaN(n)?t:o?Math.round(n):n}return i.invert=e=>r.invert(Cp(e)),i.domain=function(e){return arguments.length?(r.domain(e),i):r.domain()},i.range=function(e){return arguments.length?(r.range((n=Array.from(e,Wf)).map(Cp)),i):n.slice()},i.rangeRound=e=>i.range(e).round(!0),i.round=function(e){return arguments.length?(o=!!e,i):o},i.clamp=function(e){return arguments.length?(r.clamp(e),i):r.clamp()},i.unknown=function(e){return arguments.length?(t=e,i):t},i.copy=()=>e(r.domain(),n).round(o).clamp(r.clamp()).unknown(t),qu.apply(i,arguments),dp(i)},scaleSequential:function e(){var t=dp(Yd()(Hf))
return t.copy=()=>Gd(t,e()),Wu.apply(t,arguments)},scaleSequentialLog:function e(){var t=jp(Yd()).domain([1,10])
return t.copy=()=>Gd(t,e()).base(t.base()),Wu.apply(t,arguments)},scaleSequentialPow:Kd,scaleSequentialQuantile:function e(){var t=[],r=Hf
function n(e){if(null!=e&&!isNaN(e=+e))return r((Au(t,e,1)-1)/(t.length-1))}return n.domain=function(e){if(!arguments.length)return t.slice()
t=[]
for(let r of e)null==r||isNaN(r=+r)||t.push(r)
return t.sort(xu),n},n.interpolator=function(e){return arguments.length?(r=e,n):r},n.range=()=>t.map((e,n)=>r(n/(t.length-1))),n.quantiles=e=>Array.from({length:e+1},(r,n)=>((e,t)=>{if((r=(e=Float64Array.from(function*(e){for(let t of e)null!=t&&(t=+t)>=t&&(yield t)}(e))).length)&&!isNaN(t=+t)){if(t<=0||r<2)return Uu(e)
if(t>=1)return Lu(e)
var r,n=(r-1)*t,o=Math.floor(n),i=Lu(zu(e,o).subarray(0,o+1))
return i+(Uu(e.subarray(o+1))-i)*(n-o)}})(t,n/e)),n.copy=()=>e(r).domain(t),Wu.apply(n,arguments)},scaleSequentialSqrt:function(){return Kd.apply(null,arguments).exponent(.5)},scaleSequentialSymlog:function e(){var t=Ap(Yd())
return t.copy=()=>Gd(t,e()).constant(t.constant()),Wu.apply(t,arguments)},scaleSqrt:function(){return kp.apply(null,arguments).exponent(.5)},scaleSymlog:function e(){var t=Ap(Zf())
return t.copy=()=>Kf(t,e()).constant(t.constant()),qu.apply(t,arguments)},scaleThreshold:function e(){var t,r=[.5],n=[0,1],o=1
function i(e){return null!=e&&e<=e?n[Au(r,e,0,o)]:t}return i.domain=function(e){return arguments.length?(r=Array.from(e),o=Math.min(r.length,n.length-1),i):r.slice()},i.range=function(e){return arguments.length?(n=Array.from(e),o=Math.min(r.length,n.length-1),i):n.slice()},i.invertExtent=e=>{var t=n.indexOf(e)
return[r[t-1],r[t]]},i.unknown=function(e){return arguments.length?(t=e,i):t},i.copy=()=>e().domain(r).range(n).unknown(t),qu.apply(i,arguments)},scaleTime:function(){return qu.apply(Vd(wh,xh,yh,hh,Jp,Yp,Hp,Wp,qp,Ah).domain([new Date(2e3,0,1),new Date(2e3,0,2)]),arguments)},scaleUtc:function(){return qu.apply(Vd(bh,gh,vh,dh,ah,Gp,Vp,Xp,qp,Eh).domain([Date.UTC(2e3,0,1),Date.UTC(2e3,0,2)]),arguments)},tickFormat:hp},Symbol.toStringTag,{value:"Module"}))
var ey,ty,ry,ny,oy,iy
function ay(){if(ty)return ey
ty=1
var e=lt()
return ey=(t,r,n)=>{for(var o=-1,i=t.length;++o<i;){var a=t[o],l=r(a)
if(null!=l&&(void 0===c?l==l&&!e(l):n(l,c)))var c=l,s=a}return s}}function ly(){return ny?ry:(ny=1,ry=(e,t)=>e>t)}const cy=r((()=>{if(iy)return oy
iy=1
var e=ay(),t=ly(),r=Ml()
return oy=n=>n&&n.length?e(n,r,t):void 0})())
var sy,uy,fy,py
function hy(){return uy?sy:(uy=1,sy=(e,t)=>e<t)}const dy=r((()=>{if(py)return fy
py=1
var e=ay(),t=hy(),r=Ml()
return fy=n=>n&&n.length?e(n,r,t):void 0})())
var yy,vy,my,by
const gy=r((()=>{if(by)return my
by=1
var e=Nc(),t=(()=>{if(vy)return yy
vy=1
var e=xt(),t=_l(),r=Lc(),n=tt()
return yy=(o,i)=>(n(o)?e:r)(o,t(i,3))})()
return my=(r,n)=>e(t(r,n),1)})())
var wy,xy
const Oy=r((()=>{if(xy)return wy
xy=1
var e=Pl()
return wy=(t,r)=>e(t,r)})())
var jy,Sy=1e9,Py=!0,Ay="[DecimalError] ",Ey=Ay+"Invalid argument: ",My=Ay+"Exponent out of range: ",_y=Math.floor,Ty=Math.pow,ky=/^(\d+(\.\d*)?|\.\d+)(e[+-]?\d+)?$/i,Cy=1e7,Iy=_y(1286742750677284.5),Dy={}
function Ny(e,t){var r,n,o,i,a,l,c,s,u=e.constructor,f=u.precision
if(!e.s||!t.s)return t.s||(t=new u(e)),Py?Xy(t,f):t
if(c=e.d,s=t.d,a=e.e,o=t.e,c=c.slice(),i=a-o){for(i<0?(n=c,i=-i,l=s.length):(n=s,o=a,l=c.length),i>(l=(a=Math.ceil(f/7))>l?a+1:l+1)&&(i=l,n.length=1),n.reverse();i--;)n.push(0)
n.reverse()}for((l=c.length)-(i=s.length)<0&&(i=l,n=s,s=c,c=n),r=0;i;)r=(c[--i]=c[i]+s[i]+r)/Cy|0,c[i]%=Cy
for(r&&(c.unshift(r),++o),l=c.length;0==c[--l];)c.pop()
return t.d=c,t.e=o,Py?Xy(t,f):t}function By(e,t,r){if(e!==~~e||e<t||e>r)throw Error(Ey+e)}function Ry(e){var t,r,n,o=e.length-1,i="",a=e[0]
if(o>0){for(i+=a,t=1;t<o;t++)(r=7-(n=e[t]+"").length)&&(i+=Fy(r)),i+=n;(r=7-(n=(a=e[t])+"").length)&&(i+=Fy(r))}else if(0===a)return"0"
for(;a%10==0;)a/=10
return i+a}Dy.absoluteValue=Dy.abs=function(){var e=new this.constructor(this)
return e.s&&(e.s=1),e},Dy.comparedTo=Dy.cmp=function(e){var t,r,n,o,i=this
if(e=new i.constructor(e),i.s!==e.s)return i.s||-e.s
if(i.e!==e.e)return i.e>e.e^i.s<0?1:-1
for(t=0,r=(n=i.d.length)<(o=e.d.length)?n:o;t<r;++t)if(i.d[t]!==e.d[t])return i.d[t]>e.d[t]^i.s<0?1:-1
return n===o?0:n>o^i.s<0?1:-1},Dy.decimalPlaces=Dy.dp=function(){var e=this,t=e.d.length-1,r=7*(t-e.e)
if(t=e.d[t])for(;t%10==0;t/=10)r--
return r<0?0:r},Dy.dividedBy=Dy.div=function(e){return Ly(this,new this.constructor(e))},Dy.dividedToIntegerBy=Dy.idiv=function(e){var t=this.constructor
return Xy(Ly(this,new t(e),0,1),t.precision)},Dy.equals=Dy.eq=function(e){return!this.cmp(e)},Dy.exponent=function(){return zy(this)},Dy.greaterThan=Dy.gt=function(e){return this.cmp(e)>0},Dy.greaterThanOrEqualTo=Dy.gte=function(e){return this.cmp(e)>=0},Dy.isInteger=Dy.isint=function(){return this.e>this.d.length-2},Dy.isNegative=Dy.isneg=function(){return this.s<0},Dy.isPositive=Dy.ispos=function(){return this.s>0},Dy.isZero=function(){return 0===this.s},Dy.lessThan=Dy.lt=function(e){return this.cmp(e)<0},Dy.lessThanOrEqualTo=Dy.lte=function(e){return this.cmp(e)<1},Dy.logarithm=Dy.log=function(e){var t,r=this,n=r.constructor,o=n.precision,i=o+5
if(void 0===e)e=new n(10)
else if((e=new n(e)).s<1||e.eq(jy))throw Error(Ay+"NaN")
if(r.s<1)throw Error(Ay+(r.s?"NaN":"-Infinity"))
return r.eq(jy)?new n(0):(Py=!1,t=Ly(qy(r,i),qy(e,i),i),Py=!0,Xy(t,o))},Dy.minus=Dy.sub=function(e){var t=this
return e=new t.constructor(e),t.s==e.s?Hy(t,e):Ny(t,(e.s=-e.s,e))},Dy.modulo=Dy.mod=function(e){var t,r=this,n=r.constructor,o=n.precision
if(!(e=new n(e)).s)throw Error(Ay+"NaN")
return r.s?(Py=!1,t=Ly(r,e,0,1).times(e),Py=!0,r.minus(t)):Xy(new n(r),o)},Dy.naturalExponential=Dy.exp=function(){return Uy(this)},Dy.naturalLogarithm=Dy.ln=function(){return qy(this)},Dy.negated=Dy.neg=function(){var e=new this.constructor(this)
return e.s=-e.s||0,e},Dy.plus=Dy.add=function(e){var t=this
return e=new t.constructor(e),t.s==e.s?Ny(t,e):Hy(t,(e.s=-e.s,e))},Dy.precision=Dy.sd=function(e){var t,r,n,o=this
if(void 0!==e&&e!==!!e&&1!==e&&0!==e)throw Error(Ey+e)
if(t=zy(o)+1,r=7*(n=o.d.length-1)+1,n=o.d[n]){for(;n%10==0;n/=10)r--
for(n=o.d[0];n>=10;n/=10)r++}return e&&t>r?t:r},Dy.squareRoot=Dy.sqrt=function(){var e,t,r,n,o,i,a,l=this,c=l.constructor
if(l.s<1){if(!l.s)return new c(0)
throw Error(Ay+"NaN")}for(e=zy(l),Py=!1,0==(o=Math.sqrt(+l))||o==1/0?(((t=Ry(l.d)).length+e)%2==0&&(t+="0"),o=Math.sqrt(t),e=_y((e+1)/2)-(e<0||e%2),n=new c(t=o==1/0?"5e"+e:(t=o.toExponential()).slice(0,t.indexOf("e")+1)+e)):n=new c(o.toString()),o=a=(r=c.precision)+3;;)if(n=(i=n).plus(Ly(l,i,a+2)).times(.5),Ry(i.d).slice(0,a)===(t=Ry(n.d)).slice(0,a)){if(t=t.slice(a-3,a+1),o==a&&"4999"==t){if(Xy(i,r+1,0),i.times(i).eq(l)){n=i
break}}else if("9999"!=t)break
a+=4}return Py=!0,Xy(n,r)},Dy.times=Dy.mul=function(e){var t,r,n,o,i,a,l,c,s,u=this,f=u.constructor,p=u.d,h=(e=new f(e)).d
if(!u.s||!e.s)return new f(0)
for(e.s*=u.s,r=u.e+e.e,(c=p.length)<(s=h.length)&&(i=p,p=h,h=i,a=c,c=s,s=a),i=[],n=a=c+s;n--;)i.push(0)
for(n=s;--n>=0;){for(t=0,o=c+n;o>n;)l=i[o]+h[n]*p[o-n-1]+t,i[o--]=l%Cy|0,t=l/Cy|0
i[o]=(i[o]+t)%Cy|0}for(;!i[--a];)i.pop()
return t?++r:i.shift(),e.d=i,e.e=r,Py?Xy(e,f.precision):e},Dy.toDecimalPlaces=Dy.todp=function(e,t){var r=this,n=r.constructor
return r=new n(r),void 0===e?r:(By(e,0,Sy),void 0===t?t=n.rounding:By(t,0,8),Xy(r,e+zy(r)+1,t))},Dy.toExponential=function(e,t){var r,n=this,o=n.constructor
return void 0===e?r=Vy(n,!0):(By(e,0,Sy),void 0===t?t=o.rounding:By(t,0,8),r=Vy(n=Xy(new o(n),e+1,t),!0,e+1)),r},Dy.toFixed=function(e,t){var r,n,o=this,i=o.constructor
return void 0===e?Vy(o):(By(e,0,Sy),void 0===t?t=i.rounding:By(t,0,8),r=Vy((n=Xy(new i(o),e+zy(o)+1,t)).abs(),!1,e+zy(n)+1),o.isneg()&&!o.isZero()?"-"+r:r)},Dy.toInteger=Dy.toint=function(){var e=this,t=e.constructor
return Xy(new t(e),zy(e)+1,t.rounding)},Dy.toNumber=function(){return+this},Dy.toPower=Dy.pow=function(e){var t,r,n,o,i,a,l=this,c=l.constructor,s=+(e=new c(e))
if(!e.s)return new c(jy)
if(!(l=new c(l)).s){if(e.s<1)throw Error(Ay+"Infinity")
return l}if(l.eq(jy))return l
if(n=c.precision,e.eq(jy))return Xy(l,n)
if(a=(t=e.e)>=(r=e.d.length-1),i=l.s,a){if((r=s<0?-s:s)<=9007199254740991){for(o=new c(jy),t=Math.ceil(n/7+4),Py=!1;r%2&&Yy((o=o.times(l)).d,t),0!==(r=_y(r/2));)Yy((l=l.times(l)).d,t)
return Py=!0,e.s<0?new c(jy).div(o):Xy(o,n)}}else if(i<0)throw Error(Ay+"NaN")
return i=i<0&&1&e.d[Math.max(t,r)]?-1:1,l.s=1,Py=!1,o=e.times(qy(l,n+12)),Py=!0,(o=Uy(o)).s=i,o},Dy.toPrecision=function(e,t){var r,n,o=this,i=o.constructor
return void 0===e?n=Vy(o,(r=zy(o))<=i.toExpNeg||r>=i.toExpPos):(By(e,1,Sy),void 0===t?t=i.rounding:By(t,0,8),n=Vy(o=Xy(new i(o),e,t),e<=(r=zy(o))||r<=i.toExpNeg,e)),n},Dy.toSignificantDigits=Dy.tosd=function(e,t){var r=this.constructor
return void 0===e?(e=r.precision,t=r.rounding):(By(e,1,Sy),void 0===t?t=r.rounding:By(t,0,8)),Xy(new r(this),e,t)},Dy.toString=Dy.valueOf=Dy.val=Dy.toJSON=Dy[Symbol.for("nodejs.util.inspect.custom")]=function(){var e=this,t=zy(e),r=e.constructor
return Vy(e,t<=r.toExpNeg||t>=r.toExpPos)}
var Ly=(()=>{function e(e,t){var r,n=0,o=e.length
for(e=e.slice();o--;)r=e[o]*t+n,e[o]=r%Cy|0,n=r/Cy|0
return n&&e.unshift(n),e}function t(e,t,r,n){var o,i
if(r!=n)i=r>n?1:-1
else for(o=i=0;o<r;o++)if(e[o]!=t[o]){i=e[o]>t[o]?1:-1
break}return i}function r(e,t,r){for(var n=0;r--;)e[r]-=n,n=e[r]<t[r]?1:0,e[r]=n*Cy+e[r]-t[r]
for(;!e[0]&&e.length>1;)e.shift()}return(n,o,i,a)=>{var l,c,s,u,f,p,h,d,y,v,m,b,g,w,x,O,j,S,P=n.constructor,A=n.s==o.s?1:-1,E=n.d,M=o.d
if(!n.s)return new P(n)
if(!o.s)throw Error(Ay+"Division by zero")
for(c=n.e-o.e,j=M.length,x=E.length,d=(h=new P(A)).d=[],s=0;M[s]==(E[s]||0);)++s
if(M[s]>(E[s]||0)&&--c,(b=null==i?i=P.precision:a?i+(zy(n)-zy(o))+1:i)<0)return new P(0)
if(b=b/7+2|0,s=0,1==j)for(u=0,M=M[0],b++;(s<x||u)&&b--;s++)g=u*Cy+(E[s]||0),d[s]=g/M|0,u=g%M|0
else{for((u=Cy/(M[0]+1)|0)>1&&(M=e(M,u),E=e(E,u),j=M.length,x=E.length),w=j,v=(y=E.slice(0,j)).length;v<j;)y[v++]=0;(S=M.slice()).unshift(0),O=M[0],M[1]>=Cy/2&&++O
do{u=0,(l=t(M,y,j,v))<0?(m=y[0],j!=v&&(m=m*Cy+(y[1]||0)),(u=m/O|0)>1?(u>=Cy&&(u=Cy-1),1==(l=t(f=e(M,u),y,p=f.length,v=y.length))&&(u--,r(f,j<p?S:M,p))):(0==u&&(l=u=1),f=M.slice()),(p=f.length)<v&&f.unshift(0),r(y,f,v),-1==l&&(l=t(M,y,j,v=y.length))<1&&(u++,r(y,j<v?S:M,v)),v=y.length):0===l&&(u++,y=[0]),d[s++]=u,l&&y[0]?y[v++]=E[w]||0:(y=[E[w]],v=1)}while((w++<x||void 0!==y[0])&&b--)}return d[0]||d.shift(),h.e=c,Xy(h,a?i+zy(h)+1:i)}})()
function Uy(e,t){var r,n,o,i,a,l=0,c=0,s=e.constructor,u=s.precision
if(zy(e)>16)throw Error(My+zy(e))
if(!e.s)return new s(jy)
for(Py=!1,a=u,i=new s(.03125);e.abs().gte(.1);)e=e.times(i),c+=5
for(a+=Math.log(Ty(2,c))/Math.LN10*2+5|0,r=n=o=new s(jy),s.precision=a;;){if(n=Xy(n.times(e),a),r=r.times(++l),Ry((i=o.plus(Ly(n,r,a))).d).slice(0,a)===Ry(o.d).slice(0,a)){for(;c--;)o=Xy(o.times(o),a)
return s.precision=u,null==t?(Py=!0,Xy(o,u)):o}o=i}}function zy(e){for(var t=7*e.e,r=e.d[0];r>=10;r/=10)t++
return t}function $y(e,t,r){if(t>e.LN10.sd())throw Py=!0,r&&(e.precision=r),Error(Ay+"LN10 precision limit exceeded")
return Xy(new e(e.LN10),t)}function Fy(e){for(var t="";e--;)t+="0"
return t}function qy(e,t){var r,n,o,i,a,l,c,s,u,f=1,p=e,h=p.d,d=p.constructor,y=d.precision
if(p.s<1)throw Error(Ay+(p.s?"NaN":"-Infinity"))
if(p.eq(jy))return new d(0)
if(null==t?(Py=!1,s=y):s=t,p.eq(10))return null==t&&(Py=!0),$y(d,s)
if(s+=10,d.precision=s,n=(r=Ry(h)).charAt(0),i=zy(p),!(Math.abs(i)<15e14))return c=$y(d,s+2,y).times(i+""),p=qy(new d(n+"."+r.slice(1)),s-10).plus(c),d.precision=y,null==t?(Py=!0,Xy(p,y)):p
for(;n<7&&1!=n||1==n&&r.charAt(1)>3;)n=(r=Ry((p=p.times(e)).d)).charAt(0),f++
for(i=zy(p),n>1?(p=new d("0."+r),i++):p=new d(n+"."+r.slice(1)),l=a=p=Ly(p.minus(jy),p.plus(jy),s),u=Xy(p.times(p),s),o=3;;){if(a=Xy(a.times(u),s),Ry((c=l.plus(Ly(a,new d(o),s))).d).slice(0,s)===Ry(l.d).slice(0,s))return l=l.times(2),0!==i&&(l=l.plus($y(d,s+2,y).times(i+""))),l=Ly(l,new d(f),s),d.precision=y,null==t?(Py=!0,Xy(l,y)):l
l=c,o+=2}}function Wy(e,t){var r,n,o
for((r=t.indexOf("."))>-1&&(t=t.replace(".","")),(n=t.search(/e/i))>0?(r<0&&(r=n),r+=+t.slice(n+1),t=t.substring(0,n)):r<0&&(r=t.length),n=0;48===t.charCodeAt(n);)++n
for(o=t.length;48===t.charCodeAt(o-1);)--o
if(t=t.slice(n,o)){if(o-=n,r=r-n-1,e.e=_y(r/7),e.d=[],n=(r+1)%7,r<0&&(n+=7),n<o){for(n&&e.d.push(+t.slice(0,n)),o-=7;n<o;)e.d.push(+t.slice(n,n+=7))
n=7-(t=t.slice(n)).length}else n-=o
for(;n--;)t+="0"
if(e.d.push(+t),Py&&(e.e>Iy||e.e<-Iy))throw Error(My+r)}else e.s=0,e.e=0,e.d=[0]
return e}function Xy(e,t,r){var n,o,i,a,l,c,s,u,f=e.d
for(a=1,i=f[0];i>=10;i/=10)a++
if((n=t-a)<0)n+=7,o=t,s=f[u=0]
else{if((u=Math.ceil((n+1)/7))>=(i=f.length))return e
for(s=i=f[u],a=1;i>=10;i/=10)a++
o=(n%=7)-7+a}if(void 0!==r&&(l=s/(i=Ty(10,a-o-1))%10|0,c=t<0||void 0!==f[u+1]||s%i,c=r<4?(l||c)&&(0==r||r==(e.s<0?3:2)):l>5||5==l&&(4==r||c||6==r&&(n>0?o>0?s/Ty(10,a-o):0:f[u-1])%10&1||r==(e.s<0?8:7))),t<1||!f[0])return c?(i=zy(e),f.length=1,t=t-i-1,f[0]=Ty(10,(7-t%7)%7),e.e=_y(-t/7)||0):(f.length=1,f[0]=e.e=e.s=0),e
if(0==n?(f.length=u,i=1,u--):(f.length=u+1,i=Ty(10,7-n),f[u]=o>0?(s/Ty(10,a-o)%Ty(10,o)|0)*i:0),c)for(;;){if(0==u){(f[0]+=i)==Cy&&(f[0]=1,++e.e)
break}if(f[u]+=i,f[u]!=Cy)break
f[u--]=0,i=1}for(n=f.length;0===f[--n];)f.pop()
if(Py&&(e.e>Iy||e.e<-Iy))throw Error(My+zy(e))
return e}function Hy(e,t){var r,n,o,i,a,l,c,s,u,f,p=e.constructor,h=p.precision
if(!e.s||!t.s)return t.s?t.s=-t.s:t=new p(e),Py?Xy(t,h):t
if(c=e.d,f=t.d,n=t.e,s=e.e,c=c.slice(),a=s-n){for((u=a<0)?(r=c,a=-a,l=f.length):(r=f,n=s,l=c.length),a>(o=Math.max(Math.ceil(h/7),l)+2)&&(a=o,r.length=1),r.reverse(),o=a;o--;)r.push(0)
r.reverse()}else{for((u=(o=c.length)<(l=f.length))&&(l=o),o=0;o<l;o++)if(c[o]!=f[o]){u=c[o]<f[o]
break}a=0}for(u&&(r=c,c=f,f=r,t.s=-t.s),l=c.length,o=f.length-l;o>0;--o)c[l++]=0
for(o=f.length;o>a;){if(c[--o]<f[o]){for(i=o;i&&0===c[--i];)c[i]=Cy-1;--c[i],c[o]+=Cy}c[o]-=f[o]}for(;0===c[--l];)c.pop()
for(;0===c[0];c.shift())--n
return c[0]?(t.d=c,t.e=n,Py?Xy(t,h):t):new p(0)}function Vy(e,t,r){var n,o=zy(e),i=Ry(e.d),a=i.length
return t?(r&&(n=r-a)>0?i=i.charAt(0)+"."+i.slice(1)+Fy(n):a>1&&(i=i.charAt(0)+"."+i.slice(1)),i=i+(o<0?"e":"e+")+o):o<0?(i="0."+Fy(-o-1)+i,r&&(n=r-a)>0&&(i+=Fy(n))):o>=a?(i+=Fy(o+1-a),r&&(n=r-o-1)>0&&(i=i+"."+Fy(n))):((n=o+1)<a&&(i=i.slice(0,n)+"."+i.slice(n)),r&&(n=r-a)>0&&(o+1===a&&(i+="."),i+=Fy(n))),e.s<0?"-"+i:i}function Yy(e,t){if(e.length>t)return e.length=t,!0}function Gy(e){if(!e||"object"!=typeof e)throw Error(Ay+"Object expected")
var t,r,n,o=["precision",1,Sy,"rounding",0,8,"toExpNeg",-1/0,0,"toExpPos",0,1/0]
for(t=0;t<o.length;t+=3)if(void 0!==(n=e[r=o[t]])){if(!(_y(n)===n&&n>=o[t+1]&&n<=o[t+2]))throw Error(Ey+r+": "+n)
this[r]=n}if(void 0!==(n=e[r="LN10"])){if(n!=Math.LN10)throw Error(Ey+r+": "+n)
this[r]=new this(n)}return this}var Ky=function e(t){var r,n,o
function i(e){var t=this
if(!(t instanceof i))return new i(e)
if(t.constructor=i,e instanceof i)return t.s=e.s,t.e=e.e,void(t.d=(e=e.d)?e.slice():e)
if("number"==typeof e){if(0*e!=0)throw Error(Ey+e)
if(e>0)t.s=1
else{if(!(e<0))return t.s=0,t.e=0,void(t.d=[0])
e=-e,t.s=-1}return e===~~e&&e<1e7?(t.e=0,void(t.d=[e])):Wy(t,e.toString())}if("string"!=typeof e)throw Error(Ey+e)
if(45===e.charCodeAt(0)?(e=e.slice(1),t.s=-1):t.s=1,!ky.test(e))throw Error(Ey+e)
Wy(t,e)}if(i.prototype=Dy,i.ROUND_UP=0,i.ROUND_DOWN=1,i.ROUND_CEIL=2,i.ROUND_FLOOR=3,i.ROUND_HALF_UP=4,i.ROUND_HALF_DOWN=5,i.ROUND_HALF_EVEN=6,i.ROUND_HALF_CEIL=7,i.ROUND_HALF_FLOOR=8,i.clone=e,i.config=i.set=Gy,void 0===t&&(t={}),t)for(o=["precision","rounding","toExpNeg","toExpPos","LN10"],r=0;r<o.length;)t.hasOwnProperty(n=o[r++])||(t[n]=this[n])
return i.config(t),i}({precision:20,rounding:4,toExpNeg:-7,toExpPos:21,LN10:"2.302585092994045684017991454684364207601101488628772976033327900967572609677352480235997205089598298341967784042286"})
jy=new Ky(1)
const Zy=Ky
function Jy(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}var Qy=e=>e,ev={},tv=e=>e===ev,rv=e=>function t(){return 0===arguments.length||1===arguments.length&&tv(arguments.length<=0?void 0:arguments[0])?t:e.apply(void 0,arguments)},nv=function e(t,r){return 1===t?r:rv(function(){for(var n=arguments.length,o=new Array(n),i=0;i<n;i++)o[i]=arguments[i]
var a=o.filter(e=>e!==ev).length
return a>=t?r.apply(void 0,o):e(t-a,rv(function(){for(var e=arguments.length,t=new Array(e),n=0;n<e;n++)t[n]=arguments[n]
var i,a=o.map(e=>tv(e)?t.shift():e)
return r.apply(void 0,(i=a,(e=>{if(Array.isArray(e))return Jy(e)})(i)||(e=>{if("undefined"!=typeof Symbol&&Symbol.iterator in Object(e))return Array.from(e)})(i)||((e,t)=>{if(e){if("string"==typeof e)return Jy(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?Jy(e,t):void 0}})(i)||(()=>{throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()).concat(t))}))})},ov=e=>nv(e.length,e),iv=(e,t)=>{for(var r=[],n=e;n<t;++n)r[n-e]=n
return r},av=ov((e,t)=>Array.isArray(t)?t.map(e):Object.keys(t).map(e=>t[e]).map(e)),lv=e=>Array.isArray(e)?e.reverse():e.split("").reverse.join(""),cv=e=>{var t=null,r=null
return function(){for(var n=arguments.length,o=new Array(n),i=0;i<n;i++)o[i]=arguments[i]
return t&&o.every((e,r)=>e===t[r])?r:(t=o,r=e.apply(void 0,o))}}
const sv=(e,t,r)=>{for(var n=new Zy(e),o=0,i=[];n.lt(t)&&o<1e5;)i.push(n.toNumber()),n=n.add(r),o++
return i},uv=e=>0===e?1:Math.floor(new Zy(e).abs().log(10).toNumber())+1
function fv(e){return(e=>{if(Array.isArray(e))return dv(e)})(e)||(e=>{if("undefined"!=typeof Symbol&&Symbol.iterator in Object(e))return Array.from(e)})(e)||hv(e)||(()=>{throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()}function pv(e,t){return(e=>{if(Array.isArray(e))return e})(e)||((e,t)=>{if("undefined"!=typeof Symbol&&Symbol.iterator in Object(e)){var r=[],n=!0,o=!1,i=void 0
try{for(var a,l=e[Symbol.iterator]();!(n=(a=l.next()).done)&&(r.push(a.value),!t||r.length!==t);n=!0);}catch(c){o=!0,i=c}finally{try{n||null==l.return||l.return()}finally{if(o)throw i}}return r}})(e,t)||hv(e,t)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()}function hv(e,t){if(e){if("string"==typeof e)return dv(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?dv(e,t):void 0}}function dv(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function yv(e){var t=pv(e,2),r=t[0],n=t[1],o=r,i=n
return r>n&&(o=n,i=r),[o,i]}function vv(e,t,r){if(e.lte(0))return new Zy(0)
var n=uv(e.toNumber()),o=new Zy(10).pow(n),i=e.div(o),a=1!==n?.05:.1,l=new Zy(Math.ceil(i.div(a).toNumber())).add(r).mul(a).mul(o)
return t?l:new Zy(Math.ceil(l))}function mv(e,t,r,n){var o=arguments.length>4&&void 0!==arguments[4]?arguments[4]:0
if(!Number.isFinite((t-e)/(r-1)))return{step:new Zy(0),tickMin:new Zy(0),tickMax:new Zy(0)}
var i,a=vv(new Zy(t).sub(e).div(r-1),n,o)
i=e<=0&&t>=0?new Zy(0):(i=new Zy(e).add(t).div(2)).sub(new Zy(i).mod(a))
var l=Math.ceil(i.sub(e).div(a).toNumber()),c=Math.ceil(new Zy(t).sub(i).div(a).toNumber()),s=l+c+1
return s>r?mv(e,t,r,n,o+1):(s<r&&(c=t>0?c+(r-s):c,l=t>0?l:l+(r-s)),{step:a,tickMin:i.sub(new Zy(l).mul(a)),tickMax:i.add(new Zy(c).mul(a))})}ov((e,t,r)=>{var n=+e
return n+r*(+t-n)}),ov((e,t,r)=>(r-e)/(t-+e||1/0)),ov((e,t,r)=>{var n=t-+e
return n=n||1/0,Math.max(0,Math.min(1,(r-e)/n))})
var bv=cv(function(e){var t=pv(e,2),r=t[0],n=t[1],o=arguments.length>1&&void 0!==arguments[1]?arguments[1]:6,i=!(arguments.length>2&&void 0!==arguments[2])||arguments[2],a=Math.max(o,2),l=pv(yv([r,n]),2),c=l[0],s=l[1]
if(c===-1/0||s===1/0){var u=s===1/0?[c].concat(fv(iv(0,o-1).map(()=>1/0))):[].concat(fv(iv(0,o-1).map(()=>-1/0)),[s])
return r>n?lv(u):u}if(c===s)return((e,t,r)=>{var n=1,o=new Zy(e)
if(!o.isint()&&r){var i=Math.abs(e)
i<1?(n=new Zy(10).pow(uv(e)-1),o=new Zy(Math.floor(o.div(n).toNumber())).mul(n)):i>1&&(o=new Zy(Math.floor(e)))}else 0===e?o=new Zy(Math.floor((t-1)/2)):r||(o=new Zy(Math.floor(e)))
var a=Math.floor((t-1)/2),l=function(){for(var e=arguments.length,t=new Array(e),r=0;r<e;r++)t[r]=arguments[r]
if(!t.length)return Qy
var n=t.reverse(),o=n[0],i=n.slice(1)
return function(){return i.reduce((e,t)=>t(e),o.apply(void 0,arguments))}}(av(e=>o.add(new Zy(e-a).mul(n)).toNumber()),iv)
return l(0,t)})(c,o,i)
var f=mv(c,s,a,i),p=f.step,h=f.tickMin,d=f.tickMax,y=sv(h,d.add(new Zy(.1).mul(p)),p)
return r>n?lv(y):y}),gv=cv(function(e,t){var r=pv(e,2),n=r[0],o=r[1],i=!(arguments.length>2&&void 0!==arguments[2])||arguments[2],a=pv(yv([n,o]),2),l=a[0],c=a[1]
if(l===-1/0||c===1/0)return[n,o]
if(l===c)return[l]
var s=Math.max(t,2),u=vv(new Zy(c).sub(l).div(s-1),i,0),f=[].concat(fv(sv(new Zy(l),new Zy(c).sub(new Zy(.99).mul(u)),u)),[c])
return n>o?lv(f):f})
function wv(){throw new Error("Invariant failed")}var xv=["offset","layout","width","dataKey","data","dataPointFormatter","xAxis","yAxis"]
function Ov(e){return(Ov="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function jv(){return jv=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},jv.apply(this,arguments)}function Sv(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function Pv(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{}))}catch(t){}return(Pv=()=>!!e)()}function Av(e){return(Av=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}function Ev(e,t){return(Ev=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function Mv(e,t,r){return(t=_v(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function _v(e){var t=(e=>{if("object"!=Ov(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Ov(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==Ov(t)?t:t+""}var Tv=function(){function e(){return((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,e),t=this,n=arguments,r=Av(r=e),((e,t)=>{if(t&&("object"===Ov(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return(e=>{if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e})(e)})(t,Pv()?Reflect.construct(r,n||[],Av(t).constructor):r.apply(t,n))
var t,r,n}return((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&Ev(e,t)})(e,o.Component),t=e,(r=[{key:"render",value:function(){var e=this.props,t=e.offset,r=e.layout,n=e.width,i=e.dataKey,a=e.data,l=e.dataPointFormatter,c=e.xAxis,s=e.yAxis,u=((e,t)=>{if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o})(e,xv),f=Er(u,!1)
"x"===this.props.direction&&"number"!==c.type&&wv()
var p=a.map(e=>{var a=l(e,i),u=a.x,p=a.y,h=a.value,d=a.errorVal
if(!d)return null
var y,v,m,b=[]
if(Array.isArray(d)){var g=(e=>{if(Array.isArray(e))return e})(m=d)||(e=>{var t=null==e?null:"undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"]
if(null!=t){var r,n,o,i,a=[],l=!0,c=!1
try{for(o=(t=t.call(e)).next;!(l=(r=o.call(t)).done)&&(a.push(r.value),2!==a.length);l=!0);}catch(s){c=!0,n=s}finally{try{if(!l&&null!=t.return&&(i=t.return(),Object(i)!==i))return}finally{if(c)throw n}}return a}})(m)||(e=>{if(e){if("string"==typeof e)return Sv(e,2)
var t=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===t&&e.constructor&&(t=e.constructor.name),"Map"===t||"Set"===t?Array.from(e):"Arguments"===t||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t)?Sv(e,2):void 0}})(m)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()
y=g[0],v=g[1]}else y=v=d
if("vertical"===r){var w=c.scale,x=p+t,O=x+n,j=x-n,S=w(h-y),P=w(h+v)
b.push({x1:P,y1:O,x2:P,y2:j}),b.push({x1:S,y1:x,x2:P,y2:x}),b.push({x1:S,y1:O,x2:S,y2:j})}else if("horizontal"===r){var A=s.scale,E=u+t,M=E-n,_=E+n,T=A(h-y),k=A(h+v)
b.push({x1:M,y1:k,x2:_,y2:k}),b.push({x1:E,y1:T,x2:E,y2:k}),b.push({x1:M,y1:T,x2:_,y2:T})}return o.createElement(Jr,jv({className:"recharts-errorBar",key:"bar-".concat(b.map(e=>"".concat(e.x1,"-").concat(e.x2,"-").concat(e.y1,"-").concat(e.y2)))},f),b.map(e=>o.createElement("line",jv({},e,{key:"line-".concat(e.x1,"-").concat(e.x2,"-").concat(e.y1,"-").concat(e.y2)}))))})
return o.createElement(Jr,{className:"recharts-errorBars"},p)}}])&&((e,t)=>{for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,_v(n.key),n)}})(t.prototype,r),Object.defineProperty(t,"prototype",{writable:!1}),t
var t,r}()
function kv(e){return(kv="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Cv(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Iv(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Cv(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=kv(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=kv(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==kv(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Cv(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}Mv(Tv,"defaultProps",{stroke:"black",strokeWidth:1.5,width:5,offset:0,layout:"horizontal"}),Mv(Tv,"displayName","ErrorBar")
var Dv=e=>{var t=e.children,r=e.formattedGraphicalItems,n=e.legendWidth,o=e.legendContent,i=jr(t,Dc)
if(!i)return null
var a,l=Dc.defaultProps,c=void 0!==l?Iv(Iv({},l),i.props):{}
return a=i.props&&i.props.payload?i.props&&i.props.payload:"children"===o?(r||[]).reduce((e,t)=>{var r=t.item,n=t.props,o=n.sectors||n.data||[]
return e.concat(o.map(e=>({type:i.props.iconType||r.props.legendType,value:e.name,color:e.fill,payload:e})))},[]):(r||[]).map(e=>{var t=e.item,r=t.type.defaultProps,n=void 0!==r?Iv(Iv({},r),t.props):{},o=n.dataKey,i=n.name,a=n.legendType
return{inactive:n.hide,dataKey:o,type:c.iconType||a||"square",color:qv(t),value:i||o,payload:n}}),Iv(Iv(Iv({},c),Dc.getWithHeight(i,n)),{},{payload:a,item:i})}
function Nv(e){return(Nv="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Bv(e){return(e=>{if(Array.isArray(e))return Rv(e)})(e)||(e=>{if("undefined"!=typeof Symbol&&null!=e[Symbol.iterator]||null!=e["@@iterator"])return Array.from(e)})(e)||((e,t)=>{if(e){if("string"==typeof e)return Rv(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?Rv(e,t):void 0}})(e)||(()=>{throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()}function Rv(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function Lv(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Uv(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Lv(Object(r),!0).forEach(t=>{zv(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Lv(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function zv(e,t,r){var n
return n=(e=>{if("object"!=Nv(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Nv(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(t),(t="symbol"==Nv(n)?n:n+"")in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function $v(e,t,r){return Tt(e)||Tt(t)?r:Zt(t)?Et(e,t,r):Dt(t)?t(e):r}function Fv(e,t,r,n){var o=gy(e,e=>$v(e,t))
if("number"===r){var i=o.filter(e=>Kt(e)||parseFloat(e))
return i.length?[dy(i),cy(i)]:[1/0,-1/0]}return(n?o.filter(e=>!Tt(e)):o).map(e=>Zt(e)||e instanceof Date?e:"")}var qv=e=>{var t,r,n=e.type.displayName,o=null!==(t=e.type)&&void 0!==t&&t.defaultProps?Uv(Uv({},e.type.defaultProps),e.props):e.props,i=o.stroke,a=o.fill
switch(n){case"Line":r=i
break
case"Area":case"Radar":r=i&&"none"!==i?i:a
break
default:r=a}return r},Wv=(e,t,r,n,o)=>{var i=Or(t.props.children,Tv).filter(e=>((e,t,r)=>!!Tt(t)||("horizontal"===e?"yAxis"===t:"vertical"===e||"x"===r?"xAxis"===t:"y"!==r||"yAxis"===t))(n,o,e.props.direction))
if(i&&i.length){var a=i.map(e=>e.props.dataKey)
return e.reduce((e,t)=>{var n=$v(t,r)
if(Tt(n))return e
var o=Array.isArray(n)?[dy(n),cy(n)]:[n,n],i=a.reduce((e,r)=>{var n=$v(t,r,0),i=o[0]-Math.abs(Array.isArray(n)?n[0]:n),a=o[1]+Math.abs(Array.isArray(n)?n[1]:n)
return[Math.min(i,e[0]),Math.max(a,e[1])]},[1/0,-1/0])
return[Math.min(i[0],e[0]),Math.max(i[1],e[1])]},[1/0,-1/0])}return null},Xv=(e,t,r,n,o)=>{var i=t.map(t=>{var i=t.props.dataKey
return"number"===r&&i&&Wv(e,t,i,n)||Fv(e,i,r,o)})
if("number"===r)return i.reduce((e,t)=>[Math.min(e[0],t[0]),Math.max(e[1],t[1])],[1/0,-1/0])
var a={}
return i.reduce((e,t)=>{for(var r=0,n=t.length;r<n;r++)a[t[r]]||(a[t[r]]=!0,e.push(t[r]))
return e},[])},Hv=(e,t)=>"horizontal"===e&&"xAxis"===t||"vertical"===e&&"yAxis"===t||"centric"===e&&"angleAxis"===t||"radial"===e&&"radiusAxis"===t,Vv=(e,t,r,n)=>{if(n)return e.map(e=>e.coordinate)
var o,i,a=e.map(e=>(e.coordinate===t&&(o=!0),e.coordinate===r&&(i=!0),e.coordinate))
return o||a.push(t),i||a.push(r),a},Yv=(e,t,r)=>{if(!e)return null
var n=e.scale,o=e.duplicateDomain,i=e.type,a=e.range,l="scaleBand"===e.realScaleType?n.bandwidth()/2:2,c=(t||r)&&"category"===i&&n.bandwidth?n.bandwidth()/l:0
return c="angleAxis"===e.axisType&&(null==a?void 0:a.length)>=2?2*Yt(a[0]-a[1])*c:c,t&&(e.ticks||e.niceTicks)?(e.ticks||e.niceTicks).map(e=>{var t=o?o.indexOf(e):e
return{coordinate:n(t)+c,value:e,offset:c}}).filter(e=>!Ht(e.coordinate)):e.isCategorical&&e.categoricalDomain?e.categoricalDomain.map((e,t)=>({coordinate:n(e)+c,value:e,index:t,offset:c})):n.ticks&&!r?n.ticks(e.tickCount).map(e=>({coordinate:n(e)+c,value:e,offset:c})):n.domain().map((e,t)=>({coordinate:n(e)+c,value:o?o[e]:e,index:t,offset:c}))},Gv=new WeakMap,Kv=(e,t)=>{if("function"!=typeof t)return e
Gv.has(e)||Gv.set(e,new WeakMap)
var r=Gv.get(e)
if(r.has(t))return r.get(t)
var n=function(){e.apply(void 0,arguments),t.apply(void 0,arguments)}
return r.set(t,n),n},Zv=(e,t,r)=>{var n=e.scale,o=e.type,i=e.layout,a=e.axisType
if("auto"===n)return"radial"===i&&"radiusAxis"===a?{scale:Vu(),realScaleType:"band"}:"radial"===i&&"angleAxis"===a?{scale:yp(),realScaleType:"linear"}:"category"===o&&t&&(t.indexOf("LineChart")>=0||t.indexOf("AreaChart")>=0||t.indexOf("ComposedChart")>=0&&!r)?{scale:Gu(),realScaleType:"point"}:"category"===o?{scale:Vu(),realScaleType:"band"}:{scale:yp(),realScaleType:"linear"}
if(It(n)){var l="scale".concat(tn(n))
return{scale:(Qd[l]||Gu)(),realScaleType:Qd[l]?l:"point"}}return Dt(n)?{scale:n}:{scale:Gu(),realScaleType:"point"}},Jv=1e-4,Qv=e=>{var t=e.domain()
if(t&&!(t.length<=2)){var r=t.length,n=e.range(),o=Math.min(n[0],n[1])-Jv,i=Math.max(n[0],n[1])+Jv,a=e(t[0]),l=e(t[r-1]);(a<o||a>i||l<o||l>i)&&e.domain([t[0],t[r-1]])}},em={sign:e=>{var t=e.length
if(!(t<=0))for(var r=0,n=e[0].length;r<n;++r)for(var o=0,i=0,a=0;a<t;++a){var l=Ht(e[a][r][1])?e[a][r][0]:e[a][r][1]
l>=0?(e[a][r][0]=o,e[a][r][1]=o+l,o=e[a][r][1]):(e[a][r][0]=i,e[a][r][1]=i+l,i=e[a][r][1])}},expand:(e,t)=>{if((n=e.length)>0){for(var r,n,o,i=0,a=e[0].length;i<a;++i){for(o=r=0;r<n;++r)o+=e[r][i][1]||0
if(o)for(r=0;r<n;++r)e[r][i][1]/=o}no(e,t)}},none:no,silhouette:(e,t)=>{if((r=e.length)>0){for(var r,n=0,o=e[t[0]],i=o.length;n<i;++n){for(var a=0,l=0;a<r;++a)l+=e[a][n][1]||0
o[n][1]+=o[n][0]=-l/2}no(e,t)}},wiggle:(e,t)=>{if((o=e.length)>0&&(n=(r=e[t[0]]).length)>0){for(var r,n,o,i=0,a=1;a<n;++a){for(var l=0,c=0,s=0;l<o;++l){for(var u=e[t[l]],f=u[a][1]||0,p=(f-(u[a-1][1]||0))/2,h=0;h<l;++h){var d=e[t[h]]
p+=(d[a][1]||0)-(d[a-1][1]||0)}c+=f,s+=p*f}r[a-1][1]+=r[a-1][0]=i,c&&(i-=s/c)}r[a-1][1]+=r[a-1][0]=i,no(e,t)}},positive:e=>{var t=e.length
if(!(t<=0))for(var r=0,n=e[0].length;r<n;++r)for(var o=0,i=0;i<t;++i){var a=Ht(e[i][r][1])?e[i][r][0]:e[i][r][1]
a>=0?(e[i][r][0]=o,e[i][r][1]=o+a,o=e[i][r][1]):(e[i][r][0]=0,e[i][r][1]=0)}}},tm=function(e,t,r){var n=t.map(e=>e.props.dataKey),o=em[r],i=function(){var e=rn([]),t=oo,r=no,n=io
function o(o){var i,a,l=Array.from(e.apply(this,arguments),ao),c=l.length,s=-1
for(const e of o)for(i=0,++s;i<c;++i)(l[i][s]=[0,+n(e,l[i].key,s,o)]).data=e
for(i=0,a=vn(t(l));i<c;++i)l[a[i]].index=i
return r(l,a),l}return o.keys=function(t){return arguments.length?(e="function"==typeof t?t:rn(Array.from(t)),o):e},o.value=function(e){return arguments.length?(n="function"==typeof e?e:rn(+e),o):n},o.order=function(e){return arguments.length?(t=null==e?oo:"function"==typeof e?e:rn(Array.from(e)),o):t},o.offset=function(e){return arguments.length?(r=e??no,o):r},o}().keys(n).value((e,t)=>+$v(e,t,0)).order(oo).offset(o)
return i(e)},rm=(e,t)=>{var r=t.realScaleType,n=t.type,o=t.tickCount,i=t.originalDomain,a=t.allowDecimals,l=r||t.scale
if("auto"!==l&&"linear"!==l)return null
if(o&&"number"===n&&i&&("auto"===i[0]||"auto"===i[1])){var c=e.domain()
if(!c.length)return null
var s=bv(c,o,a)
return e.domain([dy(s),cy(s)]),{niceTicks:s}}if(o&&"number"===n){var u=e.domain()
return{niceTicks:gv(u,o,a)}}return null}
function nm(e){var t=e.axis,r=e.ticks,n=e.bandSize,o=e.entry,i=e.index,a=e.dataKey
if("category"===t.type){if(!t.allowDuplicatedCategory&&t.dataKey&&!Tt(o[t.dataKey])){var l=nr(r,"value",o[t.dataKey])
if(l)return l.coordinate+n/2}return r[i]?r[i].coordinate+n/2:null}var c=$v(o,Tt(a)?t.dataKey:a)
return Tt(c)?null:t.scale(c)}var om=e=>{var t=e.axis,r=e.ticks,n=e.offset,o=e.bandSize,i=e.entry,a=e.index
if("category"===t.type)return r[a]?r[a].coordinate+n:null
var l=$v(i,t.dataKey,t.domain[a])
return Tt(l)?null:t.scale(l)-o/2+n},im=(e,t,r)=>Object.keys(e).reduce((n,o)=>{var i=e[o].stackedData.reduce((e,n)=>{var o=n.slice(t,r+1).reduce((e,t)=>[dy(t.concat([e[0]]).filter(Kt)),cy(t.concat([e[1]]).filter(Kt))],[1/0,-1/0])
return[Math.min(e[0],o[0]),Math.max(e[1],o[1])]},[1/0,-1/0])
return[Math.min(i[0],n[0]),Math.max(i[1],n[1])]},[1/0,-1/0]).map(e=>e===1/0||e===-1/0?0:e),am=/^dataMin[\s]*-[\s]*([0-9]+([.]{1}[0-9]+){0,1})$/,lm=/^dataMax[\s]*\+[\s]*([0-9]+([.]{1}[0-9]+){0,1})$/,cm=(e,t,r)=>{if(Dt(e))return e(t,r)
if(!Array.isArray(e))return t
var n=[]
if(Kt(e[0]))n[0]=r?e[0]:Math.min(e[0],t[0])
else if(am.test(e[0])){var o=+am.exec(e[0])[1]
n[0]=t[0]-o}else Dt(e[0])?n[0]=e[0](t[0]):n[0]=t[0]
if(Kt(e[1]))n[1]=r?e[1]:Math.max(e[1],t[1])
else if(lm.test(e[1])){var i=+lm.exec(e[1])[1]
n[1]=t[1]+i}else Dt(e[1])?n[1]=e[1](t[1]):n[1]=t[1]
return n},sm=(e,t,r)=>{if(e&&e.scale&&e.scale.bandwidth){var n=e.scale.bandwidth()
if(!r||n>0)return n}if(e&&t&&t.length>=2){for(var o=$c(t,e=>e.coordinate),i=1/0,a=1,l=o.length;a<l;a++){var c=o[a],s=o[a-1]
i=Math.min((c.coordinate||0)-(s.coordinate||0),i)}return i===1/0?0:i}return r?void 0:0},um=(e,t,r)=>e&&e.length?Oy(e,Et(r,"type.defaultProps.domain"))?t:e:t,fm=(e,t)=>{var r=e.type.defaultProps?Uv(Uv({},e.type.defaultProps),e.props):e.props,n=r.dataKey,o=r.name,i=r.unit,a=r.formatter,l=r.tooltipType,c=r.chartType,s=r.hide
return Uv(Uv({},Er(e,!1)),{},{dataKey:n,unit:i,formatter:a,name:o||n,color:qv(e),value:$v(t,n),type:l,payload:t,chartType:c,hide:s})}
function pm(e){return(pm="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function hm(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function dm(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?hm(Object(r),!0).forEach(t=>{ym(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):hm(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function ym(e,t,r){var n
return n=(e=>{if("object"!=pm(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=pm(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(t),(t="symbol"==pm(n)?n:n+"")in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function vm(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}var mm=Math.PI/180,bm=e=>180*e/Math.PI,gm=(e,t,r,n)=>({x:e+Math.cos(-mm*n)*r,y:t+Math.sin(-mm*n)*r}),wm=function(e,t){var r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:{top:0,right:0,bottom:0,left:0}
return Math.min(Math.abs(e-(r.left||0)-(r.right||0)),Math.abs(t-(r.top||0)-(r.bottom||0)))/2},xm=(e,t,r,n,o)=>{var i=e.width,a=e.height,l=e.startAngle,c=e.endAngle,s=er(e.cx,i,i/2),u=er(e.cy,a,a/2),f=wm(i,a,r),p=er(e.innerRadius,f,0),h=er(e.outerRadius,f,.8*f)
return Object.keys(t).reduce((e,r)=>{var i,a,f=t[r],d=f.domain,y=f.reversed
if(Tt(f.range))"angleAxis"===n?i=[l,c]:"radiusAxis"===n&&(i=[p,h]),y&&(i=[i[1],i[0]])
else{var v=(e=>{if(Array.isArray(e))return e})(a=i=f.range)||(e=>{var t=null==e?null:"undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"]
if(null!=t){var r,n,o,i,a=[],l=!0,c=!1
try{for(o=(t=t.call(e)).next;!(l=(r=o.call(t)).done)&&(a.push(r.value),2!==a.length);l=!0);}catch(s){c=!0,n=s}finally{try{if(!l&&null!=t.return&&(i=t.return(),Object(i)!==i))return}finally{if(c)throw n}}return a}})(a)||(e=>{if(e){if("string"==typeof e)return vm(e,2)
var t=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===t&&e.constructor&&(t=e.constructor.name),"Map"===t||"Set"===t?Array.from(e):"Arguments"===t||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t)?vm(e,2):void 0}})(a)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()
l=v[0],c=v[1]}var m=Zv(f,o),b=m.realScaleType,g=m.scale
g.domain(d).range(i),Qv(g)
var w=rm(g,dm(dm({},f),{},{realScaleType:b})),x=dm(dm(dm({},f),w),{},{range:i,radius:h,realScaleType:b,scale:g,cx:s,cy:u,innerRadius:p,outerRadius:h,startAngle:l,endAngle:c})
return dm(dm({},e),{},ym({},r,x))},{})},Om=(e,t)=>{var r=t.startAngle,n=t.endAngle,o=Math.floor(r/360),i=Math.floor(n/360)
return e+360*Math.min(o,i)},jm=(e,t)=>{var r=((e,t)=>{var r=e.x,n=e.y,o=t.cx,i=t.cy,a=((e,t)=>{var r=e.x,n=e.y,o=t.x,i=t.y
return Math.sqrt(Math.pow(r-o,2)+Math.pow(n-i,2))})({x:r,y:n},{x:o,y:i})
if(a<=0)return{radius:a}
var l=(r-o)/a,c=Math.acos(l)
return n>i&&(c=2*Math.PI-c),{radius:a,angle:bm(c),angleInRadian:c}})({x:e.x,y:e.y},t),n=r.radius,o=r.angle,i=t.innerRadius,a=t.outerRadius
if(n<i||n>a)return!1
if(0===n)return!0
var l,c=(e=>{var t=e.startAngle,r=e.endAngle,n=Math.floor(t/360),o=Math.floor(r/360),i=Math.min(n,o)
return{startAngle:t-360*i,endAngle:r-360*i}})(t),s=c.startAngle,u=c.endAngle,f=o
if(s<=u){for(;f>u;)f-=360
for(;f<s;)f+=360
l=f>=s&&f<=u}else{for(;f>s;)f-=360
for(;f<u;)f+=360
l=f>=u&&f<=s}return l?dm(dm({},t),{},{radius:n,angle:Om(f,t)}):null},Sm=e=>n.isValidElement(e)||Dt(e)||"boolean"==typeof e?"":e.className
function Pm(e){return(Pm="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}var Am=["offset"]
function Em(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function Mm(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function _m(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Mm(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=Pm(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Pm(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==Pm(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Mm(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function Tm(){return Tm=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},Tm.apply(this,arguments)}function km(t){var r,i=t.offset,a=_m({offset:void 0===i?5:i},((e,t)=>{if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o})(t,Am)),l=a.viewBox,c=a.position,s=a.value,u=a.children,f=a.content,p=a.className,h=void 0===p?"":p,d=a.textBreakAll
if(!l||Tt(s)&&Tt(u)&&!n.isValidElement(f)&&!Dt(f))return null
if(n.isValidElement(f))return n.cloneElement(f,a)
if(Dt(f)){if(r=n.createElement(f,a),n.isValidElement(r))return r}else r=(e=>{var t=e.value,r=e.formatter,n=Tt(e.children)?t:e.children
return Dt(r)?r(n):n})(a)
var y=(e=>"cx"in e&&Kt(e.cx))(l),v=Er(a,!0)
if(y&&("insideStart"===c||"insideEnd"===c||"end"===c))return((t,r,n)=>{var i,a,l=t.position,c=t.viewBox,s=t.offset,u=t.className,f=c,p=f.cx,h=f.cy,d=f.innerRadius,y=f.outerRadius,v=f.startAngle,m=f.endAngle,b=f.clockWise,g=(d+y)/2,w=((e,t)=>Yt(t-e)*Math.min(Math.abs(t-e),360))(v,m),x=w>=0?1:-1
"insideStart"===l?(i=v+x*s,a=b):"insideEnd"===l?(i=m-x*s,a=!b):"end"===l&&(i=m+x*s,a=b),a=w<=0?a:!a
var O=gm(p,h,g,i),j=gm(p,h,g,i+359*(a?1:-1)),S="M".concat(O.x,",").concat(O.y,"\n    A").concat(g,",").concat(g,",0,1,").concat(a?0:1,",\n    ").concat(j.x,",").concat(j.y),P=Tt(t.id)?Qt("recharts-radial-line-"):t.id
return o.createElement("text",Tm({},n,{dominantBaseline:"central",className:e("recharts-radial-bar-label",u)}),o.createElement("defs",null,o.createElement("path",{id:P,d:S})),o.createElement("textPath",{xlinkHref:"#".concat(P)},r))})(a,r,v)
var m=y?(e=>{var t=e.viewBox,r=e.offset,n=e.position,o=t,i=o.cx,a=o.cy,l=o.innerRadius,c=o.outerRadius,s=(o.startAngle+o.endAngle)/2
if("outside"===n){var u=gm(i,a,c+r,s),f=u.x
return{x:f,y:u.y,textAnchor:f>=i?"start":"end",verticalAnchor:"middle"}}if("center"===n)return{x:i,y:a,textAnchor:"middle",verticalAnchor:"middle"}
if("centerTop"===n)return{x:i,y:a,textAnchor:"middle",verticalAnchor:"start"}
if("centerBottom"===n)return{x:i,y:a,textAnchor:"middle",verticalAnchor:"end"}
var p=gm(i,a,(l+c)/2,s)
return{x:p.x,y:p.y,textAnchor:"middle",verticalAnchor:"middle"}})(a):(e=>{var t=e.viewBox,r=e.parentViewBox,n=e.offset,o=e.position,i=t,a=i.x,l=i.y,c=i.width,s=i.height,u=s>=0?1:-1,f=u*n,p=u>0?"end":"start",h=u>0?"start":"end",d=c>=0?1:-1,y=d*n,v=d>0?"end":"start",m=d>0?"start":"end"
if("top"===o)return _m(_m({},{x:a+c/2,y:l-u*n,textAnchor:"middle",verticalAnchor:p}),r?{height:Math.max(l-r.y,0),width:c}:{})
if("bottom"===o)return _m(_m({},{x:a+c/2,y:l+s+f,textAnchor:"middle",verticalAnchor:h}),r?{height:Math.max(r.y+r.height-(l+s),0),width:c}:{})
if("left"===o){var b={x:a-y,y:l+s/2,textAnchor:v,verticalAnchor:"middle"}
return _m(_m({},b),r?{width:Math.max(b.x-r.x,0),height:s}:{})}if("right"===o){var g={x:a+c+y,y:l+s/2,textAnchor:m,verticalAnchor:"middle"}
return _m(_m({},g),r?{width:Math.max(r.x+r.width-g.x,0),height:s}:{})}var w=r?{width:c,height:s}:{}
return"insideLeft"===o?_m({x:a+y,y:l+s/2,textAnchor:m,verticalAnchor:"middle"},w):"insideRight"===o?_m({x:a+c-y,y:l+s/2,textAnchor:v,verticalAnchor:"middle"},w):"insideTop"===o?_m({x:a+c/2,y:l+f,textAnchor:"middle",verticalAnchor:h},w):"insideBottom"===o?_m({x:a+c/2,y:l+s-f,textAnchor:"middle",verticalAnchor:p},w):"insideTopLeft"===o?_m({x:a+y,y:l+f,textAnchor:m,verticalAnchor:h},w):"insideTopRight"===o?_m({x:a+c-y,y:l+f,textAnchor:v,verticalAnchor:h},w):"insideBottomLeft"===o?_m({x:a+y,y:l+s-f,textAnchor:m,verticalAnchor:p},w):"insideBottomRight"===o?_m({x:a+c-y,y:l+s-f,textAnchor:v,verticalAnchor:p},w):Nt(o)&&(Kt(o.x)||Gt(o.x))&&(Kt(o.y)||Gt(o.y))?_m({x:a+er(o.x,c),y:l+er(o.y,s),textAnchor:"end",verticalAnchor:"end"},w):_m({x:a+c/2,y:l+s/2,textAnchor:"middle",verticalAnchor:"middle"},w)})(a)
return o.createElement(wu,Tm({className:e("recharts-label",h)},v,m,{breakAll:d}),r)}km.displayName="Label"
var Cm,Im,Dm=e=>{var t=e.cx,r=e.cy,n=e.angle,o=e.startAngle,i=e.endAngle,a=e.r,l=e.radius,c=e.innerRadius,s=e.outerRadius,u=e.x,f=e.y,p=e.top,h=e.left,d=e.width,y=e.height,v=e.clockWise,m=e.labelViewBox
if(m)return m
if(Kt(d)&&Kt(y)){if(Kt(u)&&Kt(f))return{x:u,y:f,width:d,height:y}
if(Kt(p)&&Kt(h))return{x:p,y:h,width:d,height:y}}return Kt(u)&&Kt(f)?{x:u,y:f,width:0,height:0}:Kt(t)&&Kt(r)?{cx:t,cy:r,startAngle:o||n||0,endAngle:i||n||0,innerRadius:c||0,outerRadius:s||l||a||0,clockWise:v}:e.viewBox?e.viewBox:{}}
km.parseViewBox=Dm,km.renderCallByParent=function(e,t){var r=!(arguments.length>2&&void 0!==arguments[2])||arguments[2]
if(!e||!e.children&&r&&!e.label)return null
var i=e.children,a=Dm(e),l=Or(i,km).map((e,r)=>n.cloneElement(e,{viewBox:t||a,key:"label-".concat(r)}))
if(!r)return l
var c,s=((e,t)=>e?!0===e?o.createElement(km,{key:"label-implicit",viewBox:t}):Zt(e)?o.createElement(km,{key:"label-implicit",viewBox:t,value:e}):n.isValidElement(e)?e.type===km?n.cloneElement(e,{key:"label-implicit",viewBox:t}):o.createElement(km,{key:"label-implicit",content:e,viewBox:t}):Dt(e)?o.createElement(km,{key:"label-implicit",content:e,viewBox:t}):Nt(e)?o.createElement(km,Tm({viewBox:t},e,{key:"label-implicit"})):null:null)(e.label,t||a)
return[s].concat((e=>{if(Array.isArray(e))return Em(e)})(c=l)||(e=>{if("undefined"!=typeof Symbol&&null!=e[Symbol.iterator]||null!=e["@@iterator"])return Array.from(e)})(c)||((e,t)=>{if(e){if("string"==typeof e)return Em(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?Em(e,t):void 0}})(c)||(()=>{throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})())}
const Nm=r(Im?Cm:(Im=1,Cm=e=>{var t=null==e?0:e.length
return t?e[t-1]:void 0}))
function Bm(e){return(Bm="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}var Rm=["valueAccessor"],Lm=["data","dataKey","clockWise","id","textBreakAll"]
function Um(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function zm(){return zm=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},zm.apply(this,arguments)}function $m(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Fm(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?$m(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=Bm(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Bm(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==Bm(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):$m(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function qm(e,t){if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o}var Wm=e=>Array.isArray(e.value)?Nm(e.value):e.value
function Xm(e){var t=e.valueAccessor,r=void 0===t?Wm:t,n=qm(e,Rm),i=n.data,a=n.dataKey,l=n.clockWise,c=n.id,s=n.textBreakAll,u=qm(n,Lm)
return i&&i.length?o.createElement(Jr,{className:"recharts-label-list"},i.map((e,t)=>{var n=Tt(a)?r(e,t):$v(e&&e.payload,a),i=Tt(c)?{}:{id:"".concat(c,"-").concat(t)}
return o.createElement(km,zm({},Er(e,!0),u,i,{parentViewBox:e.parentViewBox,value:n,textBreakAll:s,viewBox:km.parseViewBox(Tt(l)?e:Fm(Fm({},e),{},{clockWise:l})),key:"label-".concat(t),index:t}))})):null}function Hm(e){return(Hm="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Vm(){return Vm=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},Vm.apply(this,arguments)}function Ym(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Gm(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Ym(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=Hm(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Hm(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==Hm(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Ym(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}Xm.displayName="LabelList",Xm.renderCallByParent=function(e,t){var r=!(arguments.length>2&&void 0!==arguments[2])||arguments[2]
if(!e||!e.children&&r&&!e.label)return null
var i,a=Or(e.children,Xm).map((e,r)=>n.cloneElement(e,{data:t,key:"labelList-".concat(r)}))
return r?[((e,t)=>e?!0===e?o.createElement(Xm,{key:"labelList-implicit",data:t}):o.isValidElement(e)||Dt(e)?o.createElement(Xm,{key:"labelList-implicit",data:t,content:e}):Nt(e)?o.createElement(Xm,zm({data:t},e,{key:"labelList-implicit"})):null:null)(e.label,t)].concat((e=>{if(Array.isArray(e))return Um(e)})(i=a)||(e=>{if("undefined"!=typeof Symbol&&null!=e[Symbol.iterator]||null!=e["@@iterator"])return Array.from(e)})(i)||((e,t)=>{if(e){if("string"==typeof e)return Um(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?Um(e,t):void 0}})(i)||(()=>{throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()):a}
var Km=e=>{var t=e.cx,r=e.cy,n=e.radius,o=e.angle,i=e.sign,a=e.isExternal,l=e.cornerRadius,c=e.cornerIsExternal,s=l*(a?1:-1)+n,u=Math.asin(l/s)/mm,f=c?o:o+i*u,p=c?o-i*u:o
return{center:gm(t,r,s,f),circleTangency:gm(t,r,n,f),lineTangency:gm(t,r,s*Math.cos(u*mm),p),theta:u}},Zm=e=>{var t=e.cx,r=e.cy,n=e.innerRadius,o=e.outerRadius,i=e.startAngle,a=((e,t)=>Yt(t-e)*Math.min(Math.abs(t-e),359.999))(i,e.endAngle),l=i+a,c=gm(t,r,o,i),s=gm(t,r,o,l),u="M ".concat(c.x,",").concat(c.y,"\n    A ").concat(o,",").concat(o,",0,\n    ").concat(+(Math.abs(a)>180),",").concat(+(i>l),",\n    ").concat(s.x,",").concat(s.y,"\n  ")
if(n>0){var f=gm(t,r,n,i),p=gm(t,r,n,l)
u+="L ".concat(p.x,",").concat(p.y,"\n            A ").concat(n,",").concat(n,",0,\n            ").concat(+(Math.abs(a)>180),",").concat(+(i<=l),",\n            ").concat(f.x,",").concat(f.y," Z")}else u+="L ".concat(t,",").concat(r," Z")
return u},Jm={cx:0,cy:0,innerRadius:0,outerRadius:0,startAngle:0,endAngle:0,cornerRadius:0,forceCornerRadius:!1,cornerIsExternal:!1},Qm=t=>{var r=Gm(Gm({},Jm),t),n=r.cx,i=r.cy,a=r.innerRadius,l=r.outerRadius,c=r.cornerRadius,s=r.forceCornerRadius,u=r.cornerIsExternal,f=r.startAngle,p=r.endAngle,h=r.className
if(l<a||f===p)return null
var d,y=e("recharts-sector",h),v=l-a,m=er(c,v,0,!0)
return d=m>0&&Math.abs(f-p)<360?(e=>{var t=e.cx,r=e.cy,n=e.innerRadius,o=e.outerRadius,i=e.cornerRadius,a=e.forceCornerRadius,l=e.cornerIsExternal,c=e.startAngle,s=e.endAngle,u=Yt(s-c),f=Km({cx:t,cy:r,radius:o,angle:c,sign:u,cornerRadius:i,cornerIsExternal:l}),p=f.circleTangency,h=f.lineTangency,d=f.theta,y=Km({cx:t,cy:r,radius:o,angle:s,sign:-u,cornerRadius:i,cornerIsExternal:l}),v=y.circleTangency,m=y.lineTangency,b=y.theta,g=l?Math.abs(c-s):Math.abs(c-s)-d-b
if(g<0)return a?"M ".concat(h.x,",").concat(h.y,"\n        a").concat(i,",").concat(i,",0,0,1,").concat(2*i,",0\n        a").concat(i,",").concat(i,",0,0,1,").concat(2*-i,",0\n      "):Zm({cx:t,cy:r,innerRadius:n,outerRadius:o,startAngle:c,endAngle:s})
var w="M ".concat(h.x,",").concat(h.y,"\n    A").concat(i,",").concat(i,",0,0,").concat(+(u<0),",").concat(p.x,",").concat(p.y,"\n    A").concat(o,",").concat(o,",0,").concat(+(g>180),",").concat(+(u<0),",").concat(v.x,",").concat(v.y,"\n    A").concat(i,",").concat(i,",0,0,").concat(+(u<0),",").concat(m.x,",").concat(m.y,"\n  ")
if(n>0){var x=Km({cx:t,cy:r,radius:n,angle:c,sign:u,isExternal:!0,cornerRadius:i,cornerIsExternal:l}),O=x.circleTangency,j=x.lineTangency,S=x.theta,P=Km({cx:t,cy:r,radius:n,angle:s,sign:-u,isExternal:!0,cornerRadius:i,cornerIsExternal:l}),A=P.circleTangency,E=P.lineTangency,M=P.theta,_=l?Math.abs(c-s):Math.abs(c-s)-S-M
if(_<0&&0===i)return"".concat(w,"L").concat(t,",").concat(r,"Z")
w+="L".concat(E.x,",").concat(E.y,"\n      A").concat(i,",").concat(i,",0,0,").concat(+(u<0),",").concat(A.x,",").concat(A.y,"\n      A").concat(n,",").concat(n,",0,").concat(+(_>180),",").concat(+(u>0),",").concat(O.x,",").concat(O.y,"\n      A").concat(i,",").concat(i,",0,0,").concat(+(u<0),",").concat(j.x,",").concat(j.y,"Z")}else w+="L".concat(t,",").concat(r,"Z")
return w})({cx:n,cy:i,innerRadius:a,outerRadius:l,cornerRadius:Math.min(m,v/2),forceCornerRadius:s,cornerIsExternal:u,startAngle:f,endAngle:p}):Zm({cx:n,cy:i,innerRadius:a,outerRadius:l,startAngle:f,endAngle:p}),o.createElement("path",Vm({},Er(r,!0),{className:y,d,role:"img"}))}
function eb(e){return(eb="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function tb(){return tb=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},tb.apply(this,arguments)}function rb(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function nb(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?rb(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=eb(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=eb(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==eb(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):rb(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}var ob,ib,ab,lb,cb,sb={curveBasisClosed:e=>new Wn(e),curveBasisOpen:e=>new Xn(e),curveBasis:e=>new qn(e),curveBumpX:e=>new jn(e,!0),curveBumpY:e=>new jn(e,!1),curveLinearClosed:e=>new Hn(e),curveLinear:bn,curveMonotoneX:e=>new Zn(e),curveMonotoneY:e=>new Jn(e),curveNatural:e=>new eo(e),curveStep:e=>new ro(e,.5),curveStepAfter:e=>new ro(e,1),curveStepBefore:e=>new ro(e,0)},ub=e=>e.x===+e.x&&e.y===+e.y,fb=e=>e.x,pb=e=>e.y,hb=t=>{var r=t.className,o=t.points,i=t.path,a=t.pathRef
if(!(o&&o.length||i))return null
var l=o&&o.length?(e=>{var t,r=e.type,n=void 0===r?"linear":r,o=e.points,i=void 0===o?[]:o,a=e.baseLine,l=e.layout,c=e.connectNulls,s=void 0!==c&&c,u=((e,t)=>{if(Dt(e))return e
var r="curve".concat(tn(e))
return"curveMonotone"!==r&&"curveBump"!==r||!t?sb[r]||bn:sb["".concat(r).concat("vertical"===t?"Y":"X")]})(n,l),f=s?i.filter(e=>ub(e)):i
if(Array.isArray(a)){var p=s?a.filter(e=>ub(e)):a,h=f.map((e,t)=>nb(nb({},e),{},{base:p[t]}))
return(t="vertical"===l?On().y(pb).x1(fb).x0(e=>e.base.x):On().x(fb).y1(pb).y0(e=>e.base.y)).defined(ub).curve(u),t(h)}return(t="vertical"===l&&Kt(a)?On().y(pb).x1(fb).x0(a):Kt(a)?On().x(fb).y1(pb).y0(a):xn().x(fb).y(pb)).defined(ub).curve(u),t(f)})(t):i
return n.createElement("path",tb({},Er(t,!1),fr(t),{className:e("recharts-curve",r),d:l,ref:a}))},db={exports:{}}
function yb(){return ib?ob:(ib=1,ob="SECRET_DO_NOT_PASS_THIS_OR_YOU_WILL_BE_FIRED")}function vb(){if(lb)return ab
lb=1
var e=yb()
function t(){}function r(){}return r.resetWarningCache=t,ab=()=>{function n(t,r,n,o,i,a){if(a!==e){var l=new Error("Calling PropTypes validators directly is not supported by the `prop-types` package. Use PropTypes.checkPropTypes() to call them. Read more at http://fb.me/use-check-prop-types")
throw l.name="Invariant Violation",l}}function o(){return n}n.isRequired=n
var i={array:n,bigint:n,bool:n,func:n,number:n,object:n,string:n,symbol:n,any:n,arrayOf:o,element:n,elementType:n,instanceOf:o,node:n,objectOf:o,oneOf:o,oneOfType:o,shape:o,exact:o,checkPropTypes:r,resetWarningCache:t}
return i.PropTypes=i,i}}function mb(){return cb||(cb=1,db.exports=vb()()),db.exports}const bb=r(mb()),{getOwnPropertyNames:gb,getOwnPropertySymbols:wb}=Object,{hasOwnProperty:xb}=Object.prototype
function Ob(e,t){return(r,n,o)=>e(r,n,o)&&t(r,n,o)}function jb(e){return(t,r,n)=>{if(!t||!r||"object"!=typeof t||"object"!=typeof r)return e(t,r,n)
const{cache:o}=n,i=o.get(t),a=o.get(r)
if(i&&a)return i===r&&a===t
o.set(t,r),o.set(r,t)
const l=e(t,r,n)
return o.delete(t),o.delete(r),l}}function Sb(e){return gb(e).concat(wb(e))}const Pb=Object.hasOwn||((e,t)=>xb.call(e,t))
function Ab(e,t){return e===t||!e&&!t&&e!=e&&t!=t}const{getOwnPropertyDescriptor:Eb,keys:Mb}=Object
function _b(e,t){return e.byteLength===t.byteLength&&Fb(new Uint8Array(e),new Uint8Array(t))}function Tb(e,t,r){let n=e.length
if(t.length!==n)return!1
for(;n-- >0;)if(!r.equals(e[n],t[n],n,n,e,t,r))return!1
return!0}function kb(e,t){return e.byteLength===t.byteLength&&Fb(new Uint8Array(e.buffer,e.byteOffset,e.byteLength),new Uint8Array(t.buffer,t.byteOffset,t.byteLength))}function Cb(e,t){return Ab(e.getTime(),t.getTime())}function Ib(e,t){return e.name===t.name&&e.message===t.message&&e.cause===t.cause&&e.stack===t.stack}function Db(e,t){return e===t}function Nb(e,t,r){const n=e.size
if(n!==t.size)return!1
if(!n)return!0
const o=new Array(n),i=e.entries()
let a,l,c=0
for(;(a=i.next())&&!a.done;){const n=t.entries()
let i=!1,s=0
for(;(l=n.next())&&!l.done;){if(o[s]){s++
continue}const n=a.value,u=l.value
if(r.equals(n[0],u[0],c,s,e,t,r)&&r.equals(n[1],u[1],n[0],u[0],e,t,r)){i=o[s]=!0
break}s++}if(!i)return!1
c++}return!0}const Bb=Ab
function Rb(e,t,r){const n=Mb(e)
let o=n.length
if(Mb(t).length!==o)return!1
for(;o-- >0;)if(!Wb(e,t,r,n[o]))return!1
return!0}function Lb(e,t,r){const n=Sb(e)
let o,i,a,l=n.length
if(Sb(t).length!==l)return!1
for(;l-- >0;){if(o=n[l],!Wb(e,t,r,o))return!1
if(i=Eb(e,o),a=Eb(t,o),(i||a)&&(!i||!a||i.configurable!==a.configurable||i.enumerable!==a.enumerable||i.writable!==a.writable))return!1}return!0}function Ub(e,t){return Ab(e.valueOf(),t.valueOf())}function zb(e,t){return e.source===t.source&&e.flags===t.flags}function $b(e,t,r){const n=e.size
if(n!==t.size)return!1
if(!n)return!0
const o=new Array(n),i=e.values()
let a,l
for(;(a=i.next())&&!a.done;){const n=t.values()
let i=!1,c=0
for(;(l=n.next())&&!l.done;){if(!o[c]&&r.equals(a.value,l.value,a.value,l.value,e,t,r)){i=o[c]=!0
break}c++}if(!i)return!1}return!0}function Fb(e,t){let r=e.byteLength
if(t.byteLength!==r||e.byteOffset!==t.byteOffset)return!1
for(;r-- >0;)if(e[r]!==t[r])return!1
return!0}function qb(e,t){return e.hostname===t.hostname&&e.pathname===t.pathname&&e.protocol===t.protocol&&e.port===t.port&&e.hash===t.hash&&e.username===t.username&&e.password===t.password}function Wb(e,t,r,n){return!("_owner"!==n&&"__o"!==n&&"__v"!==n||!e.$$typeof&&!t.$$typeof)||Pb(t,n)&&r.equals(e[n],t[n],n,n,e,t,r)}const Xb={"[object Int8Array]":!0,"[object Uint8Array]":!0,"[object Uint8ClampedArray]":!0,"[object Int16Array]":!0,"[object Uint16Array]":!0,"[object Int32Array]":!0,"[object Uint32Array]":!0,"[object Float16Array]":!0,"[object Float32Array]":!0,"[object Float64Array]":!0,"[object BigInt64Array]":!0,"[object BigUint64Array]":!0},Hb=Object.prototype.toString,Vb=Yb()
function Yb(e={}){const{circular:t=!1,createInternalComparator:r,createState:n,strict:o=!1}=e,i=(({circular:e,createCustomConfig:t,strict:r})=>{let n={areArrayBuffersEqual:_b,areArraysEqual:r?Lb:Tb,areDataViewsEqual:kb,areDatesEqual:Cb,areErrorsEqual:Ib,areFunctionsEqual:Db,areMapsEqual:r?Ob(Nb,Lb):Nb,areNumbersEqual:Bb,areObjectsEqual:r?Lb:Rb,arePrimitiveWrappersEqual:Ub,areRegExpsEqual:zb,areSetsEqual:r?Ob($b,Lb):$b,areTypedArraysEqual:r?Ob(Fb,Lb):Fb,areUrlsEqual:qb,unknownTagComparators:void 0}
if(t&&(n=Object.assign({},n,t(n))),e){const e=jb(n.areArraysEqual),t=jb(n.areMapsEqual),r=jb(n.areObjectsEqual),o=jb(n.areSetsEqual)
n=Object.assign({},n,{areArraysEqual:e,areMapsEqual:t,areObjectsEqual:r,areSetsEqual:o})}return n})(e),a=(({areArrayBuffersEqual:e,areArraysEqual:t,areDataViewsEqual:r,areDatesEqual:n,areErrorsEqual:o,areFunctionsEqual:i,areMapsEqual:a,areNumbersEqual:l,areObjectsEqual:c,arePrimitiveWrappersEqual:s,areRegExpsEqual:u,areSetsEqual:f,areTypedArraysEqual:p,areUrlsEqual:h,unknownTagComparators:d})=>(y,v,m)=>{if(y===v)return!0
if(null==y||null==v)return!1
const b=typeof y
if(b!==typeof v)return!1
if("object"!==b)return"number"===b?l(y,v,m):"function"===b&&i(y,v,m)
const g=y.constructor
if(g!==v.constructor)return!1
if(g===Object)return c(y,v,m)
if(Array.isArray(y))return t(y,v,m)
if(g===Date)return n(y,v,m)
if(g===RegExp)return u(y,v,m)
if(g===Map)return a(y,v,m)
if(g===Set)return f(y,v,m)
const w=Hb.call(y)
if("[object Date]"===w)return n(y,v,m)
if("[object RegExp]"===w)return u(y,v,m)
if("[object Map]"===w)return a(y,v,m)
if("[object Set]"===w)return f(y,v,m)
if("[object Object]"===w)return"function"!=typeof y.then&&"function"!=typeof v.then&&c(y,v,m)
if("[object URL]"===w)return h(y,v,m)
if("[object Error]"===w)return o(y,v,m)
if("[object Arguments]"===w)return c(y,v,m)
if(Xb[w])return p(y,v,m)
if("[object ArrayBuffer]"===w)return e(y,v,m)
if("[object DataView]"===w)return r(y,v,m)
if("[object Boolean]"===w||"[object Number]"===w||"[object String]"===w)return s(y,v,m)
if(d){let e=d[w]
if(!e){const t=null!=(x=y)?x[Symbol.toStringTag]:void 0
t&&(e=d[t])}if(e)return e(y,v,m)}var x
return!1})(i)
var l
return(({circular:e,comparator:t,createState:r,equals:n,strict:o})=>{if(r)return(i,a)=>{const{cache:l=(e?new WeakMap:void 0),meta:c}=r()
return t(i,a,{cache:l,equals:n,meta:c,strict:o})}
if(e)return(e,r)=>t(e,r,{cache:new WeakMap,equals:n,meta:void 0,strict:o})
const i={cache:void 0,equals:n,meta:void 0,strict:o}
return(e,r)=>t(e,r,i)})({circular:t,comparator:a,createState:n,equals:r?r(a):(l=a,(e,t,r,n,o,i,a)=>l(e,t,a)),strict:o})}function Gb(e){var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:0,r=-1
requestAnimationFrame(function n(o){r<0&&(r=o),o-r>t?(e(o),r=-1):(e=>{"undefined"!=typeof requestAnimationFrame&&requestAnimationFrame(e)})(n)})}function Kb(e){return(Kb="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Zb(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function Jb(){var e=()=>null,t=!1,r=function r(n){if(!t){if(Array.isArray(n)){if(!n.length)return
var o=(e=>{if(Array.isArray(e))return e})(l=n)||(e=>{if("undefined"!=typeof Symbol&&null!=e[Symbol.iterator]||null!=e["@@iterator"])return Array.from(e)})(l)||((e,t)=>{if(e){if("string"==typeof e)return Zb(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?Zb(e,t):void 0}})(l)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})(),i=o[0],a=o.slice(1)
return"number"==typeof i?void Gb(r.bind(null,a),i):(r(i),void Gb(r.bind(null,a)))}"object"===Kb(n)&&e(n),"function"==typeof n&&n()}var l}
return{stop:()=>{t=!0},start:e=>{t=!1,r(e)},subscribe:t=>(e=t,()=>{e=()=>null})}}function Qb(e){return(Qb="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function eg(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function tg(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?eg(Object(r),!0).forEach(t=>{rg(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):eg(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function rg(e,t,r){return(t=(e=>{var t=(e=>{if("object"!==Qb(e)||null===e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!==Qb(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"===Qb(t)?t:String(t)})(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}Yb({strict:!0}),Yb({circular:!0}),Yb({circular:!0,strict:!0}),Yb({createInternalComparator:()=>Ab}),Yb({strict:!0,createInternalComparator:()=>Ab}),Yb({circular:!0,createInternalComparator:()=>Ab}),Yb({circular:!0,createInternalComparator:()=>Ab,strict:!0})
var ng=e=>e,og=(e,t)=>Object.keys(t).reduce((r,n)=>tg(tg({},r),{},rg({},n,e(n,t[n]))),{}),ig=(e,t,r)=>e.map(e=>{return"".concat((n=e,n.replace(/([A-Z])/g,e=>"-".concat(e.toLowerCase())))," ").concat(t,"ms ").concat(r)
var n}).join(",")
function ag(e,t){if(e){if("string"==typeof e)return lg(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?lg(e,t):void 0}}function lg(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}var cg=1e-4,sg=(e,t)=>[0,3*e,3*t-6*e,3*e-3*t+1],ug=(e,t)=>e.map((e,r)=>e*Math.pow(t,r)).reduce((e,t)=>e+t),fg=(e,t)=>r=>{var n=sg(e,t)
return ug(n,r)},pg=function(){for(var e=arguments.length,t=new Array(e),r=0;r<e;r++)t[r]=arguments[r]
var n,o=t[0],i=t[1],a=t[2],l=t[3]
if(1===t.length)switch(t[0]){case"linear":o=0,i=0,a=1,l=1
break
case"ease":o=.25,i=.1,a=.25,l=1
break
case"ease-in":o=.42,i=0,a=1,l=1
break
case"ease-out":o=.42,i=0,a=.58,l=1
break
case"ease-in-out":o=0,i=0,a=.58,l=1
break
default:var c=t[0].split("(")
if("cubic-bezier"===c[0]&&4===c[1].split(")")[0].split(",").length){var s=(e=>{if(Array.isArray(e))return e})(n=c[1].split(")")[0].split(",").map(e=>parseFloat(e)))||(e=>{var t=null==e?null:"undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"]
if(null!=t){var r,n,o,i,a=[],l=!0,c=!1
try{for(o=(t=t.call(e)).next;!(l=(r=o.call(t)).done)&&(a.push(r.value),4!==a.length);l=!0);}catch(s){c=!0,n=s}finally{try{if(!l&&null!=t.return&&(i=t.return(),Object(i)!==i))return}finally{if(c)throw n}}return a}})(n)||ag(n,4)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()
o=s[0],i=s[1],a=s[2],l=s[3]}}var u,f,p=fg(o,a),h=fg(i,l),d=(u=o,f=a,e=>{var t=sg(u,f),r=[].concat((e=>(e=>{if(Array.isArray(e))return lg(e)})(e)||(e=>{if("undefined"!=typeof Symbol&&null!=e[Symbol.iterator]||null!=e["@@iterator"])return Array.from(e)})(e)||ag(e)||(()=>{throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})())(t.map((e,t)=>e*t).slice(1)),[0])
return ug(r,e)}),y=e=>e>1?1:e<0?0:e,v=e=>{for(var t=e>1?1:e,r=t,n=0;n<8;++n){var o=p(r)-t,i=d(r)
if(Math.abs(o-t)<cg||i<cg)return h(r)
r=y(r-o/i)}return h(r)}
return v.isStepper=!1,v}
function hg(e){return(hg="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function dg(e){return(e=>{if(Array.isArray(e))return gg(e)})(e)||(e=>{if("undefined"!=typeof Symbol&&null!=e[Symbol.iterator]||null!=e["@@iterator"])return Array.from(e)})(e)||bg(e)||(()=>{throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()}function yg(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function vg(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?yg(Object(r),!0).forEach(t=>{mg(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):yg(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function mg(e,t,r){return(t=(e=>{var t=(e=>{if("object"!==hg(e)||null===e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!==hg(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"===hg(t)?t:String(t)})(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function bg(e,t){if(e){if("string"==typeof e)return gg(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?gg(e,t):void 0}}function gg(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}var wg=(e,t,r)=>e+(t-e)*r,xg=e=>e.from!==e.to,Og=function e(t,r,n){var o=og((e,r)=>{if(xg(r)){var n=(e=>{if(Array.isArray(e))return e})(a=t(r.from,r.to,r.velocity))||(e=>{var t=null==e?null:"undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"]
if(null!=t){var r,n,o,i,a=[],l=!0,c=!1
try{for(o=(t=t.call(e)).next;!(l=(r=o.call(t)).done)&&(a.push(r.value),2!==a.length);l=!0);}catch(s){c=!0,n=s}finally{try{if(!l&&null!=t.return&&(i=t.return(),Object(i)!==i))return}finally{if(c)throw n}}return a}})(a)||bg(a,2)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})(),o=n[0],i=n[1]
return vg(vg({},r),{},{from:o,velocity:i})}var a
return r},r)
return n<1?og((e,t)=>xg(t)?vg(vg({},t),{},{velocity:wg(t.velocity,o[e].velocity,n),from:wg(t.from,o[e].from,n)}):t,r):e(t,o,n-1)}
function jg(e){return(jg="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}var Sg=["children","begin","duration","attributeName","easing","isActive","steps","from","to","canBegin","onAnimationEnd","shouldReAnimate","onAnimationReStart"]
function Pg(e){return(e=>{if(Array.isArray(e))return Ag(e)})(e)||(e=>{if("undefined"!=typeof Symbol&&null!=e[Symbol.iterator]||null!=e["@@iterator"])return Array.from(e)})(e)||((e,t)=>{if(e){if("string"==typeof e)return Ag(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?Ag(e,t):void 0}})(e)||(()=>{throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()}function Ag(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function Eg(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Mg(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Eg(Object(r),!0).forEach(t=>{_g(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Eg(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function _g(e,t,r){return(t=Tg(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function Tg(e){var t=(e=>{if("object"!==jg(e)||null===e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!==jg(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"===jg(t)?t:String(t)}function kg(e,t){return(kg=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function Cg(e,t){if(t&&("object"===jg(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return Ig(e)}function Ig(e){if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e}function Dg(e){return(Dg=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}var Ng=function(){((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&kg(e,t)})(l,n.PureComponent)
var e,t,r,i,a=(e=l,t=(()=>{if("undefined"==typeof Reflect||!Reflect.construct)return!1
if(Reflect.construct.sham)return!1
if("function"==typeof Proxy)return!0
try{return Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{})),!0}catch(e){return!1}})(),function(){var r,n=Dg(e)
if(t){var o=Dg(this).constructor
r=Reflect.construct(n,arguments,o)}else r=n.apply(this,arguments)
return Cg(this,r)})
function l(e,t){var r;((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,l)
var n=(r=a.call(this,e,t)).props,o=n.isActive,i=n.attributeName,c=n.from,s=n.to,u=n.steps,f=n.children,p=n.duration
if(r.handleStyleChange=r.handleStyleChange.bind(Ig(r)),r.changeStyle=r.changeStyle.bind(Ig(r)),!o||p<=0)return r.state={style:{}},"function"==typeof f&&(r.state={style:s}),Cg(r)
if(u&&u.length)r.state={style:u[0].style}
else if(c){if("function"==typeof f)return r.state={style:c},Cg(r)
r.state={style:i?_g({},i,c):c}}else r.state={style:{}}
return r}return r=l,i=[{key:"componentDidMount",value:function(){var e=this.props,t=e.isActive,r=e.canBegin
this.mounted=!0,t&&r&&this.runAnimation(this.props)}},{key:"componentDidUpdate",value:function(e){var t=this.props,r=t.isActive,n=t.canBegin,o=t.attributeName,i=t.shouldReAnimate,a=t.to,l=t.from,c=this.state.style
if(n)if(r){if(!(Vb(e.to,a)&&e.canBegin&&e.isActive)){var s=!e.canBegin||!e.isActive
this.manager&&this.manager.stop(),this.stopJSAnimation&&this.stopJSAnimation()
var u=s||i?l:e.to
if(this.state&&c){var f={style:o?_g({},o,u):u};(o&&c[o]!==u||!o&&c!==u)&&this.setState(f)}this.runAnimation(Mg(Mg({},this.props),{},{from:u,begin:0}))}}else{var p={style:o?_g({},o,a):a}
this.state&&c&&(o&&c[o]!==a||!o&&c!==a)&&this.setState(p)}}},{key:"componentWillUnmount",value:function(){this.mounted=!1
var e=this.props.onAnimationEnd
this.unSubscribe&&this.unSubscribe(),this.manager&&(this.manager.stop(),this.manager=null),this.stopJSAnimation&&this.stopJSAnimation(),e&&e()}},{key:"handleStyleChange",value:function(e){this.changeStyle(e)}},{key:"changeStyle",value:function(e){this.mounted&&this.setState({style:e})}},{key:"runJSAnimation",value:function(e){var t=this,r=e.from,n=e.to,o=e.duration,i=e.easing,a=e.begin,l=e.onAnimationEnd,c=e.onAnimationStart,s=((e,t,r,n,o)=>{var i,a,l,c,s=(i=e,a=t,[Object.keys(i),Object.keys(a)].reduce((e,t)=>e.filter(e=>t.includes(e)))),u=s.reduce((r,n)=>vg(vg({},r),{},mg({},n,[e[n],t[n]])),{}),f=s.reduce((r,n)=>vg(vg({},r),{},mg({},n,{from:e[n],velocity:0,to:t[n]})),{}),p=-1,h=()=>null
return h=r.isStepper?n=>{l||(l=n)
var i=(n-l)/r.dt
f=Og(r,f,i),o(vg(vg(vg({},e),t),og((e,t)=>t.from,f))),l=n,Object.values(f).filter(xg).length&&(p=requestAnimationFrame(h))}:i=>{c||(c=i)
var a=(i-c)/n,l=og((e,t)=>wg.apply(void 0,dg(t).concat([r(a)])),u)
if(o(vg(vg(vg({},e),t),l)),a<1)p=requestAnimationFrame(h)
else{var s=og((e,t)=>wg.apply(void 0,dg(t).concat([r(1)])),u)
o(vg(vg(vg({},e),t),s))}},()=>(requestAnimationFrame(h),()=>{cancelAnimationFrame(p)})})(r,n,function(){for(var e=arguments.length,t=new Array(e),r=0;r<e;r++)t[r]=arguments[r]
var n=t[0]
if("string"==typeof n)switch(n){case"ease":case"ease-in-out":case"ease-out":case"ease-in":case"linear":return pg(n)
case"spring":return function(){var e=arguments.length>0&&void 0!==arguments[0]?arguments[0]:{},t=e.stiff,r=void 0===t?100:t,n=e.damping,o=void 0===n?8:n,i=e.dt,a=void 0===i?17:i,l=(e,t,n)=>{var i=n+(-(e-t)*r-n*o)*a/1e3,l=n*a/1e3+e
return Math.abs(l-t)<cg&&Math.abs(i)<cg?[t,0]:[l,i]}
return l.isStepper=!0,l.dt=a,l}()
default:if("cubic-bezier"===n.split("(")[0])return pg(n)}return"function"==typeof n?n:null}(i),o,this.changeStyle)
this.manager.start([c,a,()=>{t.stopJSAnimation=s()},o,l])}},{key:"runStepAnimation",value:function(e){var t=this,r=e.steps,n=e.begin,o=e.onAnimationStart,i=r[0],a=i.style,l=i.duration,c=void 0===l?0:l
return this.manager.start([o].concat(Pg(r.reduce((e,n,o)=>{if(0===o)return e
var i=n.duration,a=n.easing,l=void 0===a?"ease":a,c=n.style,s=n.properties,u=n.onAnimationEnd,f=o>0?r[o-1]:n,p=s||Object.keys(c)
if("function"==typeof l||"spring"===l)return[].concat(Pg(e),[t.runJSAnimation.bind(t,{from:f.style,to:c,duration:i,easing:l}),i])
var h=ig(p,i,l),d=Mg(Mg(Mg({},f.style),c),{},{transition:h})
return[].concat(Pg(e),[d,i,u]).filter(ng)},[a,Math.max(c,n)])),[e.onAnimationEnd]))}},{key:"runAnimation",value:function(e){this.manager||(this.manager=Jb())
var t=e.begin,r=e.duration,n=e.attributeName,o=e.to,i=e.easing,a=e.onAnimationStart,l=e.onAnimationEnd,c=e.steps,s=e.children,u=this.manager
if(this.unSubscribe=u.subscribe(this.handleStyleChange),"function"!=typeof i&&"function"!=typeof s&&"spring"!==i)if(c.length>1)this.runStepAnimation(e)
else{var f=n?_g({},n,o):o,p=ig(Object.keys(f),r,i)
u.start([a,t,Mg(Mg({},f),{},{transition:p}),r,l])}else this.runJSAnimation(e)}},{key:"render",value:function(){var e=this.props,t=e.children
e.begin
var r=e.duration
e.attributeName,e.easing
var i=e.isActive
e.steps,e.from,e.to,e.canBegin,e.onAnimationEnd,e.shouldReAnimate,e.onAnimationReStart
var a=((e,t)=>{if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r,n,o={},i=Object.keys(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||(o[r]=e[r])
return o})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o})(e,Sg),l=n.Children.count(t),c=this.state.style
if("function"==typeof t)return t(c)
if(!i||0===l||r<=0)return t
var s=e=>{var t=e.props,r=t.style,o=void 0===r?{}:r,i=t.className
return n.cloneElement(e,Mg(Mg({},a),{},{style:Mg(Mg({},o),c),className:i}))}
return 1===l?s(n.Children.only(t)):o.createElement("div",null,n.Children.map(t,e=>s(e)))}}],i&&((e,t)=>{for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,Tg(n.key),n)}})(r.prototype,i),Object.defineProperty(r,"prototype",{writable:!1}),l}()
function Bg(e){return(Bg="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Rg(){return Rg=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},Rg.apply(this,arguments)}function Lg(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function Ug(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function zg(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Ug(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=Bg(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Bg(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==Bg(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Ug(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}Ng.displayName="Animate",Ng.defaultProps={begin:0,duration:1e3,from:"",to:"",attributeName:"",easing:"ease",isActive:!0,canBegin:!0,steps:[],onAnimationEnd:()=>{},onAnimationStart:()=>{}},Ng.propTypes={from:bb.oneOfType([bb.object,bb.string]),to:bb.oneOfType([bb.object,bb.string]),attributeName:bb.string,duration:bb.number,begin:bb.number,easing:bb.oneOfType([bb.string,bb.func]),steps:bb.arrayOf(bb.shape({duration:bb.number.isRequired,style:bb.object.isRequired,easing:bb.oneOfType([bb.oneOf(["ease","ease-in","ease-out","ease-in-out","linear"]),bb.func]),properties:bb.arrayOf("string"),onAnimationEnd:bb.func})),children:bb.oneOfType([bb.node,bb.func]),isActive:bb.bool,canBegin:bb.bool,onAnimationEnd:bb.func,shouldReAnimate:bb.bool,onAnimationStart:bb.func,onAnimationReStart:bb.func}
var $g=(e,t,r,n,o)=>{var i,a=Math.min(Math.abs(r)/2,Math.abs(n)/2),l=n>=0?1:-1,c=r>=0?1:-1,s=n>=0&&r>=0||n<0&&r<0?1:0
if(a>0&&o instanceof Array){for(var u=[0,0,0,0],f=0;f<4;f++)u[f]=o[f]>a?a:o[f]
i="M".concat(e,",").concat(t+l*u[0]),u[0]>0&&(i+="A ".concat(u[0],",").concat(u[0],",0,0,").concat(s,",").concat(e+c*u[0],",").concat(t)),i+="L ".concat(e+r-c*u[1],",").concat(t),u[1]>0&&(i+="A ".concat(u[1],",").concat(u[1],",0,0,").concat(s,",\n        ").concat(e+r,",").concat(t+l*u[1])),i+="L ".concat(e+r,",").concat(t+n-l*u[2]),u[2]>0&&(i+="A ".concat(u[2],",").concat(u[2],",0,0,").concat(s,",\n        ").concat(e+r-c*u[2],",").concat(t+n)),i+="L ".concat(e+c*u[3],",").concat(t+n),u[3]>0&&(i+="A ".concat(u[3],",").concat(u[3],",0,0,").concat(s,",\n        ").concat(e,",").concat(t+n-l*u[3])),i+="Z"}else if(a>0&&o===+o&&o>0){var p=Math.min(a,o)
i="M ".concat(e,",").concat(t+l*p,"\n            A ").concat(p,",").concat(p,",0,0,").concat(s,",").concat(e+c*p,",").concat(t,"\n            L ").concat(e+r-c*p,",").concat(t,"\n            A ").concat(p,",").concat(p,",0,0,").concat(s,",").concat(e+r,",").concat(t+l*p,"\n            L ").concat(e+r,",").concat(t+n-l*p,"\n            A ").concat(p,",").concat(p,",0,0,").concat(s,",").concat(e+r-c*p,",").concat(t+n,"\n            L ").concat(e+c*p,",").concat(t+n,"\n            A ").concat(p,",").concat(p,",0,0,").concat(s,",").concat(e,",").concat(t+n-l*p," Z")}else i="M ".concat(e,",").concat(t," h ").concat(r," v ").concat(n," h ").concat(-r," Z")
return i},Fg=(e,t)=>{if(!e||!t)return!1
var r=e.x,n=e.y,o=t.x,i=t.y,a=t.width,l=t.height
if(Math.abs(a)>0&&Math.abs(l)>0){var c=Math.min(o,o+a),s=Math.max(o,o+a),u=Math.min(i,i+l),f=Math.max(i,i+l)
return r>=c&&r<=s&&n>=u&&n<=f}return!1},qg={x:0,y:0,width:0,height:0,radius:0,isAnimationActive:!1,isUpdateAnimationActive:!1,animationBegin:0,animationDuration:1500,animationEasing:"ease"},Wg=t=>{var r,i=zg(zg({},qg),t),a=n.useRef(),l=(e=>{if(Array.isArray(e))return e})(r=n.useState(-1))||(e=>{var t=null==e?null:"undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"]
if(null!=t){var r,n,o,i,a=[],l=!0,c=!1
try{for(o=(t=t.call(e)).next;!(l=(r=o.call(t)).done)&&(a.push(r.value),2!==a.length);l=!0);}catch(s){c=!0,n=s}finally{try{if(!l&&null!=t.return&&(i=t.return(),Object(i)!==i))return}finally{if(c)throw n}}return a}})(r)||(e=>{if(e){if("string"==typeof e)return Lg(e,2)
var t=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===t&&e.constructor&&(t=e.constructor.name),"Map"===t||"Set"===t?Array.from(e):"Arguments"===t||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t)?Lg(e,2):void 0}})(r)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})(),c=l[0],s=l[1]
n.useEffect(()=>{if(a.current&&a.current.getTotalLength)try{var e=a.current.getTotalLength()
e&&s(e)}catch(t){}},[])
var u=i.x,f=i.y,p=i.width,h=i.height,d=i.radius,y=i.className,v=i.animationEasing,m=i.animationDuration,b=i.animationBegin,g=i.isAnimationActive,w=i.isUpdateAnimationActive
if(u!==+u||f!==+f||p!==+p||h!==+h||0===p||0===h)return null
var x=e("recharts-rectangle",y)
return w?o.createElement(Ng,{canBegin:c>0,from:{width:p,height:h,x:u,y:f},to:{width:p,height:h,x:u,y:f},duration:m,animationEasing:v,isActive:w},e=>{var t=e.width,r=e.height,n=e.x,l=e.y
return o.createElement(Ng,{canBegin:c>0,from:"0px ".concat(-1===c?1:c,"px"),to:"".concat(c,"px 0px"),attributeName:"strokeDasharray",begin:b,duration:m,isActive:g,easing:v},o.createElement("path",Rg({},Er(i,!0),{className:x,d:$g(n,l,t,r,d),ref:a})))}):o.createElement("path",Rg({},Er(i,!0),{className:x,d:$g(u,f,p,h,d)}))}
function Xg(){return Xg=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},Xg.apply(this,arguments)}var Hg=t=>{var r=t.cx,o=t.cy,i=t.r,a=t.className,l=e("recharts-dot",a)
return r===+r&&o===+o&&i===+i?n.createElement("circle",Xg({},Er(t,!1),fr(t),{className:l,cx:r,cy:o,r:i})):null}
function Vg(e){return(Vg="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}var Yg=["x","y","top","left","width","height","className"]
function Gg(){return Gg=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},Gg.apply(this,arguments)}function Kg(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}var Zg,Jg,Qg,ew,tw=(e,t,r,n,o,i)=>"M".concat(e,",").concat(o,"v").concat(n,"M").concat(i,",").concat(t,"h").concat(r),rw=t=>{var r=t.x,n=void 0===r?0:r,i=t.y,a=void 0===i?0:i,l=t.top,c=void 0===l?0:l,s=t.left,u=void 0===s?0:s,f=t.width,p=void 0===f?0:f,h=t.height,d=void 0===h?0:h,y=t.className,v=function(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Kg(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=Vg(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Vg(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==Vg(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Kg(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}({x:n,y:a,top:c,left:u,width:p,height:d},((e,t)=>{if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o})(t,Yg))
return Kt(n)&&Kt(a)&&Kt(p)&&Kt(d)&&Kt(c)&&Kt(u)?o.createElement("path",Gg({},Er(v,!0),{className:e("recharts-cross",y),d:tw(n,a,p,d,c,u)})):null}
const nw=r((()=>{if(ew)return Qg
ew=1
var e=it(),t=(()=>{if(Jg)return Zg
Jg=1
var e=xl()(Object.getPrototypeOf,Object)
return Zg=e})(),r=at(),n=Function.prototype,o=Object.prototype,i=n.toString,a=o.hasOwnProperty,l=i.call(Object)
return Qg=n=>{if(!r(n)||"[object Object]"!=e(n))return!1
var o=t(n)
if(null===o)return!0
var c=a.call(o,"constructor")&&o.constructor
return"function"==typeof c&&c instanceof c&&i.call(c)==l}})())
var ow,iw
const aw=r((()=>{if(iw)return ow
iw=1
var e=it(),t=at()
return ow=r=>!0===r||!1===r||t(r)&&"[object Boolean]"==e(r)})())
function lw(e){return(lw="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function cw(){return cw=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},cw.apply(this,arguments)}function sw(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function uw(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function fw(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?uw(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=lw(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=lw(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==lw(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):uw(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}var pw,hw,dw,yw,vw,mw,bw,gw,ww=(e,t,r,n,o)=>{var i,a=r-n
return i="M ".concat(e,",").concat(t),i+="L ".concat(e+r,",").concat(t),i+="L ".concat(e+r-a/2,",").concat(t+o),(i+="L ".concat(e+r-a/2-n,",").concat(t+o))+"L ".concat(e,",").concat(t," Z")},xw={x:0,y:0,upperWidth:0,lowerWidth:0,height:0,isUpdateAnimationActive:!1,animationBegin:0,animationDuration:1500,animationEasing:"ease"},Ow=t=>{var r,i=fw(fw({},xw),t),a=n.useRef(),l=(e=>{if(Array.isArray(e))return e})(r=n.useState(-1))||(e=>{var t=null==e?null:"undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"]
if(null!=t){var r,n,o,i,a=[],l=!0,c=!1
try{for(o=(t=t.call(e)).next;!(l=(r=o.call(t)).done)&&(a.push(r.value),2!==a.length);l=!0);}catch(s){c=!0,n=s}finally{try{if(!l&&null!=t.return&&(i=t.return(),Object(i)!==i))return}finally{if(c)throw n}}return a}})(r)||(e=>{if(e){if("string"==typeof e)return sw(e,2)
var t=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===t&&e.constructor&&(t=e.constructor.name),"Map"===t||"Set"===t?Array.from(e):"Arguments"===t||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t)?sw(e,2):void 0}})(r)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})(),c=l[0],s=l[1]
n.useEffect(()=>{if(a.current&&a.current.getTotalLength)try{var e=a.current.getTotalLength()
e&&s(e)}catch(t){}},[])
var u=i.x,f=i.y,p=i.upperWidth,h=i.lowerWidth,d=i.height,y=i.className,v=i.animationEasing,m=i.animationDuration,b=i.animationBegin,g=i.isUpdateAnimationActive
if(u!==+u||f!==+f||p!==+p||h!==+h||d!==+d||0===p&&0===h||0===d)return null
var w=e("recharts-trapezoid",y)
return g?o.createElement(Ng,{canBegin:c>0,from:{upperWidth:0,lowerWidth:0,height:d,x:u,y:f},to:{upperWidth:p,lowerWidth:h,height:d,x:u,y:f},duration:m,animationEasing:v,isActive:g},e=>{var t=e.upperWidth,r=e.lowerWidth,n=e.height,l=e.x,s=e.y
return o.createElement(Ng,{canBegin:c>0,from:"0px ".concat(-1===c?1:c,"px"),to:"".concat(c,"px 0px"),attributeName:"strokeDasharray",begin:b,duration:m,easing:v},o.createElement("path",cw({},Er(i,!0),{className:w,d:ww(l,s,t,r,n),ref:a})))}):o.createElement("g",null,o.createElement("path",cw({},Er(i,!0),{className:w,d:ww(u,f,p,h,d)})))},jw=["option","shapeType","propTransformer","activeClassName","isActive"]
function Sw(e){return(Sw="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Pw(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Aw(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Pw(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=Sw(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Sw(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==Sw(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Pw(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function Ew(e,t){return Aw(Aw({},t),e)}function Mw(e){var t=e.shapeType,r=e.elementProps
switch(t){case"rectangle":return o.createElement(Wg,r)
case"trapezoid":return o.createElement(Ow,r)
case"sector":return o.createElement(Qm,r)
case"symbols":if((e=>"symbols"===e)(t))return o.createElement(yo,r)
break
default:return null}}function _w(e){var t,r=e.option,i=e.shapeType,a=e.propTransformer,l=void 0===a?Ew:a,c=e.activeClassName,s=void 0===c?"recharts-active-shape":c,u=e.isActive,f=((e,t)=>{if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o})(e,jw)
if(n.isValidElement(r))t=n.cloneElement(r,Aw(Aw({},f),(e=>n.isValidElement(e)?e.props:e)(r)))
else if(Dt(r))t=r(f)
else if(nw(r)&&!aw(r)){var p=l(r,f)
t=o.createElement(Mw,{shapeType:i,elementProps:p})}else{var h=f
t=o.createElement(Mw,{shapeType:i,elementProps:h})}return u?o.createElement(Jr,{className:s},t):t}function Tw(e,t){return null!=t&&"trapezoids"in e.props}function kw(e,t){return null!=t&&"sectors"in e.props}function Cw(e,t){return null!=t&&"points"in e.props}function Iw(e,t){var r,n,o=e.x===(null==t||null===(r=t.labelViewBox)||void 0===r?void 0:r.x)||e.x===t.x,i=e.y===(null==t||null===(n=t.labelViewBox)||void 0===n?void 0:n.y)||e.y===t.y
return o&&i}function Dw(e,t){var r=e.endAngle===t.endAngle,n=e.startAngle===t.startAngle
return r&&n}function Nw(e,t){var r=e.x===t.x,n=e.y===t.y,o=e.z===t.z
return r&&n&&o}function Bw(e){var t=e.activeTooltipItem,r=e.graphicalItem,n=e.itemData,o=((e,t)=>{var r
return Tw(e,t)?r="trapezoids":kw(e,t)?r="sectors":Cw(e,t)&&(r="points"),r})(r,t),i=((e,t)=>{var r,n
return Tw(e,t)?null===(r=t.tooltipPayload)||void 0===r||null===(r=r[0])||void 0===r||null===(r=r.payload)||void 0===r?void 0:r.payload:kw(e,t)?null===(n=t.tooltipPayload)||void 0===n||null===(n=n[0])||void 0===n||null===(n=n.payload)||void 0===n?void 0:n.payload:Cw(e,t)?t.payload:{}})(r,t),a=n.filter((e,n)=>{var a=Oy(i,e),l=r.props[o].filter(e=>{var n=((e,t)=>{var r
return Tw(e,t)?r=Iw:kw(e,t)?r=Dw:Cw(e,t)&&(r=Nw),r})(r,t)
return n(e,t)}),c=r.props[o].indexOf(l[l.length-1])
return a&&n===c})
return n.indexOf(a[a.length-1])}function Rw(){if(yw)return dw
yw=1
var e=Is(),t=1/0
return dw=r=>r?(r=e(r))===t||r===-1/0?17976931348623157e292*(r<0?-1:1):r==r?r:0:0===r?r:0}const Lw=r((()=>{if(gw)return bw
gw=1
var e=(()=>{if(mw)return vw
mw=1
var e=(()=>{if(hw)return pw
hw=1
var e=Math.ceil,t=Math.max
return pw=(r,n,o,i)=>{for(var a=-1,l=t(e((n-r)/(o||1)),0),c=Array(l);l--;)c[i?l:++a]=r,r+=o
return c}})(),t=zc(),r=Rw()
return vw=n=>(o,i,a)=>(a&&"number"!=typeof a&&t(o,i,a)&&(i=a=void 0),o=r(o),void 0===i?(i=o,o=0):i=r(i),a=void 0===a?o<i?1:-1:r(a),e(o,i,a,n))})()()
return bw=e})())
function Uw(e){return(Uw="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function zw(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function $w(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?zw(Object(r),!0).forEach(t=>{Fw(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):zw(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function Fw(e,t,r){var n
return n=(e=>{if("object"!=Uw(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Uw(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(t),(t="symbol"==Uw(n)?n:n+"")in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}var qw=["Webkit","Moz","O","ms"]
function Ww(e){return(Ww="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Xw(){return Xw=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},Xw.apply(this,arguments)}function Hw(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Vw(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Hw(Object(r),!0).forEach(t=>{Jw(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Hw(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function Yw(e,t){for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,Qw(n.key),n)}}function Gw(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{}))}catch(t){}return(Gw=()=>!!e)()}function Kw(e){return(Kw=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}function Zw(e,t){return(Zw=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function Jw(e,t,r){return(t=Qw(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function Qw(e){var t=(e=>{if("object"!=Ww(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=Ww(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==Ww(t)?t:t+""}var ex,tx,rx,nx,ox=e=>e.changedTouches&&!!e.changedTouches.length,ix=function(){function t(e){var r,n,o,i
return((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,t),Jw((n=this,i=[e],o=Kw(o=t),r=((e,t)=>{if(t&&("object"===Ww(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return(e=>{if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e})(e)})(n,Gw()?Reflect.construct(o,i||[],Kw(n).constructor):o.apply(n,i))),"handleDrag",e=>{r.leaveTimer&&(clearTimeout(r.leaveTimer),r.leaveTimer=null),r.state.isTravellerMoving?r.handleTravellerMove(e):r.state.isSlideMoving&&r.handleSlideDrag(e)}),Jw(r,"handleTouchMove",e=>{null!=e.changedTouches&&e.changedTouches.length>0&&r.handleDrag(e.changedTouches[0])}),Jw(r,"handleDragEnd",()=>{r.setState({isTravellerMoving:!1,isSlideMoving:!1},()=>{var e=r.props,t=e.endIndex,n=e.onDragEnd,o=e.startIndex
null==n||n({endIndex:t,startIndex:o})}),r.detachDragEndListener()}),Jw(r,"handleLeaveWrapper",()=>{(r.state.isTravellerMoving||r.state.isSlideMoving)&&(r.leaveTimer=window.setTimeout(r.handleDragEnd,r.props.leaveTimeOut))}),Jw(r,"handleEnterSlideOrTraveller",()=>{r.setState({isTextActive:!0})}),Jw(r,"handleLeaveSlideOrTraveller",()=>{r.setState({isTextActive:!1})}),Jw(r,"handleSlideDragStart",e=>{var t=ox(e)?e.changedTouches[0]:e
r.setState({isTravellerMoving:!1,isSlideMoving:!0,slideMoveStartX:t.pageX}),r.attachDragEndListener()}),r.travellerDragStartHandlers={startX:r.handleTravellerDragStart.bind(r,"startX"),endX:r.handleTravellerDragStart.bind(r,"endX")},r.state={},r}return((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&Zw(e,t)})(t,n.PureComponent),r=t,a=[{key:"renderDefaultTraveller",value:e=>{var t=e.x,r=e.y,n=e.width,i=e.height,a=e.stroke,l=Math.floor(r+i/2)-1
return o.createElement(o.Fragment,null,o.createElement("rect",{x:t,y:r,width:n,height:i,fill:a,stroke:"none"}),o.createElement("line",{x1:t+1,y1:l,x2:t+n-1,y2:l,fill:"none",stroke:"#fff"}),o.createElement("line",{x1:t+1,y1:l+2,x2:t+n-1,y2:l+2,fill:"none",stroke:"#fff"}))}},{key:"renderTraveller",value:(e,r)=>o.isValidElement(e)?o.cloneElement(e,r):Dt(e)?e(r):t.renderDefaultTraveller(r)},{key:"getDerivedStateFromProps",value:(e,t)=>{var r=e.data,n=e.width,o=e.x,i=e.travellerWidth,a=e.updateId,l=e.startIndex,c=e.endIndex
if(r!==t.prevData||a!==t.prevUpdateId)return Vw({prevData:r,prevTravellerWidth:i,prevUpdateId:a,prevX:o,prevWidth:n},r&&r.length?(e=>{var t=e.data,r=e.startIndex,n=e.endIndex,o=e.x,i=e.width,a=e.travellerWidth
if(!t||!t.length)return{}
var l=t.length,c=Gu().domain(Lw(0,l)).range([o,o+i-a]),s=c.domain().map(e=>c(e))
return{isTextActive:!1,isSlideMoving:!1,isTravellerMoving:!1,isTravellerFocused:!1,startX:c(r),endX:c(n),scale:c,scaleValues:s}})({data:r,width:n,x:o,travellerWidth:i,startIndex:l,endIndex:c}):{scale:null,scaleValues:null})
if(t.scale&&(n!==t.prevWidth||o!==t.prevX||i!==t.prevTravellerWidth)){t.scale.range([o,o+n-i])
var s=t.scale.domain().map(e=>t.scale(e))
return{prevData:r,prevTravellerWidth:i,prevUpdateId:a,prevX:o,prevWidth:n,startX:t.scale(e.startIndex),endX:t.scale(e.endIndex),scaleValues:s}}return null}},{key:"getIndexInRange",value:(e,t)=>{for(var r=0,n=e.length-1;n-r>1;){var o=Math.floor((r+n)/2)
e[o]>t?n=o:r=o}return t>=e[n]?n:r}}],(i=[{key:"componentWillUnmount",value:function(){this.leaveTimer&&(clearTimeout(this.leaveTimer),this.leaveTimer=null),this.detachDragEndListener()}},{key:"getIndex",value:function(e){var r=e.startX,n=e.endX,o=this.state.scaleValues,i=this.props,a=i.gap,l=i.data.length-1,c=Math.min(r,n),s=Math.max(r,n),u=t.getIndexInRange(o,c),f=t.getIndexInRange(o,s)
return{startIndex:u-u%a,endIndex:f===l?l:f-f%a}}},{key:"getTextOfTick",value:function(e){var t=this.props,r=t.data,n=t.tickFormatter,o=t.dataKey,i=$v(r[e],o,e)
return Dt(n)?n(i,e):i}},{key:"attachDragEndListener",value:function(){window.addEventListener("mouseup",this.handleDragEnd,!0),window.addEventListener("touchend",this.handleDragEnd,!0),window.addEventListener("mousemove",this.handleDrag,!0)}},{key:"detachDragEndListener",value:function(){window.removeEventListener("mouseup",this.handleDragEnd,!0),window.removeEventListener("touchend",this.handleDragEnd,!0),window.removeEventListener("mousemove",this.handleDrag,!0)}},{key:"handleSlideDrag",value:function(e){var t=this.state,r=t.slideMoveStartX,n=t.startX,o=t.endX,i=this.props,a=i.x,l=i.width,c=i.travellerWidth,s=i.startIndex,u=i.endIndex,f=i.onChange,p=e.pageX-r
p>0?p=Math.min(p,a+l-c-o,a+l-c-n):p<0&&(p=Math.max(p,a-n,a-o))
var h=this.getIndex({startX:n+p,endX:o+p})
h.startIndex===s&&h.endIndex===u||!f||f(h),this.setState({startX:n+p,endX:o+p,slideMoveStartX:e.pageX})}},{key:"handleTravellerDragStart",value:function(e,t){var r=ox(t)?t.changedTouches[0]:t
this.setState({isSlideMoving:!1,isTravellerMoving:!0,movingTravellerId:e,brushMoveStartX:r.pageX}),this.attachDragEndListener()}},{key:"handleTravellerMove",value:function(e){var t=this.state,r=t.brushMoveStartX,n=t.movingTravellerId,o=t.endX,i=t.startX,a=this.state[n],l=this.props,c=l.x,s=l.width,u=l.travellerWidth,f=l.onChange,p=l.gap,h=l.data,d={startX:this.state.startX,endX:this.state.endX},y=e.pageX-r
y>0?y=Math.min(y,c+s-u-a):y<0&&(y=Math.max(y,c-a)),d[n]=a+y
var v=this.getIndex(d),m=v.startIndex,b=v.endIndex
this.setState(Jw(Jw({},n,a+y),"brushMoveStartX",e.pageX),()=>{var e
f&&(e=h.length-1,("startX"===n&&(o>i?m%p===0:b%p===0)||o<i&&b===e||"endX"===n&&(o>i?b%p===0:m%p===0)||o>i&&b===e)&&f(v))})}},{key:"handleTravellerMoveKeyboard",value:function(e,t){var r=this,n=this.state,o=n.scaleValues,i=n.startX,a=n.endX,l=this.state[t],c=o.indexOf(l)
if(-1!==c){var s=c+e
if(!(-1===s||s>=o.length)){var u=o[s]
"startX"===t&&u>=a||"endX"===t&&u<=i||this.setState(Jw({},t,u),()=>{r.props.onChange(r.getIndex({startX:r.state.startX,endX:r.state.endX}))})}}}},{key:"renderBackground",value:function(){var e=this.props,t=e.x,r=e.y,n=e.width,i=e.height,a=e.fill,l=e.stroke
return o.createElement("rect",{stroke:l,fill:a,x:t,y:r,width:n,height:i})}},{key:"renderPanorama",value:function(){var e=this.props,t=e.x,r=e.y,i=e.width,a=e.height,l=e.data,c=e.children,s=e.padding,u=n.Children.only(c)
return u?o.cloneElement(u,{x:t,y:r,width:i,height:a,margin:s,compact:!0,data:l}):null}},{key:"renderTravellerLayer",value:function(e,r){var n,i,a=this,l=this.props,c=l.y,s=l.travellerWidth,u=l.height,f=l.traveller,p=l.ariaLabel,h=l.data,d=l.startIndex,y=l.endIndex,v=Math.max(e,this.props.x),m=Vw(Vw({},Er(this.props,!1)),{},{x:v,y:c,width:s,height:u}),b=p||"Min value: ".concat(null===(n=h[d])||void 0===n?void 0:n.name,", Max value: ").concat(null===(i=h[y])||void 0===i?void 0:i.name)
return o.createElement(Jr,{tabIndex:0,role:"slider","aria-label":b,"aria-valuenow":e,className:"recharts-brush-traveller",onMouseEnter:this.handleEnterSlideOrTraveller,onMouseLeave:this.handleLeaveSlideOrTraveller,onMouseDown:this.travellerDragStartHandlers[r],onTouchStart:this.travellerDragStartHandlers[r],onKeyDown:e=>{["ArrowLeft","ArrowRight"].includes(e.key)&&(e.preventDefault(),e.stopPropagation(),a.handleTravellerMoveKeyboard("ArrowRight"===e.key?1:-1,r))},onFocus:()=>{a.setState({isTravellerFocused:!0})},onBlur:()=>{a.setState({isTravellerFocused:!1})},style:{cursor:"col-resize"}},t.renderTraveller(f,m))}},{key:"renderSlide",value:function(e,t){var r=this.props,n=r.y,i=r.height,a=r.stroke,l=r.travellerWidth,c=Math.min(e,t)+l,s=Math.max(Math.abs(t-e)-l,0)
return o.createElement("rect",{className:"recharts-brush-slide",onMouseEnter:this.handleEnterSlideOrTraveller,onMouseLeave:this.handleLeaveSlideOrTraveller,onMouseDown:this.handleSlideDragStart,onTouchStart:this.handleSlideDragStart,style:{cursor:"move"},stroke:"none",fill:a,fillOpacity:.2,x:c,y:n,width:s,height:i})}},{key:"renderText",value:function(){var e=this.props,t=e.startIndex,r=e.endIndex,n=e.y,i=e.height,a=e.travellerWidth,l=e.stroke,c=this.state,s=c.startX,u=c.endX,f={pointerEvents:"none",fill:l}
return o.createElement(Jr,{className:"recharts-brush-texts"},o.createElement(wu,Xw({textAnchor:"end",verticalAnchor:"middle",x:Math.min(s,u)-5,y:n+i/2},f),this.getTextOfTick(t)),o.createElement(wu,Xw({textAnchor:"start",verticalAnchor:"middle",x:Math.max(s,u)+a+5,y:n+i/2},f),this.getTextOfTick(r)))}},{key:"render",value:function(){var t=this.props,r=t.data,n=t.className,i=t.children,a=t.x,l=t.y,c=t.width,s=t.height,u=t.alwaysShowText,f=this.state,p=f.startX,h=f.endX,d=f.isTextActive,y=f.isSlideMoving,v=f.isTravellerMoving,m=f.isTravellerFocused
if(!r||!r.length||!Kt(a)||!Kt(l)||!Kt(c)||!Kt(s)||c<=0||s<=0)return null
var b,g,w,x,O=e("recharts-brush",n),j=1===o.Children.count(i),S=(g="none",w=(b="userSelect").replace(/(\w)/,e=>e.toUpperCase()),(x=qw.reduce((e,t)=>$w($w({},e),{},Fw({},t+w,g)),{}))[b]=g,x)
return o.createElement(Jr,{className:O,onMouseLeave:this.handleLeaveWrapper,onTouchMove:this.handleTouchMove,style:S},this.renderBackground(),j&&this.renderPanorama(),this.renderSlide(p,h),this.renderTravellerLayer(p,"startX"),this.renderTravellerLayer(h,"endX"),(d||y||v||m||u)&&this.renderText())}}])&&Yw(r.prototype,i),a&&Yw(r,a),Object.defineProperty(r,"prototype",{writable:!1}),r
var r,i,a}()
Jw(ix,"displayName","Brush"),Jw(ix,"defaultProps",{height:40,travellerWidth:5,gap:1,fill:"#fff",stroke:"#666",padding:{top:1,right:1,bottom:1,left:1},leaveTimeOut:1e3,alwaysShowText:!1})
const ax=r((()=>{if(nx)return rx
nx=1
var e=Oi(),t=_l(),r=(()=>{if(tx)return ex
tx=1
var e=Rc()
return ex=(t,r)=>{var n
return e(t,(e,t,o)=>!(n=r(e,t,o))),!!n}})(),n=tt(),o=zc()
return rx=(i,a,l)=>{var c=n(i)?e:r
return l&&o(i,a,l)&&(a=void 0),c(i,t(a,3))}})())
var lx,cx,sx,ux,fx=(e,t)=>{var r=e.alwaysShow,n=e.ifOverflow
return r&&(n="extendDomain"),n===t}
const px=r((()=>{if(ux)return sx
ux=1
var e=(()=>{if(cx)return lx
cx=1
var e=Uc()
return lx=(t,r,n)=>{"__proto__"==r&&e?e(t,r,{configurable:!0,enumerable:!0,value:n,writable:!0}):t[r]=n}})(),t=Bc(),r=_l()
return sx=(n,o)=>{var i={}
return o=r(o,3),t(n,(t,r,n)=>{e(i,r,o(t,r,n))}),i}})())
var hx,dx,yx,vx,mx,bx
const gx=r((()=>{if(bx)return mx
bx=1
var e=dx?hx:(dx=1,hx=(e,t)=>{for(var r=-1,n=null==e?0:e.length;++r<n;)if(!t(e[r],r,e))return!1
return!0}),t=(()=>{if(vx)return yx
vx=1
var e=Rc()
return yx=(t,r)=>{var n=!0
return e(t,(e,t,o)=>n=!!r(e,t,o)),n}})(),r=_l(),n=tt(),o=zc()
return mx=(i,a,l)=>{var c=n(i)?e:t
return l&&o(i,a,l)&&(a=void 0),c(i,r(a,3))}})())
var wx=["x","y"]
function xx(e){return(xx="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Ox(){return Ox=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},Ox.apply(this,arguments)}function jx(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Sx(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?jx(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=xx(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=xx(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==xx(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):jx(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function Px(e,t){var r=e.x,n=e.y,o=((e,t)=>{if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o})(e,wx),i="".concat(r),a=parseInt(i,10),l="".concat(n),c=parseInt(l,10),s="".concat(t.height||o.height),u=parseInt(s,10),f="".concat(t.width||o.width),p=parseInt(f,10)
return Sx(Sx(Sx(Sx(Sx({},t),o),a?{x:a}:{}),c?{y:c}:{}),{},{height:u,width:p,name:t.name,radius:t.radius})}function Ax(e){return o.createElement(_w,Ox({shapeType:"rectangle",propTransformer:Px,activeClassName:"recharts-active-bar"},e))}var Ex,Mx=["value","background"]
function _x(e){return(_x="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function Tx(){return Tx=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},Tx.apply(this,arguments)}function kx(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Cx(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?kx(Object(r),!0).forEach(t=>{Rx(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):kx(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function Ix(e,t){for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,Lx(n.key),n)}}function Dx(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{}))}catch(t){}return(Dx=()=>!!e)()}function Nx(e){return(Nx=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}function Bx(e,t){return(Bx=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function Rx(e,t,r){return(t=Lx(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function Lx(e){var t=(e=>{if("object"!=_x(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=_x(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==_x(t)?t:t+""}var Ux=function(){function t(){var e,r,n,o;((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,t)
for(var i=arguments.length,a=new Array(i),l=0;l<i;l++)a[l]=arguments[l]
return Rx((r=this,n=t,o=[].concat(a),n=Nx(n),e=((e,t)=>{if(t&&("object"===_x(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return(e=>{if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e})(e)})(r,Dx()?Reflect.construct(n,o||[],Nx(r).constructor):n.apply(r,o))),"state",{isAnimationFinished:!1}),Rx(e,"id",Qt("recharts-bar-")),Rx(e,"handleAnimationEnd",()=>{var t=e.props.onAnimationEnd
e.setState({isAnimationFinished:!0}),t&&t()}),Rx(e,"handleAnimationStart",()=>{var t=e.props.onAnimationStart
e.setState({isAnimationFinished:!1}),t&&t()}),e}return((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&Bx(e,t)})(t,n.PureComponent),r=t,a=[{key:"getDerivedStateFromProps",value:(e,t)=>e.animationId!==t.prevAnimationId?{prevAnimationId:e.animationId,curData:e.data,prevData:t.curData}:e.data!==t.curData?{curData:e.data}:null}],(i=[{key:"renderRectanglesStatically",value:function(e){var t=this,r=this.props,n=r.shape,i=r.dataKey,a=r.activeIndex,l=r.activeBar,c=Er(this.props,!1)
return e&&e.map((e,r)=>{var s=r===a,u=s?l:n,f=Cx(Cx(Cx({},c),e),{},{isActive:s,option:u,index:r,dataKey:i,onAnimationStart:t.handleAnimationStart,onAnimationEnd:t.handleAnimationEnd})
return o.createElement(Jr,Tx({className:"recharts-bar-rectangle"},pr(t.props,e,r),{key:"rectangle-".concat(null==e?void 0:e.x,"-").concat(null==e?void 0:e.y,"-").concat(null==e?void 0:e.value,"-").concat(r)}),o.createElement(Ax,f))})}},{key:"renderRectanglesWithAnimation",value:function(){var e=this,t=this.props,r=t.data,n=t.layout,i=t.isAnimationActive,a=t.animationBegin,l=t.animationDuration,c=t.animationEasing,s=t.animationId,u=this.state.prevData
return o.createElement(Ng,{begin:a,duration:l,isActive:i,easing:c,from:{t:0},to:{t:1},key:"bar-".concat(s),onAnimationEnd:this.handleAnimationEnd,onAnimationStart:this.handleAnimationStart},t=>{var i=t.t,a=r.map((e,t)=>{var r=u&&u[t]
if(r){var o=rr(r.x,e.x),a=rr(r.y,e.y),l=rr(r.width,e.width),c=rr(r.height,e.height)
return Cx(Cx({},e),{},{x:o(i),y:a(i),width:l(i),height:c(i)})}if("horizontal"===n){var s=rr(0,e.height)(i)
return Cx(Cx({},e),{},{y:e.y+e.height-s,height:s})}var f=rr(0,e.width)(i)
return Cx(Cx({},e),{},{width:f})})
return o.createElement(Jr,null,e.renderRectanglesStatically(a))})}},{key:"renderRectangles",value:function(){var e=this.props,t=e.data,r=e.isAnimationActive,n=this.state.prevData
return!(r&&t&&t.length)||n&&Oy(n,t)?this.renderRectanglesStatically(t):this.renderRectanglesWithAnimation()}},{key:"renderBackground",value:function(){var e=this,t=this.props,r=t.data,n=t.dataKey,i=t.activeIndex,a=Er(this.props.background,!1)
return r.map((t,r)=>{t.value
var l=t.background,c=((e,t)=>{if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o})(t,Mx)
if(!l)return null
var s=Cx(Cx(Cx(Cx(Cx({},c),{},{fill:"#eee"},l),a),pr(e.props,t,r)),{},{onAnimationStart:e.handleAnimationStart,onAnimationEnd:e.handleAnimationEnd,dataKey:n,index:r,className:"recharts-bar-background-rectangle"})
return o.createElement(Ax,Tx({key:"background-bar-".concat(r),option:e.props.background,isActive:r===i},s))})}},{key:"renderErrorBar",value:function(e,t){if(this.props.isAnimationActive&&!this.state.isAnimationFinished)return null
var r=this.props,n=r.data,i=r.xAxis,a=r.yAxis,l=r.layout,c=Or(r.children,Tv)
if(!c)return null
var s="vertical"===l?n[0].height/2:n[0].width/2,u=(e,t)=>{var r=Array.isArray(e.value)?e.value[1]:e.value
return{x:e.x,y:e.y,value:r,errorVal:$v(e,t)}},f={clipPath:e?"url(#clipPath-".concat(t,")"):null}
return o.createElement(Jr,f,c.map(e=>o.cloneElement(e,{key:"error-bar-".concat(t,"-").concat(e.props.dataKey),data:n,xAxis:i,yAxis:a,layout:l,offset:s,dataPointFormatter:u})))}},{key:"render",value:function(){var t=this.props,r=t.hide,n=t.data,i=t.className,a=t.xAxis,l=t.yAxis,c=t.left,s=t.top,u=t.width,f=t.height,p=t.isAnimationActive,h=t.background,d=t.id
if(r||!n||!n.length)return null
var y=this.state.isAnimationFinished,v=e("recharts-bar",i),m=a&&a.allowDataOverflow,b=l&&l.allowDataOverflow,g=m||b,w=Tt(d)?this.id:d
return o.createElement(Jr,{className:v},m||b?o.createElement("defs",null,o.createElement("clipPath",{id:"clipPath-".concat(w)},o.createElement("rect",{x:m?c:c-u/2,y:b?s:s-f/2,width:m?u:2*u,height:b?f:2*f}))):null,o.createElement(Jr,{className:"recharts-bar-rectangles",clipPath:g?"url(#clipPath-".concat(w,")"):null},h?this.renderBackground():null,this.renderRectangles()),this.renderErrorBar(g,w),(!p||y)&&Xm.renderCallByParent(this.props,n))}}])&&Ix(r.prototype,i),a&&Ix(r,a),Object.defineProperty(r,"prototype",{writable:!1}),r
var r,i,a}()
function zx(e){return(zx="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function $x(e,t){for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,Xx(n.key),n)}}function Fx(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function qx(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?Fx(Object(r),!0).forEach(t=>{Wx(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):Fx(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function Wx(e,t,r){return(t=Xx(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function Xx(e){var t=(e=>{if("object"!=zx(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=zx(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==zx(t)?t:t+""}Ex=Ux,Rx(Ux,"displayName","Bar"),Rx(Ux,"defaultProps",{xAxisId:0,yAxisId:0,legendType:"rect",minPointSize:0,hide:!1,data:[],layout:"vertical",activeBar:!1,isAnimationActive:!us.isSsr,animationBegin:0,animationDuration:400,animationEasing:"ease"}),Rx(Ux,"getComposedData",e=>{var t=e.props,r=e.item,n=e.barPosition,o=e.bandSize,i=e.xAxis,a=e.yAxis,l=e.xAxisTicks,c=e.yAxisTicks,s=e.stackedData,u=e.dataStartIndex,f=e.displayedData,p=e.offset,h=((e,t)=>{if(!e)return null
for(var r=0,n=e.length;r<n;r++)if(e[r].item===t)return e[r].position
return null})(n,r)
if(!h)return null
var d=t.layout,y=r.type.defaultProps,v=void 0!==y?Cx(Cx({},y),r.props):r.props,m=v.dataKey,b=v.children,g=v.minPointSize,w="horizontal"===d?a:i,x=s?w.scale.domain():null,O=(e=>{var t=e.numericAxis,r=t.scale.domain()
if("number"===t.type){var n=Math.min(r[0],r[1]),o=Math.max(r[0],r[1])
return n<=0&&o>=0?0:o<0?o:n}return r[0]})({numericAxis:w}),j=Or(b,zs),S=f.map((e,t)=>{var n,f,p,y,v,b
s?n=((e,t)=>{if(!t||2!==t.length||!Kt(t[0])||!Kt(t[1]))return e
var r=Math.min(t[0],t[1]),n=Math.max(t[0],t[1]),o=[e[0],e[1]]
return(!Kt(e[0])||e[0]<r)&&(o[0]=r),(!Kt(e[1])||e[1]>n)&&(o[1]=n),o[0]>n&&(o[0]=n),o[1]<r&&(o[1]=r),o})(s[u+t],x):(n=$v(e,m),Array.isArray(n)||(n=[O,n]))
var w=function(e){var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:0
return(r,n)=>{if("number"==typeof e)return e
var o=Kt(r)||(e=>Tt(e))(r)
return o?e(r,n):(o||wv(),t)}}(g,Ex.defaultProps.minPointSize)(n[1],t)
if("horizontal"===d){var S,P=[a.scale(n[0]),a.scale(n[1])],A=P[0],E=P[1]
f=om({axis:i,ticks:l,bandSize:o,offset:h.offset,entry:e,index:t}),p=null!==(S=null!=E?E:A)&&void 0!==S?S:void 0,y=h.size
var M=A-E
if(v=Number.isNaN(M)?0:M,b={x:f,y:a.y,width:y,height:a.height},Math.abs(w)>0&&Math.abs(v)<Math.abs(w)){var _=Yt(v||w)*(Math.abs(w)-Math.abs(v))
p-=_,v+=_}}else{var T=[i.scale(n[0]),i.scale(n[1])],k=T[0],C=T[1]
f=k,p=om({axis:a,ticks:c,bandSize:o,offset:h.offset,entry:e,index:t}),y=C-k,v=h.size,b={x:i.x,y:p,width:i.width,height:v},Math.abs(w)>0&&Math.abs(y)<Math.abs(w)&&(y+=Yt(y||w)*(Math.abs(w)-Math.abs(y)))}return Cx(Cx(Cx({},e),{},{x:f,y:p,width:y,height:v,value:s?n:n[1],payload:e,background:b},j&&j[t]&&j[t].props),{},{tooltipPayload:[fm(r,e)],tooltipPosition:{x:f+y/2,y:p+v/2}})})
return Cx({data:S,layout:d},p)})
var Hx=(e,t,r,n,o)=>{var i=e.width,a=e.height,l=e.layout,c=e.children,s=Object.keys(t),u={left:r.left,leftMirror:r.left,right:i-r.right,rightMirror:i-r.right,top:r.top,topMirror:r.top,bottom:a-r.bottom,bottomMirror:a-r.bottom},f=!!jr(c,Ux)
return s.reduce((i,a)=>{var c,s,p,h,d,y=t[a],v=y.orientation,m=y.domain,b=y.padding,g=void 0===b?{}:b,w=y.mirror,x=y.reversed,O="".concat(v).concat(w?"Mirror":"")
if("number"===y.type&&("gap"===y.padding||"no-gap"===y.padding)){var j=m[1]-m[0],S=1/0,P=y.categoricalDomain.sort(or)
if(P.forEach((e,t)=>{t>0&&(S=Math.min((e||0)-(P[t-1]||0),S))}),Number.isFinite(S)){var A=S/j,E="vertical"===y.layout?r.height:r.width
if("gap"===y.padding&&(c=A*E/2),"no-gap"===y.padding){var M=er(e.barCategoryGap,A*E),_=A*E/2
c=_-M-(_-M)/E*M}}}s="xAxis"===n?[r.left+(g.left||0)+(c||0),r.left+r.width-(g.right||0)-(c||0)]:"yAxis"===n?"horizontal"===l?[r.top+r.height-(g.bottom||0),r.top+(g.top||0)]:[r.top+(g.top||0)+(c||0),r.top+r.height-(g.bottom||0)-(c||0)]:y.range,x&&(s=[s[1],s[0]])
var T=Zv(y,o,f),k=T.scale,C=T.realScaleType
k.domain(m).range(s),Qv(k)
var I=rm(k,qx(qx({},y),{},{realScaleType:C}))
"xAxis"===n?(d="top"===v&&!w||"bottom"===v&&w,p=r.left,h=u[O]-d*y.height):"yAxis"===n&&(d="left"===v&&!w||"right"===v&&w,p=u[O]-d*y.width,h=r.top)
var D=qx(qx(qx({},y),I),{},{realScaleType:C,x:p,y:h,scale:k,width:"xAxis"===n?r.width:y.width,height:"yAxis"===n?r.height:y.height})
return D.bandSize=sm(D,I),y.hide||"xAxis"!==n?y.hide||(u[O]+=(d?-1:1)*D.width):u[O]+=(d?-1:1)*D.height,qx(qx({},i),{},Wx({},a,D))},{})},Vx=(e,t)=>{var r=e.x,n=e.y,o=t.x,i=t.y
return{x:Math.min(r,o),y:Math.min(n,i),width:Math.abs(o-r),height:Math.abs(i-n)}},Yx=function(){function e(t){((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,e),this.scale=t}return t=e,r=[{key:"domain",get:function(){return this.scale.domain}},{key:"range",get:function(){return this.scale.range}},{key:"rangeMin",get:function(){return this.range()[0]}},{key:"rangeMax",get:function(){return this.range()[1]}},{key:"bandwidth",get:function(){return this.scale.bandwidth}},{key:"apply",value:function(e){var t=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{},r=t.bandAware,n=t.position
if(void 0!==e){if(n)switch(n){case"start":default:return this.scale(e)
case"middle":var o=this.bandwidth?this.bandwidth()/2:0
return this.scale(e)+o
case"end":var i=this.bandwidth?this.bandwidth():0
return this.scale(e)+i}if(r){var a=this.bandwidth?this.bandwidth()/2:0
return this.scale(e)+a}return this.scale(e)}}},{key:"isInRange",value:function(e){var t=this.range(),r=t[0],n=t[t.length-1]
return r<=n?e>=r&&e<=n:e>=n&&e<=r}}],n=[{key:"create",value:t=>new e(t)}],r&&$x(t.prototype,r),n&&$x(t,n),Object.defineProperty(t,"prototype",{writable:!1}),t
var t,r,n}()
Wx(Yx,"EPS",1e-4)
var Gx,Kx,Zx,Jx,Qx,eO,tO,rO,nO=e=>{var t=Object.keys(e).reduce((t,r)=>qx(qx({},t),{},Wx({},r,Yx.create(e[r]))),{})
return qx(qx({},t),{},{apply:function(e){var r=arguments.length>1&&void 0!==arguments[1]?arguments[1]:{},n=r.bandAware,o=r.position
return px(e,(e,r)=>t[r].apply(e,{bandAware:n,position:o}))},isInRange:e=>gx(e,(e,r)=>t[r].isInRange(e))})},oO=function(e){var t=e.width,r=e.height,n=((arguments.length>1&&void 0!==arguments[1]?arguments[1]:0)%180+180)%180*Math.PI/180,o=Math.atan(r/t),i=n>o&&n<Math.PI-o?r/Math.sin(n):t/Math.cos(n)
return Math.abs(i)}
const iO=r((()=>{if(rO)return tO
rO=1
var e=(()=>{if(Kx)return Gx
Kx=1
var e=_l(),t=Ol(),r=jl()
return Gx=n=>(o,i,a)=>{var l=Object(o)
if(!t(o)){var c=e(i,3)
o=r(o),i=e=>c(l[e],e,l)}var s=n(o,i,a)
return s>-1?l[c?o[s]:s]:void 0}})()((()=>{if(eO)return Qx
eO=1
var e=Tl(),t=_l(),r=(()=>{if(Jx)return Zx
Jx=1
var e=Rw()
return Zx=t=>{var r=e(t),n=r%1
return r==r?n?r-n:r:0}})(),n=Math.max
return Qx=(o,i,a)=>{var l=null==o?0:o.length
if(!l)return-1
var c=null==a?0:r(a)
return c<0&&(c=n(l+c,0)),e(o,t(i,3),c)}})())
return tO=e})())
var aO=r(wt())(e=>({x:e.left,y:e.top,width:e.width,height:e.height}),e=>["l",e.left,"t",e.top,"w",e.width,"h",e.height].join("")),lO=n.createContext(void 0),cO=n.createContext(void 0),sO=n.createContext(void 0),uO=n.createContext({}),fO=n.createContext(void 0),pO=n.createContext(0),hO=n.createContext(0),dO=e=>{var t=e.state,r=t.xAxisMap,n=t.yAxisMap,i=t.offset,a=e.clipPathId,l=e.children,c=e.width,s=e.height,u=aO(i)
return o.createElement(lO.Provider,{value:r},o.createElement(cO.Provider,{value:n},o.createElement(uO.Provider,{value:i},o.createElement(sO.Provider,{value:u},o.createElement(fO.Provider,{value:a},o.createElement(pO.Provider,{value:s},o.createElement(hO.Provider,{value:c},l)))))))},yO=e=>{var t=n.useContext(lO)
null==t&&wv()
var r=t[e]
return null==r&&wv(),r},vO=()=>{var e=n.useContext(lO)
return tr(e)},mO=()=>{var e=n.useContext(cO)
return iO(e,e=>gx(e.domain,Number.isFinite))||tr(e)},bO=e=>{var t=n.useContext(cO)
null==t&&wv()
var r=t[e]
return null==r&&wv(),r},gO=()=>n.useContext(uO),wO=()=>n.useContext(hO),xO=()=>n.useContext(pO)
function OO(e){return(OO="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function jO(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{}))}catch(t){}return(jO=()=>!!e)()}function SO(e){return(SO=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}function PO(e,t){return(PO=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function AO(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function EO(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?AO(Object(r),!0).forEach(t=>{MO(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):AO(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function MO(e,t,r){return(t=_O(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function _O(e){var t=(e=>{if("object"!=OO(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=OO(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==OO(t)?t:t+""}function TO(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function kO(){return kO=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},kO.apply(this,arguments)}function CO(t){var r=t.x,i=t.y,a=t.segment,l=t.xAxisId,c=t.yAxisId,s=t.shape,u=t.className,f=t.alwaysShow,p=n.useContext(fO),h=yO(l),d=bO(c),y=n.useContext(sO)
if(!p||!y)return null
Qr(void 0===f,'The alwaysShow prop is deprecated. Please use ifOverflow="extendDomain" instead.')
var v=((e,t,r,n,o,i,a,l,c)=>{var s=o.x,u=o.y,f=o.width,p=o.height
if(r){var h=c.y,d=e.y.apply(h,{position:i})
if(fx(c,"discard")&&!e.y.isInRange(d))return null
var y=[{x:s+f,y:d},{x:s,y:d}]
return"left"===l?y.reverse():y}if(t){var v=c.x,m=e.x.apply(v,{position:i})
if(fx(c,"discard")&&!e.x.isInRange(m))return null
var b=[{x:m,y:u+p},{x:m,y:u}]
return"top"===a?b.reverse():b}if(n){var g=c.segment.map(t=>e.apply(t,{position:i}))
return fx(c,"discard")&&ax(g,t=>!e.isInRange(t))?null:g}return null})(nO({x:h.scale,y:d.scale}),Zt(r),Zt(i),a&&2===a.length,y,t.position,h.orientation,d.orientation,t)
if(!v)return null
var m,b,g=(e=>{if(Array.isArray(e))return e})(m=v)||(e=>{var t=null==e?null:"undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"]
if(null!=t){var r,n,o,i,a=[],l=!0,c=!1
try{for(o=(t=t.call(e)).next;!(l=(r=o.call(t)).done)&&(a.push(r.value),2!==a.length);l=!0);}catch(s){c=!0,n=s}finally{try{if(!l&&null!=t.return&&(i=t.return(),Object(i)!==i))return}finally{if(c)throw n}}return a}})(m)||(e=>{if(e){if("string"==typeof e)return TO(e,2)
var t=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===t&&e.constructor&&(t=e.constructor.name),"Map"===t||"Set"===t?Array.from(e):"Arguments"===t||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(t)?TO(e,2):void 0}})(m)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})(),w=g[0],x=w.x,O=w.y,j=g[1],S=j.x,P=j.y,A=EO(EO({clipPath:fx(t,"hidden")?"url(#".concat(p,")"):void 0},Er(t,!0)),{},{x1:x,y1:O,x2:S,y2:P})
return o.createElement(Jr,{className:e("recharts-reference-line",u)},((e,t)=>o.isValidElement(e)?o.cloneElement(e,t):Dt(e)?e(t):o.createElement("line",kO({},t,{className:"recharts-reference-line-line"})))(s,A),km.renderCallByParent(t,Vx({x:(b={x1:x,y1:O,x2:S,y2:P}).x1,y:b.y1},{x:b.x2,y:b.y2})))}var IO=function(){function e(){return((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,e),t=this,n=arguments,r=SO(r=e),((e,t)=>{if(t&&("object"===OO(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return(e=>{if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e})(e)})(t,jO()?Reflect.construct(r,n||[],SO(t).constructor):r.apply(t,n))
var t,r,n}return((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&PO(e,t)})(e,o.Component),t=e,(r=[{key:"render",value:function(){return o.createElement(CO,this.props)}}])&&((e,t)=>{for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,_O(n.key),n)}})(t.prototype,r),Object.defineProperty(t,"prototype",{writable:!1}),t
var t,r}()
function DO(){return DO=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},DO.apply(this,arguments)}function NO(e){return(NO="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function BO(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function RO(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?BO(Object(r),!0).forEach(t=>{$O(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):BO(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function LO(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{}))}catch(t){}return(LO=()=>!!e)()}function UO(e){return(UO=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}function zO(e,t){return(zO=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function $O(e,t,r){return(t=FO(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function FO(e){var t=(e=>{if("object"!=NO(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=NO(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==NO(t)?t:t+""}MO(IO,"displayName","ReferenceLine"),MO(IO,"defaultProps",{isFront:!1,ifOverflow:"discard",xAxisId:0,yAxisId:0,fill:"none",stroke:"#ccc",fillOpacity:1,strokeWidth:1,position:"middle"})
var qO=function(){function t(){return((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,t),e=this,n=arguments,r=UO(r=t),((e,t)=>{if(t&&("object"===NO(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return(e=>{if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e})(e)})(e,LO()?Reflect.construct(r,n||[],UO(e).constructor):r.apply(e,n))
var e,r,n}return((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&zO(e,t)})(t,o.Component),r=t,(n=[{key:"render",value:function(){var r=this.props,n=r.x,i=r.y,a=r.r,l=r.alwaysShow,c=r.clipPathId,s=Zt(n),u=Zt(i)
if(Qr(void 0===l,'The alwaysShow prop is deprecated. Please use ifOverflow="extendDomain" instead.'),!s||!u)return null
var f=(e=>{var t=e.x,r=e.y,n=e.xAxis,o=e.yAxis,i=nO({x:n.scale,y:o.scale}),a=i.apply({x:t,y:r},{bandAware:!0})
return fx(e,"discard")&&!i.isInRange(a)?null:a})(this.props)
if(!f)return null
var p=f.x,h=f.y,d=this.props,y=d.shape,v=d.className,m=RO(RO({clipPath:fx(this.props,"hidden")?"url(#".concat(c,")"):void 0},Er(this.props,!0)),{},{cx:p,cy:h})
return o.createElement(Jr,{className:e("recharts-reference-dot",v)},t.renderDot(y,m),km.renderCallByParent(this.props,{x:p-a,y:h-a,width:2*a,height:2*a}))}}])&&((e,t)=>{for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,FO(n.key),n)}})(r.prototype,n),Object.defineProperty(r,"prototype",{writable:!1}),r
var r,n}()
function WO(){return WO=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},WO.apply(this,arguments)}function XO(e){return(XO="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function HO(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function VO(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?HO(Object(r),!0).forEach(t=>{ZO(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):HO(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function YO(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{}))}catch(t){}return(YO=()=>!!e)()}function GO(e){return(GO=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}function KO(e,t){return(KO=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function ZO(e,t,r){return(t=JO(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function JO(e){var t=(e=>{if("object"!=XO(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=XO(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==XO(t)?t:t+""}$O(qO,"displayName","ReferenceDot"),$O(qO,"defaultProps",{isFront:!1,ifOverflow:"discard",xAxisId:0,yAxisId:0,r:10,fill:"#fff",stroke:"#ccc",fillOpacity:1,strokeWidth:1}),$O(qO,"renderDot",(e,t)=>o.isValidElement(e)?o.cloneElement(e,t):Dt(e)?e(t):o.createElement(Hg,DO({},t,{cx:t.cx,cy:t.cy,className:"recharts-reference-dot-dot"})))
var QO=function(){function t(){return((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,t),e=this,n=arguments,r=GO(r=t),((e,t)=>{if(t&&("object"===XO(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return(e=>{if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e})(e)})(e,YO()?Reflect.construct(r,n||[],GO(e).constructor):r.apply(e,n))
var e,r,n}return((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&KO(e,t)})(t,o.Component),r=t,(n=[{key:"render",value:function(){var r=this.props,n=r.x1,i=r.x2,a=r.y1,l=r.y2,c=r.className,s=r.alwaysShow,u=r.clipPathId
Qr(void 0===s,'The alwaysShow prop is deprecated. Please use ifOverflow="extendDomain" instead.')
var f=Zt(n),p=Zt(i),h=Zt(a),d=Zt(l),y=this.props.shape
if(!(f||p||h||d||y))return null
var v=((e,t,r,n,o)=>{var i=o.x1,a=o.x2,l=o.y1,c=o.y2,s=o.xAxis,u=o.yAxis
if(!s||!u)return null
var f=nO({x:s.scale,y:u.scale}),p={x:e?f.x.apply(i,{position:"start"}):f.x.rangeMin,y:r?f.y.apply(l,{position:"start"}):f.y.rangeMin},h={x:t?f.x.apply(a,{position:"end"}):f.x.rangeMax,y:n?f.y.apply(c,{position:"end"}):f.y.rangeMax}
return!fx(o,"discard")||f.isInRange(p)&&f.isInRange(h)?Vx(p,h):null})(f,p,h,d,this.props)
if(!v&&!y)return null
var m=fx(this.props,"hidden")?"url(#".concat(u,")"):void 0
return o.createElement(Jr,{className:e("recharts-reference-area",c)},t.renderRect(y,VO(VO({clipPath:m},Er(this.props,!0)),v)),km.renderCallByParent(this.props,v))}}])&&((e,t)=>{for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,JO(n.key),n)}})(r.prototype,n),Object.defineProperty(r,"prototype",{writable:!1}),r
var r,n}()
function ej(e){return(e=>{if(Array.isArray(e))return tj(e)})(e)||(e=>{if("undefined"!=typeof Symbol&&null!=e[Symbol.iterator]||null!=e["@@iterator"])return Array.from(e)})(e)||((e,t)=>{if(e){if("string"==typeof e)return tj(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?tj(e,t):void 0}})(e)||(()=>{throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()}function tj(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}ZO(QO,"displayName","ReferenceArea"),ZO(QO,"defaultProps",{isFront:!1,ifOverflow:"discard",xAxisId:0,yAxisId:0,r:10,fill:"#ccc",fillOpacity:.5,stroke:"none",strokeWidth:1}),ZO(QO,"renderRect",(e,t)=>o.isValidElement(e)?o.cloneElement(e,t):Dt(e)?e(t):o.createElement(Wg,WO({},t,{className:"recharts-reference-area-rect"})))
var rj,nj=(e,t,r,n,o)=>{var i=Or(e,IO),a=Or(e,qO),l=[].concat(ej(i),ej(a)),c=Or(e,QO),s="".concat(n,"Id"),u=n[0],f=t
if(l.length&&(f=l.reduce((e,t)=>{if(t.props[s]===r&&fx(t.props,"extendDomain")&&Kt(t.props[u])){var n=t.props[u]
return[Math.min(e[0],n),Math.max(e[1],n)]}return e},f)),c.length){var p="".concat(u,"1"),h="".concat(u,"2")
f=c.reduce((e,t)=>{if(t.props[s]===r&&fx(t.props,"extendDomain")&&Kt(t.props[p])&&Kt(t.props[h])){var n=t.props[p],o=t.props[h]
return[Math.min(e[0],n,o),Math.max(e[1],n,o)]}return e},f)}return o&&o.length&&(f=o.reduce((e,t)=>Kt(t)?[Math.min(e[0],t),Math.max(e[1],t)]:e,f)),f},oj={exports:{}},ij=new(r((rj||(rj=1,function(e){var t=Object.prototype.hasOwnProperty,r="~"
function n(){}function o(e,t,r){this.fn=e,this.context=t,this.once=r||!1}function i(e,t,n,i,a){if("function"!=typeof n)throw new TypeError("The listener must be a function")
var l=new o(n,i||e,a),c=r?r+t:t
return e._events[c]?e._events[c].fn?e._events[c]=[e._events[c],l]:e._events[c].push(l):(e._events[c]=l,e._eventsCount++),e}function a(e,t){0===--e._eventsCount?e._events=new n:delete e._events[t]}function l(){this._events=new n,this._eventsCount=0}Object.create&&(n.prototype=Object.create(null),(new n).__proto__||(r=!1)),l.prototype.eventNames=function(){var e,n,o=[]
if(0===this._eventsCount)return o
for(n in e=this._events)t.call(e,n)&&o.push(r?n.slice(1):n)
return Object.getOwnPropertySymbols?o.concat(Object.getOwnPropertySymbols(e)):o},l.prototype.listeners=function(e){var t=r?r+e:e,n=this._events[t]
if(!n)return[]
if(n.fn)return[n.fn]
for(var o=0,i=n.length,a=new Array(i);o<i;o++)a[o]=n[o].fn
return a},l.prototype.listenerCount=function(e){var t=r?r+e:e,n=this._events[t]
return n?n.fn?1:n.length:0},l.prototype.emit=function(e,t,n,o,i,a){var l=r?r+e:e
if(!this._events[l])return!1
var c,s,u=this._events[l],f=arguments.length
if(u.fn){switch(u.once&&this.removeListener(e,u.fn,void 0,!0),f){case 1:return u.fn.call(u.context),!0
case 2:return u.fn.call(u.context,t),!0
case 3:return u.fn.call(u.context,t,n),!0
case 4:return u.fn.call(u.context,t,n,o),!0
case 5:return u.fn.call(u.context,t,n,o,i),!0
case 6:return u.fn.call(u.context,t,n,o,i,a),!0}for(s=1,c=new Array(f-1);s<f;s++)c[s-1]=arguments[s]
u.fn.apply(u.context,c)}else{var p,h=u.length
for(s=0;s<h;s++)switch(u[s].once&&this.removeListener(e,u[s].fn,void 0,!0),f){case 1:u[s].fn.call(u[s].context)
break
case 2:u[s].fn.call(u[s].context,t)
break
case 3:u[s].fn.call(u[s].context,t,n)
break
case 4:u[s].fn.call(u[s].context,t,n,o)
break
default:if(!c)for(p=1,c=new Array(f-1);p<f;p++)c[p-1]=arguments[p]
u[s].fn.apply(u[s].context,c)}}return!0},l.prototype.on=function(e,t,r){return i(this,e,t,r,!1)},l.prototype.once=function(e,t,r){return i(this,e,t,r,!0)},l.prototype.removeListener=function(e,t,n,o){var i=r?r+e:e
if(!this._events[i])return this
if(!t)return a(this,i),this
var l=this._events[i]
if(l.fn)l.fn!==t||o&&!l.once||n&&l.context!==n||a(this,i)
else{for(var c=0,s=[],u=l.length;c<u;c++)(l[c].fn!==t||o&&!l[c].once||n&&l[c].context!==n)&&s.push(l[c])
s.length?this._events[i]=1===s.length?s[0]:s:a(this,i)}return this},l.prototype.removeAllListeners=function(e){var t
return e?(t=r?r+e:e,this._events[t]&&a(this,t)):(this._events=new n,this._eventsCount=0),this},l.prototype.off=l.prototype.removeListener,l.prototype.addListener=l.prototype.on,l.prefixed=r,l.EventEmitter=l,e.exports=l}(oj)),oj.exports))),aj="recharts.syncMouseEvents"
function lj(e){return(lj="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function cj(e,t,r){return(t=sj(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function sj(e){var t=(e=>{if("object"!=lj(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=lj(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==lj(t)?t:t+""}var uj=function(){return e=function e(){((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,e),cj(this,"activeIndex",0),cj(this,"coordinateList",[]),cj(this,"layout","horizontal")},(t=[{key:"setDetails",value:function(e){var t,r=e.coordinateList,n=void 0===r?null:r,o=e.container,i=void 0===o?null:o,a=e.layout,l=void 0===a?null:a,c=e.offset,s=void 0===c?null:c,u=e.mouseHandlerCallback,f=void 0===u?null:u
this.coordinateList=null!==(t=null!=n?n:this.coordinateList)&&void 0!==t?t:[],this.container=null!=i?i:this.container,this.layout=null!=l?l:this.layout,this.offset=null!=s?s:this.offset,this.mouseHandlerCallback=null!=f?f:this.mouseHandlerCallback,this.activeIndex=Math.min(Math.max(this.activeIndex,0),this.coordinateList.length-1)}},{key:"focus",value:function(){this.spoofMouse()}},{key:"keyboardEvent",value:function(e){if(0!==this.coordinateList.length)switch(e.key){case"ArrowRight":if("horizontal"!==this.layout)return
this.activeIndex=Math.min(this.activeIndex+1,this.coordinateList.length-1),this.spoofMouse()
break
case"ArrowLeft":if("horizontal"!==this.layout)return
this.activeIndex=Math.max(this.activeIndex-1,0),this.spoofMouse()}}},{key:"setIndex",value:function(e){this.activeIndex=e}},{key:"spoofMouse",value:function(){var e,t
if("horizontal"===this.layout&&0!==this.coordinateList.length){var r=this.container.getBoundingClientRect(),n=r.x,o=r.y,i=r.height,a=this.coordinateList[this.activeIndex].coordinate,l=(null===(e=window)||void 0===e?void 0:e.scrollX)||0,c=(null===(t=window)||void 0===t?void 0:t.scrollY)||0,s=n+a+l,u=o+this.offset.top+i/2+c
this.mouseHandlerCallback({pageX:s,pageY:u})}}}])&&((e,t)=>{for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,sj(n.key),n)}})(e.prototype,t),Object.defineProperty(e,"prototype",{writable:!1}),e
var e,t}()
function fj(e){var t=e.cx,r=e.cy,n=e.radius,o=e.startAngle,i=e.endAngle
return{points:[gm(t,r,n,o),gm(t,r,n,i)],cx:t,cy:r,radius:n,startAngle:o,endAngle:i}}function pj(e,t,r){var n,o,i,a
if("horizontal"===e)i=n=t.x,o=r.top,a=r.top+r.height
else if("vertical"===e)a=o=t.y,n=r.left,i=r.left+r.width
else if(null!=t.cx&&null!=t.cy){if("centric"!==e)return fj(t)
var l=t.cx,c=t.cy,s=t.innerRadius,u=t.outerRadius,f=t.angle,p=gm(l,c,s,f),h=gm(l,c,u,f)
n=p.x,o=p.y,i=h.x,a=h.y}return[{x:n,y:o},{x:i,y:a}]}function hj(e){return(hj="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function dj(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function yj(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?dj(Object(r),!0).forEach(t=>{var n,o,i,a
n=e,o=t,i=r[t],a=(e=>{if("object"!=hj(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=hj(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(o),(o="symbol"==hj(a)?a:a+"")in n?Object.defineProperty(n,o,{value:i,enumerable:!0,configurable:!0,writable:!0}):n[o]=i}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):dj(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function vj(t){var r,o,i,a=t.element,l=t.tooltipEventType,c=t.isActive,s=t.activeCoordinate,u=t.activePayload,f=t.offset,p=t.activeTooltipIndex,h=t.tooltipAxisBandSize,d=t.layout,y=t.chartName,v=null!==(r=a.props.cursor)&&void 0!==r?r:null===(o=a.type.defaultProps)||void 0===o?void 0:o.cursor
if(!a||!v||!c||!s||"ScatterChart"!==y&&"axis"!==l)return null
var m=hb
if("ScatterChart"===y)i=s,m=rw
else if("BarChart"===y)i=((e,t,r,n)=>{var o=n/2
return{stroke:"none",fill:"#ccc",x:"horizontal"===e?t.x-o:r.left+.5,y:"horizontal"===e?r.top+.5:t.y-o,width:"horizontal"===e?n:r.width-1,height:"horizontal"===e?r.height-1:n}})(d,s,f,h),m=Wg
else if("radial"===d){var b=fj(s),g=b.cx,w=b.cy,x=b.radius
i={cx:g,cy:w,startAngle:b.startAngle,endAngle:b.endAngle,innerRadius:x,outerRadius:x},m=Qm}else i={points:pj(d,s,f)},m=hb
var O=yj(yj(yj(yj({stroke:"#ccc",pointerEvents:"none"},f),i),Er(v,!1)),{},{payload:u,payloadIndex:p,className:e("recharts-tooltip-cursor",v.className)})
return n.isValidElement(v)?n.cloneElement(v,O):n.createElement(m,O)}var mj=["item"],bj=["children","className","width","height","style","compact","title","desc"]
function gj(e){return(gj="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function wj(){return wj=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var n in r)Object.prototype.hasOwnProperty.call(r,n)&&(e[n]=r[n])}return e},wj.apply(this,arguments)}function xj(e,t){return(e=>{if(Array.isArray(e))return e})(e)||((e,t)=>{var r=null==e?null:"undefined"!=typeof Symbol&&e[Symbol.iterator]||e["@@iterator"]
if(null!=r){var n,o,i,a,l=[],c=!0,s=!1
try{if(i=(r=r.call(e)).next,0===t);else for(;!(c=(n=i.call(r)).done)&&(l.push(n.value),l.length!==t);c=!0);}catch(u){s=!0,o=u}finally{try{if(!c&&null!=r.return&&(a=r.return(),Object(a)!==a))return}finally{if(s)throw o}}return l}})(e,t)||Ej(e,t)||(()=>{throw new TypeError("Invalid attempt to destructure non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()}function Oj(e,t){if(null==e)return{}
var r,n,o=((e,t)=>{if(null==e)return{}
var r={}
for(var n in e)if(Object.prototype.hasOwnProperty.call(e,n)){if(t.indexOf(n)>=0)continue
r[n]=e[n]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(n=0;n<i.length;n++)r=i[n],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(o[r]=e[r])}return o}function jj(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{}))}catch(t){}return(jj=()=>!!e)()}function Sj(e){return(Sj=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}function Pj(e,t){return(Pj=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function Aj(e){return(e=>{if(Array.isArray(e))return Mj(e)})(e)||(e=>{if("undefined"!=typeof Symbol&&null!=e[Symbol.iterator]||null!=e["@@iterator"])return Array.from(e)})(e)||Ej(e)||(()=>{throw new TypeError("Invalid attempt to spread non-iterable instance.\nIn order to be iterable, non-array objects must have a [Symbol.iterator]() method.")})()}function Ej(e,t){if(e){if("string"==typeof e)return Mj(e,t)
var r=Object.prototype.toString.call(e).slice(8,-1)
return"Object"===r&&e.constructor&&(r=e.constructor.name),"Map"===r||"Set"===r?Array.from(e):"Arguments"===r||/^(?:Ui|I)nt(?:8|16|32)(?:Clamped)?Array$/.test(r)?Mj(e,t):void 0}}function Mj(e,t){(null==t||t>e.length)&&(t=e.length)
for(var r=0,n=new Array(t);r<t;r++)n[r]=e[r]
return n}function _j(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(e)
t&&(n=n.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,n)}return r}function Tj(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?_j(Object(r),!0).forEach(t=>{kj(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):_j(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function kj(e,t,r){return(t=Cj(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function Cj(e){var t=(e=>{if("object"!=gj(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=gj(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==gj(t)?t:t+""}var Ij={xAxis:["bottom","top"],yAxis:["left","right"]},Dj={width:"100%",height:"100%"},Nj={x:0,y:0}
function Bj(e){return e}var Rj=(e,t)=>{var r=t.graphicalItems,n=t.dataStartIndex,o=t.dataEndIndex,i=(null!=r?r:[]).reduce((e,t)=>{var r=t.props.data
return r&&r.length?[].concat(Aj(e),Aj(r)):e},[])
return i.length>0?i:e&&e.length&&Kt(n)&&Kt(o)?e.slice(n,o+1):[]}
function Lj(e){return"number"===e?[0,"auto"]:void 0}var Uj=(e,t,r,n)=>{var o=e.graphicalItems,i=e.tooltipAxis,a=Rj(t,e)
return r<0||!o||!o.length||r>=a.length?null:o.reduce((o,l)=>{var c,s,u=null!==(c=l.props.data)&&void 0!==c?c:t
return u&&e.dataStartIndex+e.dataEndIndex!==0&&e.dataEndIndex-e.dataStartIndex>=r&&(u=u.slice(e.dataStartIndex,e.dataEndIndex+1)),(s=i.dataKey&&!i.allowDuplicatedCategory?nr(void 0===u?a:u,i.dataKey,n):u&&u[r]||a[r])?[].concat(Aj(o),[fm(l,s)]):o},[])},zj=(e,t,r,n)=>{var o=n||{x:e.chartX,y:e.chartY},i=((e,t)=>"horizontal"===t?e.x:"vertical"===t?e.y:"centric"===t?e.angle:e.radius)(o,r),a=e.orderedTooltipTicks,l=e.tooltipAxis,c=e.tooltipTicks,s=function(e){var t,r=arguments.length>1&&void 0!==arguments[1]?arguments[1]:[],n=arguments.length>2?arguments[2]:void 0,o=arguments.length>3?arguments[3]:void 0,i=-1,a=null!==(t=null==r?void 0:r.length)&&void 0!==t?t:0
if(a<=1)return 0
if(o&&"angleAxis"===o.axisType&&Math.abs(Math.abs(o.range[1]-o.range[0])-360)<=1e-6)for(var l=o.range,c=0;c<a;c++){var s=c>0?n[c-1].coordinate:n[a-1].coordinate,u=n[c].coordinate,f=c>=a-1?n[0].coordinate:n[c+1].coordinate,p=void 0
if(Yt(u-s)!==Yt(f-u)){var h=[]
if(Yt(f-u)===Yt(l[1]-l[0])){p=f
var d=u+l[1]-l[0]
h[0]=Math.min(d,(d+s)/2),h[1]=Math.max(d,(d+s)/2)}else{p=s
var y=f+l[1]-l[0]
h[0]=Math.min(u,(y+u)/2),h[1]=Math.max(u,(y+u)/2)}var v=[Math.min(u,(p+u)/2),Math.max(u,(p+u)/2)]
if(e>v[0]&&e<=v[1]||e>=h[0]&&e<=h[1]){i=n[c].index
break}}else{var m=Math.min(s,f),b=Math.max(s,f)
if(e>(m+u)/2&&e<=(b+u)/2){i=n[c].index
break}}}else for(var g=0;g<a;g++)if(0===g&&e<=(r[g].coordinate+r[g+1].coordinate)/2||g>0&&g<a-1&&e>(r[g].coordinate+r[g-1].coordinate)/2&&e<=(r[g].coordinate+r[g+1].coordinate)/2||g===a-1&&e>(r[g].coordinate+r[g-1].coordinate)/2){i=r[g].index
break}return i}(i,a,c,l)
if(s>=0&&c){var u=c[s]&&c[s].value,f=Uj(e,t,s,u),p=((e,t,r,n)=>{var o=t.find(e=>e&&e.index===r)
if(o){if("horizontal"===e)return{x:o.coordinate,y:n.y}
if("vertical"===e)return{x:n.x,y:o.coordinate}
if("centric"===e){var i=o.coordinate,a=n.radius
return Tj(Tj(Tj({},n),gm(n.cx,n.cy,a,i)),{},{angle:i,radius:a})}var l=o.coordinate,c=n.angle
return Tj(Tj(Tj({},n),gm(n.cx,n.cy,l,c)),{},{angle:c,radius:l})}return Nj})(r,a,s,o)
return{activeTooltipIndex:s,activeLabel:u,activePayload:f,activeCoordinate:p}}return null},$j=e=>{var t=e.children,r=e.defaultShowTooltip,n=jr(t,ix),o=0,i=0
return e.data&&0!==e.data.length&&(i=e.data.length-1),n&&n.props&&(n.props.startIndex>=0&&(o=n.props.startIndex),n.props.endIndex>=0&&(i=n.props.endIndex)),{chartX:0,chartY:0,dataStartIndex:o,dataEndIndex:i,activeTooltipIndex:-1,isTooltipActive:Boolean(r)}},Fj=e=>"horizontal"===e?{numericAxisName:"yAxis",cateAxisName:"xAxis"}:"vertical"===e?{numericAxisName:"xAxis",cateAxisName:"yAxis"}:"centric"===e?{numericAxisName:"radiusAxis",cateAxisName:"angleAxis"}:{numericAxisName:"angleAxis",cateAxisName:"radiusAxis"},qj=(e,t)=>"xAxis"===t?e[t].width:"yAxis"===t?e[t].height:void 0,Wj=function(t){var r=t.chartName,i=t.GraphicalChild,a=t.defaultTooltipEventType,l=void 0===a?"axis":a,c=t.validateTooltipEventTypes,s=void 0===c?["axis"]:c,u=t.axisComponents,f=t.legendContent,p=t.formatAxisMap,h=t.defaultProps,d=(e,t)=>{var n=e.props,o=e.dataStartIndex,a=e.dataEndIndex,l=e.updateId
if(!Sr({props:n}))return null
var c=n.children,s=n.layout,f=n.stackOffset,h=n.data,d=n.reverseStackOrder,y=Fj(s),v=y.numericAxisName,m=y.cateAxisName,b=Or(c,i),g=((e,t,r,n,o,i)=>{if(!e)return null
var a=(i?t.reverse():t).reduce((e,t)=>{var o,i=null!==(o=t.type)&&void 0!==o&&o.defaultProps?Uv(Uv({},t.type.defaultProps),t.props):t.props,a=i.stackId
if(i.hide)return e
var l=i[r],c=e[l]||{hasStack:!1,stackGroups:{}}
if(Zt(a)){var s=c.stackGroups[a]||{numericAxisId:r,cateAxisId:n,items:[]}
s.items.push(t),c.hasStack=!0,c.stackGroups[a]=s}else c.stackGroups[Qt("_stackId_")]={numericAxisId:r,cateAxisId:n,items:[t]}
return Uv(Uv({},e),{},zv({},l,c))},{})
return Object.keys(a).reduce((t,i)=>{var l=a[i]
return l.hasStack&&(l.stackGroups=Object.keys(l.stackGroups).reduce((t,i)=>{var a=l.stackGroups[i]
return Uv(Uv({},t),{},zv({},i,{numericAxisId:r,cateAxisId:n,items:a.items,stackedData:tm(e,a.items,o)}))},{})),Uv(Uv({},t),{},zv({},i,l))},{})})(h,b,"".concat(v,"Id"),"".concat(m,"Id"),f,d),w=u.reduce((e,t)=>{var r="".concat(t.axisType,"Map")
return Tj(Tj({},e),{},kj({},r,((e,t)=>{var r=t.axisType,n=void 0===r?"xAxis":r,o=t.AxisComp,i=t.graphicalItems,a=t.stackGroups,l=t.dataStartIndex,c=t.dataEndIndex,s=e.children,u="".concat(n,"Id"),f=Or(s,o),p={}
return f&&f.length?p=((e,t)=>{var r=t.axes,n=t.graphicalItems,o=t.axisType,i=t.axisIdKey,a=t.stackGroups,l=t.dataStartIndex,c=t.dataEndIndex,s=e.layout,u=e.children,f=e.stackOffset,p=Hv(s,o)
return r.reduce((t,r)=>{var h,d=void 0!==r.type.defaultProps?Tj(Tj({},r.type.defaultProps),r.props):r.props,y=d.type,v=d.dataKey,m=d.allowDataOverflow,b=d.allowDuplicatedCategory,g=d.scale,w=d.ticks,x=d.includeHidden,O=d[i]
if(t[O])return t
var j,S,P,A=Rj(e.data,{graphicalItems:n.filter(e=>{var t
return(i in e.props?e.props[i]:null===(t=e.type.defaultProps)||void 0===t?void 0:t[i])===O}),dataStartIndex:l,dataEndIndex:c}),E=A.length;((e,t,r)=>{if("number"===r&&!0===t&&Array.isArray(e)){var n=null==e?void 0:e[0],o=null==e?void 0:e[1]
if(n&&o&&Kt(n)&&Kt(o))return!0}return!1})(d.domain,m,y)&&(j=cm(d.domain,null,m),!p||"number"!==y&&"auto"===g||(P=Fv(A,v,"category")))
var M=Lj(y)
if(!j||0===j.length){var _,T=null!==(_=d.domain)&&void 0!==_?_:M
if(v){if(j=Fv(A,v,y),"category"===y&&p){var k=(e=>{if(!Array.isArray(e))return!1
for(var t=e.length,r={},n=0;n<t;n++){if(r[e[n]])return!0
r[e[n]]=!0}return!1})(j)
b&&k?(S=j,j=Lw(0,E)):b||(j=um(T,j,r).reduce((e,t)=>e.indexOf(t)>=0?e:[].concat(Aj(e),[t]),[]))}else if("category"===y)j=b?j.filter(e=>""!==e&&!Tt(e)):um(T,j,r).reduce((e,t)=>e.indexOf(t)>=0||""===t||Tt(t)?e:[].concat(Aj(e),[t]),[])
else if("number"===y){var C=((e,t,r,n,o)=>{var i=t.map(t=>Wv(e,t,r,o,n)).filter(e=>!Tt(e))
return i&&i.length?i.reduce((e,t)=>[Math.min(e[0],t[0]),Math.max(e[1],t[1])],[1/0,-1/0]):null})(A,n.filter(e=>{var t,r,n=i in e.props?e.props[i]:null===(t=e.type.defaultProps)||void 0===t?void 0:t[i],o="hide"in e.props?e.props.hide:null===(r=e.type.defaultProps)||void 0===r?void 0:r.hide
return n===O&&(x||!o)}),v,o,s)
C&&(j=C)}!p||"number"!==y&&"auto"===g||(P=Fv(A,v,"category"))}else j=p?Lw(0,E):a&&a[O]&&a[O].hasStack&&"number"===y?"expand"===f?[0,1]:im(a[O].stackGroups,l,c):Xv(A,n.filter(e=>{var t=i in e.props?e.props[i]:e.type.defaultProps[i],r="hide"in e.props?e.props.hide:e.type.defaultProps.hide
return t===O&&(x||!r)}),y,s,!0)
if("number"===y)j=nj(u,j,O,o,w),T&&(j=cm(T,j,m))
else if("category"===y&&T){var I=T
j.every(e=>I.indexOf(e)>=0)&&(j=I)}}return Tj(Tj({},t),{},kj({},O,Tj(Tj({},d),{},{axisType:o,domain:j,categoricalDomain:P,duplicateDomain:S,originalDomain:null!==(h=d.domain)&&void 0!==h?h:M,isCategorical:p,layout:s})))},{})})(e,{axes:f,graphicalItems:i,axisType:n,axisIdKey:u,stackGroups:a,dataStartIndex:l,dataEndIndex:c}):i&&i.length&&(p=((e,t)=>{var r=t.graphicalItems,n=t.Axis,o=t.axisType,i=t.axisIdKey,a=t.stackGroups,l=t.dataStartIndex,c=t.dataEndIndex,s=e.layout,u=e.children,f=Rj(e.data,{graphicalItems:r,dataStartIndex:l,dataEndIndex:c}),p=f.length,h=Hv(s,o),d=-1
return r.reduce((e,t)=>{var y,v=(void 0!==t.type.defaultProps?Tj(Tj({},t.type.defaultProps),t.props):t.props)[i],m=Lj("number")
return e[v]?e:(d++,h?y=Lw(0,p):a&&a[v]&&a[v].hasStack?(y=im(a[v].stackGroups,l,c),y=nj(u,y,v,o)):(y=cm(m,Xv(f,r.filter(e=>{var t,r,n=i in e.props?e.props[i]:null===(t=e.type.defaultProps)||void 0===t?void 0:t[i],o="hide"in e.props?e.props.hide:null===(r=e.type.defaultProps)||void 0===r?void 0:r.hide
return n===v&&!o}),"number",s),n.defaultProps.allowDataOverflow),y=nj(u,y,v,o)),Tj(Tj({},e),{},kj({},v,Tj(Tj({axisType:o},n.defaultProps),{},{hide:!0,orientation:Et(Ij,"".concat(o,".").concat(d%2),null),domain:y,originalDomain:m,isCategorical:h,layout:s}))))},{})})(e,{Axis:o,graphicalItems:i,axisType:n,axisIdKey:u,stackGroups:a,dataStartIndex:l,dataEndIndex:c})),p})(n,Tj(Tj({},t),{},{graphicalItems:b,stackGroups:t.axisType===v&&g,dataStartIndex:o,dataEndIndex:a}))))},{}),x=((e,t)=>{var r=e.props,n=(e.graphicalItems,e.xAxisMap),o=void 0===n?{}:n,i=e.yAxisMap,a=void 0===i?{}:i,l=r.width,c=r.height,s=r.children,u=r.margin||{},f=jr(s,ix),p=jr(s,Dc),h=Object.keys(a).reduce((e,t)=>{var r=a[t],n=r.orientation
return r.mirror||r.hide?e:Tj(Tj({},e),{},kj({},n,e[n]+r.width))},{left:u.left||0,right:u.right||0}),d=Object.keys(o).reduce((e,t)=>{var r=o[t],n=r.orientation
return r.mirror||r.hide?e:Tj(Tj({},e),{},kj({},n,Et(e,"".concat(n))+r.height))},{top:u.top||0,bottom:u.bottom||0}),y=Tj(Tj({},d),h),v=y.bottom
f&&(y.bottom+=f.props.height||ix.defaultProps.height),p&&t&&(y=((e,t,r,n)=>{var o=r.children,i=r.width,a=r.margin,l=i-(a.left||0)-(a.right||0),c=Dv({children:o,legendWidth:l})
if(c){var s=n||{},u=s.width,f=s.height,p=c.align,h=c.verticalAlign,d=c.layout
if(("vertical"===d||"horizontal"===d&&"middle"===h)&&"center"!==p&&Kt(e[p]))return Uv(Uv({},e),{},zv({},p,e[p]+(u||0)))
if(("horizontal"===d||"vertical"===d&&"center"===p)&&"middle"!==h&&Kt(e[h]))return Uv(Uv({},e),{},zv({},h,e[h]+(f||0)))}return e})(y,0,r,t))
var m=l-y.left-y.right,b=c-y.top-y.bottom
return Tj(Tj({brushBottom:v},y),{},{width:Math.max(m,0),height:Math.max(b,0)})})(Tj(Tj({},w),{},{props:n,graphicalItems:b}),null==t?void 0:t.legendBBox)
Object.keys(w).forEach(e=>{w[e]=p(n,w[e],x,e.replace("Map",""),r)})
var O,j,S=w["".concat(m,"Map")],P=(O=tr(S),{tooltipTicks:j=Yv(O,!1,!0),orderedTooltipTicks:$c(j,e=>e.coordinate),tooltipAxis:O,tooltipAxisBandSize:sm(O,j)}),A=((e,t)=>{var r=t.graphicalItems,n=t.stackGroups,o=t.offset,i=t.updateId,a=t.dataStartIndex,l=t.dataEndIndex,c=e.barSize,s=e.layout,f=e.barGap,p=e.barCategoryGap,h=e.maxBarSize,d=Fj(s),y=d.numericAxisName,v=d.cateAxisName,m=(e=>!(!e||!e.length)&&e.some(e=>{var t=br(e&&e.type)
return t&&t.indexOf("Bar")>=0}))(r),b=[]
return r.forEach((r,d)=>{var g=Rj(e.data,{graphicalItems:[r],dataStartIndex:a,dataEndIndex:l}),w=void 0!==r.type.defaultProps?Tj(Tj({},r.type.defaultProps),r.props):r.props,x=w.dataKey,O=w.maxBarSize,j=w["".concat(y,"Id")],S=w["".concat(v,"Id")],P=u.reduce((e,r)=>{var n=t["".concat(r.axisType,"Map")],o=w["".concat(r.axisType,"Id")]
n&&n[o]||"zAxis"===r.axisType||wv()
var i=n[o]
return Tj(Tj({},e),{},kj(kj({},r.axisType,i),"".concat(r.axisType,"Ticks"),Yv(i)))},{}),A=P[v],E=P["".concat(v,"Ticks")],M=n&&n[j]&&n[j].hasStack&&((e,t)=>{var r,n=(null!==(r=e.type)&&void 0!==r&&r.defaultProps?Uv(Uv({},e.type.defaultProps),e.props):e.props).stackId
if(Zt(n)){var o=t[n]
if(o){var i=o.items.indexOf(e)
return i>=0?o.stackedData[i]:null}}return null})(r,n[j].stackGroups),_=br(r.type).indexOf("Bar")>=0,T=sm(A,E),k=[],C=m&&(e=>{var t=e.barSize,r=e.totalSize,n=e.stackGroups,o=void 0===n?{}:n
if(!o)return{}
for(var i={},a=Object.keys(o),l=0,c=a.length;l<c;l++)for(var s=o[a[l]].stackGroups,u=Object.keys(s),f=0,p=u.length;f<p;f++){var h=s[u[f]],d=h.items,y=h.cateAxisId,v=d.filter(e=>br(e.type).indexOf("Bar")>=0)
if(v&&v.length){var m=v[0].type.defaultProps,b=void 0!==m?Uv(Uv({},m),v[0].props):v[0].props,g=b.barSize,w=b[y]
i[w]||(i[w]=[])
var x=Tt(g)?t:g
i[w].push({item:v[0],stackList:v.slice(1),barSize:Tt(x)?void 0:er(x,r,0)})}}return i})({barSize:c,stackGroups:n,totalSize:qj(P,v)})
if(_){var I,D,N=Tt(O)?h:O,B=null!==(I=null!==(D=sm(A,E,!0))&&void 0!==D?D:N)&&void 0!==I?I:0
k=(e=>{var t=e.barGap,r=e.barCategoryGap,n=e.bandSize,o=e.sizeList,i=void 0===o?[]:o,a=e.maxBarSize,l=i.length
if(l<1)return null
var c,s=er(t,n,0,!0),u=[]
if(i[0].barSize===+i[0].barSize){var f=!1,p=n/l,h=i.reduce((e,t)=>e+t.barSize||0,0);(h+=(l-1)*s)>=n&&(h-=(l-1)*s,s=0),h>=n&&p>0&&(f=!0,h=l*(p*=.9))
var d={offset:((n-h)/2|0)-s,size:0}
c=i.reduce((e,t)=>{var r={item:t.item,position:{offset:d.offset+d.size+s,size:f?p:t.barSize}},n=[].concat(Bv(e),[r])
return d=n[n.length-1].position,t.stackList&&t.stackList.length&&t.stackList.forEach(e=>{n.push({item:e,position:d})}),n},u)}else{var y=er(r,n,0,!0)
n-2*y-(l-1)*s<=0&&(s=0)
var v=(n-2*y-(l-1)*s)/l
v>1&&(v>>=0)
var m=a===+a?Math.min(v,a):v
c=i.reduce((e,t,r)=>{var n=[].concat(Bv(e),[{item:t.item,position:{offset:y+(v+s)*r+(v-m)/2,size:m}}])
return t.stackList&&t.stackList.length&&t.stackList.forEach(e=>{n.push({item:e,position:n[n.length-1].position})}),n},u)}return c})({barGap:f,barCategoryGap:p,bandSize:B!==T?B:T,sizeList:C[S],maxBarSize:N}),B!==T&&(k=k.map(e=>Tj(Tj({},e),{},{position:Tj(Tj({},e.position),{},{offset:e.position.offset-B/2})})))}var R,L,U=r&&r.type&&r.type.getComposedData
U&&b.push({props:Tj(Tj({},U(Tj(Tj({},P),{},{displayedData:g,props:e,dataKey:x,item:r,bandSize:T,barPosition:k,offset:o,stackedData:M,layout:s,dataStartIndex:a,dataEndIndex:l}))),{},kj(kj(kj({key:r.key||"item-".concat(d)},y,P[y]),v,P[v]),"animationId",i)),childIndex:(R=r,L=e.children,xr(L).indexOf(R)),item:r})}),b})(n,Tj(Tj({},w),{},{dataStartIndex:o,dataEndIndex:a,updateId:l,graphicalItems:b,stackGroups:g,offset:x}))
return Tj(Tj({formattedGraphicalItems:A,graphicalItems:b,offset:x,stackGroups:g},P),w)},y=function(){function t(i){var a,l,c,s,u,p
return((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,t),kj((s=this,p=[i],u=Sj(u=t),c=((e,t)=>{if(t&&("object"===gj(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return(e=>{if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e})(e)})(s,jj()?Reflect.construct(u,p||[],Sj(s).constructor):u.apply(s,p))),"eventEmitterSymbol",Symbol("rechartsEventEmitter")),kj(c,"accessibilityManager",new uj),kj(c,"handleLegendBBoxUpdate",e=>{if(e){var t=c.state,r=t.dataStartIndex,n=t.dataEndIndex,o=t.updateId
c.setState(Tj({legendBBox:e},d({props:c.props,dataStartIndex:r,dataEndIndex:n,updateId:o},Tj(Tj({},c.state),{},{legendBBox:e}))))}}),kj(c,"handleReceiveSyncEvent",(e,t,r)=>{if(c.props.syncId===e){if(r===c.eventEmitterSymbol&&"function"!=typeof c.props.syncMethod)return
c.applySyncEvent(t)}}),kj(c,"handleBrushChange",e=>{var t=e.startIndex,r=e.endIndex
if(t!==c.state.dataStartIndex||r!==c.state.dataEndIndex){var n=c.state.updateId
c.setState(()=>Tj({dataStartIndex:t,dataEndIndex:r},d({props:c.props,dataStartIndex:t,dataEndIndex:r,updateId:n},c.state))),c.triggerSyncEvent({dataStartIndex:t,dataEndIndex:r})}}),kj(c,"handleMouseEnter",e=>{var t=c.getMouseInfo(e)
if(t){var r=Tj(Tj({},t),{},{isTooltipActive:!0})
c.setState(r),c.triggerSyncEvent(r)
var n=c.props.onMouseEnter
Dt(n)&&n(r,e)}}),kj(c,"triggeredAfterMouseMove",e=>{var t=c.getMouseInfo(e),r=t?Tj(Tj({},t),{},{isTooltipActive:!0}):{isTooltipActive:!1}
c.setState(r),c.triggerSyncEvent(r)
var n=c.props.onMouseMove
Dt(n)&&n(r,e)}),kj(c,"handleItemMouseEnter",e=>{c.setState(()=>({isTooltipActive:!0,activeItem:e,activePayload:e.tooltipPayload,activeCoordinate:e.tooltipPosition||{x:e.cx,y:e.cy}}))}),kj(c,"handleItemMouseLeave",()=>{c.setState(()=>({isTooltipActive:!1}))}),kj(c,"handleMouseMove",e=>{e.persist(),c.throttleTriggeredAfterMouseMove(e)}),kj(c,"handleMouseLeave",e=>{c.throttleTriggeredAfterMouseMove.cancel()
var t={isTooltipActive:!1}
c.setState(t),c.triggerSyncEvent(t)
var r=c.props.onMouseLeave
Dt(r)&&r(t,e)}),kj(c,"handleOuterEvent",e=>{var t,r=(e=>{var t=e&&e.type
return t&&mr[t]?mr[t]:null})(e),n=Et(c.props,"".concat(r))
r&&Dt(n)&&n(null!==(t=/.*touch.*/i.test(r)?c.getMouseInfo(e.changedTouches[0]):c.getMouseInfo(e))&&void 0!==t?t:{},e)}),kj(c,"handleClick",e=>{var t=c.getMouseInfo(e)
if(t){var r=Tj(Tj({},t),{},{isTooltipActive:!0})
c.setState(r),c.triggerSyncEvent(r)
var n=c.props.onClick
Dt(n)&&n(r,e)}}),kj(c,"handleMouseDown",e=>{var t=c.props.onMouseDown
Dt(t)&&t(c.getMouseInfo(e),e)}),kj(c,"handleMouseUp",e=>{var t=c.props.onMouseUp
Dt(t)&&t(c.getMouseInfo(e),e)}),kj(c,"handleTouchMove",e=>{null!=e.changedTouches&&e.changedTouches.length>0&&c.throttleTriggeredAfterMouseMove(e.changedTouches[0])}),kj(c,"handleTouchStart",e=>{null!=e.changedTouches&&e.changedTouches.length>0&&c.handleMouseDown(e.changedTouches[0])}),kj(c,"handleTouchEnd",e=>{null!=e.changedTouches&&e.changedTouches.length>0&&c.handleMouseUp(e.changedTouches[0])}),kj(c,"handleDoubleClick",e=>{var t=c.props.onDoubleClick
Dt(t)&&t(c.getMouseInfo(e),e)}),kj(c,"handleContextMenu",e=>{var t=c.props.onContextMenu
Dt(t)&&t(c.getMouseInfo(e),e)}),kj(c,"triggerSyncEvent",e=>{void 0!==c.props.syncId&&ij.emit(aj,c.props.syncId,e,c.eventEmitterSymbol)}),kj(c,"applySyncEvent",e=>{var t=c.props,r=t.layout,n=t.syncMethod,o=c.state.updateId,i=e.dataStartIndex,a=e.dataEndIndex
if(void 0!==e.dataStartIndex||void 0!==e.dataEndIndex)c.setState(Tj({dataStartIndex:i,dataEndIndex:a},d({props:c.props,dataStartIndex:i,dataEndIndex:a,updateId:o},c.state)))
else if(void 0!==e.activeTooltipIndex){var l=e.chartX,s=e.chartY,u=e.activeTooltipIndex,f=c.state,p=f.offset,h=f.tooltipTicks
if(!p)return
if("function"==typeof n)u=n(h,e)
else if("value"===n){u=-1
for(var y=0;y<h.length;y++)if(h[y].value===e.activeLabel){u=y
break}}var v=Tj(Tj({},p),{},{x:p.left,y:p.top}),m=Math.min(l,v.x+v.width),b=Math.min(s,v.y+v.height),g=h[u]&&h[u].value,w=Uj(c.state,c.props.data,u),x=h[u]?{x:"horizontal"===r?h[u].coordinate:m,y:"horizontal"===r?b:h[u].coordinate}:Nj
c.setState(Tj(Tj({},e),{},{activeLabel:g,activeCoordinate:x,activePayload:w,activeTooltipIndex:u}))}else c.setState(e)}),kj(c,"renderCursor",e=>{var t,n=c.state,i=n.isTooltipActive,a=n.activeCoordinate,l=n.activePayload,s=n.offset,u=n.activeTooltipIndex,f=n.tooltipAxisBandSize,p=c.getTooltipEventType(),h=null!==(t=e.props.active)&&void 0!==t?t:i,d=c.props.layout,y=e.key||"_recharts-cursor"
return o.createElement(vj,{key:y,activeCoordinate:a,activePayload:l,activeTooltipIndex:u,chartName:r,element:e,isActive:h,layout:d,offset:s,tooltipAxisBandSize:f,tooltipEventType:p})}),kj(c,"renderPolarAxis",(t,r,o)=>{var i=Et(t,"type.axisType"),a=Et(c.state,"".concat(i,"Map")),l=t.type.defaultProps,s=void 0!==l?Tj(Tj({},l),t.props):t.props,u=a&&a[s["".concat(i,"Id")]]
return n.cloneElement(t,Tj(Tj({},u),{},{className:e(i,u.className),key:t.key||"".concat(r,"-").concat(o),ticks:Yv(u,!0)}))}),kj(c,"renderPolarGrid",e=>{var t=e.props,r=t.radialLines,o=t.polarAngles,i=t.polarRadius,a=c.state,l=a.radiusAxisMap,s=a.angleAxisMap,u=tr(l),f=tr(s),p=f.cx,h=f.cy,d=f.innerRadius,y=f.outerRadius
return n.cloneElement(e,{polarAngles:Array.isArray(o)?o:Yv(f,!0).map(e=>e.coordinate),polarRadius:Array.isArray(i)?i:Yv(u,!0).map(e=>e.coordinate),cx:p,cy:h,innerRadius:d,outerRadius:y,key:e.key||"polar-grid",radialLines:r})}),kj(c,"renderLegend",()=>{var e=c.state.formattedGraphicalItems,t=c.props,r=t.children,o=t.width,i=t.height,a=c.props.margin||{},l=o-(a.left||0)-(a.right||0),s=Dv({children:r,formattedGraphicalItems:e,legendWidth:l,legendContent:f})
if(!s)return null
var u=s.item,p=Oj(s,mj)
return n.cloneElement(u,Tj(Tj({},p),{},{chartWidth:o,chartHeight:i,margin:a,onBBoxUpdate:c.handleLegendBBoxUpdate}))}),kj(c,"renderTooltip",()=>{var e,t=c.props,r=t.children,o=t.accessibilityLayer,i=jr(r,Cs)
if(!i)return null
var a=c.state,l=a.isTooltipActive,s=a.activeCoordinate,u=a.activePayload,f=a.activeLabel,p=a.offset,h=null!==(e=i.props.active)&&void 0!==e?e:l
return n.cloneElement(i,{viewBox:Tj(Tj({},p),{},{x:p.left,y:p.top}),active:h,label:f,payload:h?u:[],coordinate:s,accessibilityLayer:o})}),kj(c,"renderBrush",e=>{var t=c.props,r=t.margin,o=t.data,i=c.state,a=i.offset,l=i.dataStartIndex,s=i.dataEndIndex,u=i.updateId
return n.cloneElement(e,{key:e.key||"_recharts-brush",onChange:Kv(c.handleBrushChange,e.props.onChange),data:o,x:Kt(e.props.x)?e.props.x:a.left,y:Kt(e.props.y)?e.props.y:a.top+a.height+a.brushBottom-(r.bottom||0),width:Kt(e.props.width)?e.props.width:a.width,startIndex:l,endIndex:s,updateId:"brush-".concat(u)})}),kj(c,"renderReferenceElement",(e,t,r)=>{if(!e)return null
var o=c.clipPathId,i=c.state,a=i.xAxisMap,l=i.yAxisMap,s=i.offset,u=e.type.defaultProps||{},f=e.props,p=f.xAxisId,h=void 0===p?u.xAxisId:p,d=f.yAxisId,y=void 0===d?u.yAxisId:d
return n.cloneElement(e,{key:e.key||"".concat(t,"-").concat(r),xAxis:a[h],yAxis:l[y],viewBox:{x:s.left,y:s.top,width:s.width,height:s.height},clipPathId:o})}),kj(c,"renderActivePoints",e=>{var r=e.item,n=e.activePoint,o=e.basePoint,i=e.childIndex,a=e.isRange,l=[],c=r.props.key,s=void 0!==r.item.type.defaultProps?Tj(Tj({},r.item.type.defaultProps),r.item.props):r.item.props,u=s.activeDot,f=Tj(Tj({index:i,dataKey:s.dataKey,cx:n.x,cy:n.y,r:4,fill:qv(r.item),strokeWidth:2,stroke:"#fff",payload:n.payload,value:n.value},Er(u,!1)),fr(u))
return l.push(t.renderActiveDot(u,f,"".concat(c,"-activePoint-").concat(i))),o?l.push(t.renderActiveDot(u,Tj(Tj({},f),{},{cx:o.x,cy:o.y}),"".concat(c,"-basePoint-").concat(i))):a&&l.push(null),l}),kj(c,"renderGraphicChild",(e,t,r)=>{var o=c.filterFormatItem(e,t,r)
if(!o)return null
var i=c.getTooltipEventType(),a=c.state,l=a.isTooltipActive,s=a.tooltipAxis,u=a.activeTooltipIndex,f=a.activeLabel,p=jr(c.props.children,Cs),h=o.props,d=h.points,y=h.isRange,v=h.baseLine,m=void 0!==o.item.type.defaultProps?Tj(Tj({},o.item.type.defaultProps),o.item.props):o.item.props,b=m.activeDot,g=m.hide,w=m.activeBar,x=m.activeShape,O=Boolean(!g&&l&&p&&(b||w||x)),j={}
"axis"!==i&&p&&"click"===p.props.trigger?j={onClick:Kv(c.handleItemMouseEnter,e.props.onClick)}:"axis"!==i&&(j={onMouseLeave:Kv(c.handleItemMouseLeave,e.props.onMouseLeave),onMouseEnter:Kv(c.handleItemMouseEnter,e.props.onMouseEnter)})
var S=n.cloneElement(e,Tj(Tj({},o.props),j))
if(O){if(!(u>=0)){var P,A=(null!==(P=c.getItemByXY(c.state.activeCoordinate))&&void 0!==P?P:{graphicalItem:S}).graphicalItem,E=A.item,M=void 0===E?e:E,_=A.childIndex,T=Tj(Tj(Tj({},o.props),j),{},{activeIndex:_})
return[n.cloneElement(M,T),null,null]}var k,C
if(s.dataKey&&!s.allowDuplicatedCategory){var I="function"==typeof s.dataKey?e=>"function"==typeof s.dataKey?s.dataKey(e.payload):null:"payload.".concat(s.dataKey.toString())
k=nr(d,I,f),C=y&&v&&nr(v,I,f)}else k=null==d?void 0:d[u],C=y&&v&&v[u]
if(x||w){var D=void 0!==e.props.activeIndex?e.props.activeIndex:u
return[n.cloneElement(e,Tj(Tj(Tj({},o.props),j),{},{activeIndex:D})),null,null]}if(!Tt(k))return[S].concat(Aj(c.renderActivePoints({item:o,activePoint:k,basePoint:C,childIndex:u,isRange:y})))}return y?[S,null,null]:[S,null]}),kj(c,"renderCustomized",(e,t,r)=>n.cloneElement(e,Tj(Tj({key:"recharts-customized-".concat(r)},c.props),c.state))),kj(c,"renderMap",{CartesianGrid:{handler:Bj,once:!0},ReferenceArea:{handler:c.renderReferenceElement},ReferenceLine:{handler:Bj},ReferenceDot:{handler:c.renderReferenceElement},XAxis:{handler:Bj},YAxis:{handler:Bj},Brush:{handler:c.renderBrush,once:!0},Bar:{handler:c.renderGraphicChild},Line:{handler:c.renderGraphicChild},Area:{handler:c.renderGraphicChild},Radar:{handler:c.renderGraphicChild},RadialBar:{handler:c.renderGraphicChild},Scatter:{handler:c.renderGraphicChild},Pie:{handler:c.renderGraphicChild},Funnel:{handler:c.renderGraphicChild},Tooltip:{handler:c.renderCursor,once:!0},PolarGrid:{handler:c.renderPolarGrid,once:!0},PolarAngleAxis:{handler:c.renderPolarAxis},PolarRadiusAxis:{handler:c.renderPolarAxis},Customized:{handler:c.renderCustomized}}),c.clipPathId="".concat(null!==(a=i.id)&&void 0!==a?a:Qt("recharts"),"-clip"),c.throttleTriggeredAfterMouseMove=Ds(c.triggeredAfterMouseMove,null!==(l=i.throttleDelay)&&void 0!==l?l:1e3/60),c.state={},c}return((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&Pj(e,t)})(t,n.Component),i=t,a=[{key:"componentDidMount",value:function(){var e,t
this.addListener(),this.accessibilityManager.setDetails({container:this.container,offset:{left:null!==(e=this.props.margin.left)&&void 0!==e?e:0,top:null!==(t=this.props.margin.top)&&void 0!==t?t:0},coordinateList:this.state.tooltipTicks,mouseHandlerCallback:this.triggeredAfterMouseMove,layout:this.props.layout}),this.displayDefaultTooltip()}},{key:"displayDefaultTooltip",value:function(){var e=this.props,t=e.children,r=e.data,n=e.height,o=e.layout,i=jr(t,Cs)
if(i){var a=i.props.defaultIndex
if(!("number"!=typeof a||a<0||a>this.state.tooltipTicks.length-1)){var l=this.state.tooltipTicks[a]&&this.state.tooltipTicks[a].value,c=Uj(this.state,r,a,l),s=this.state.tooltipTicks[a].coordinate,u=(this.state.offset.top+n)/2,f="horizontal"===o?{x:s,y:u}:{y:s,x:u},p=this.state.formattedGraphicalItems.find(e=>"Scatter"===e.item.type.name)
p&&(f=Tj(Tj({},f),p.props.points[a].tooltipPosition),c=p.props.points[a].tooltipPayload)
var h={activeTooltipIndex:a,isTooltipActive:!0,activeLabel:l,activePayload:c,activeCoordinate:f}
this.setState(h),this.renderCursor(i),this.accessibilityManager.setIndex(a)}}}},{key:"getSnapshotBeforeUpdate",value:function(e,t){return this.props.accessibilityLayer?(this.state.tooltipTicks!==t.tooltipTicks&&this.accessibilityManager.setDetails({coordinateList:this.state.tooltipTicks}),this.props.layout!==e.layout&&this.accessibilityManager.setDetails({layout:this.props.layout}),this.props.margin!==e.margin&&this.accessibilityManager.setDetails({offset:{left:null!==(r=this.props.margin.left)&&void 0!==r?r:0,top:null!==(n=this.props.margin.top)&&void 0!==n?n:0}}),null):null
var r,n}},{key:"componentDidUpdate",value:function(e){Mr([jr(e.children,Cs)],[jr(this.props.children,Cs)])||this.displayDefaultTooltip()}},{key:"componentWillUnmount",value:function(){this.removeListener(),this.throttleTriggeredAfterMouseMove.cancel()}},{key:"getTooltipEventType",value:function(){var e=jr(this.props.children,Cs)
if(e&&"boolean"==typeof e.props.shared){var t=e.props.shared?"axis":"item"
return s.indexOf(t)>=0?t:l}return l}},{key:"getMouseInfo",value:function(e){if(!this.container)return null
var t,r=this.container,n=r.getBoundingClientRect(),o=(t=n).top+window.scrollY-document.documentElement.clientTop,i=t.left+window.scrollX-document.documentElement.clientLeft,a={chartX:Math.round(e.pageX-i),chartY:Math.round(e.pageY-o)},l=n.width/r.offsetWidth||1,c=this.inRange(a.chartX,a.chartY,l)
if(!c)return null
var s=this.state,u=s.xAxisMap,f=s.yAxisMap,p=this.getTooltipEventType(),h=zj(this.state,this.props.data,this.props.layout,c)
if("axis"!==p&&u&&f){var d=tr(u).scale,y=tr(f).scale,v=d&&d.invert?d.invert(a.chartX):null,m=y&&y.invert?y.invert(a.chartY):null
return Tj(Tj({},a),{},{xValue:v,yValue:m},h)}return h?Tj(Tj({},a),h):null}},{key:"inRange",value:function(e,t){var r=arguments.length>2&&void 0!==arguments[2]?arguments[2]:1,n=this.props.layout,o=e/r,i=t/r
if("horizontal"===n||"vertical"===n){var a=this.state.offset
return o>=a.left&&o<=a.left+a.width&&i>=a.top&&i<=a.top+a.height?{x:o,y:i}:null}var l=this.state,c=l.angleAxisMap,s=l.radiusAxisMap
if(c&&s){var u=tr(c)
return jm({x:o,y:i},u)}return null}},{key:"parseEventsOfWrapper",value:function(){var e=this.props.children,t=this.getTooltipEventType(),r=jr(e,Cs),n={}
return r&&"axis"===t&&(n="click"===r.props.trigger?{onClick:this.handleClick}:{onMouseEnter:this.handleMouseEnter,onDoubleClick:this.handleDoubleClick,onMouseMove:this.handleMouseMove,onMouseLeave:this.handleMouseLeave,onTouchMove:this.handleTouchMove,onTouchStart:this.handleTouchStart,onTouchEnd:this.handleTouchEnd,onContextMenu:this.handleContextMenu}),Tj(Tj({},fr(this.props,this.handleOuterEvent)),n)}},{key:"addListener",value:function(){ij.on(aj,this.handleReceiveSyncEvent)}},{key:"removeListener",value:function(){ij.removeListener(aj,this.handleReceiveSyncEvent)}},{key:"filterFormatItem",value:function(e,t,r){for(var n=this.state.formattedGraphicalItems,o=0,i=n.length;o<i;o++){var a=n[o]
if(a.item===e||a.props.key===e.key||t===br(a.item.type)&&r===a.childIndex)return a}return null}},{key:"renderClipPath",value:function(){var e=this.clipPathId,t=this.state.offset,r=t.left,n=t.top,i=t.height,a=t.width
return o.createElement("defs",null,o.createElement("clipPath",{id:e},o.createElement("rect",{x:r,y:n,height:i,width:a})))}},{key:"getXScales",value:function(){var e=this.state.xAxisMap
return e?Object.entries(e).reduce((e,t)=>{var r=xj(t,2),n=r[0],o=r[1]
return Tj(Tj({},e),{},kj({},n,o.scale))},{}):null}},{key:"getYScales",value:function(){var e=this.state.yAxisMap
return e?Object.entries(e).reduce((e,t)=>{var r=xj(t,2),n=r[0],o=r[1]
return Tj(Tj({},e),{},kj({},n,o.scale))},{}):null}},{key:"getXScaleByAxisId",value:function(e){var t
return null===(t=this.state.xAxisMap)||void 0===t||null===(t=t[e])||void 0===t?void 0:t.scale}},{key:"getYScaleByAxisId",value:function(e){var t
return null===(t=this.state.yAxisMap)||void 0===t||null===(t=t[e])||void 0===t?void 0:t.scale}},{key:"getItemByXY",value:function(e){var t=this.state,r=t.formattedGraphicalItems,n=t.activeItem
if(r&&r.length)for(var o=0,i=r.length;o<i;o++){var a=r[o],l=a.props,c=a.item,s=void 0!==c.type.defaultProps?Tj(Tj({},c.type.defaultProps),c.props):c.props,u=br(c.type)
if("Bar"===u){var f=(l.data||[]).find(t=>Fg(e,t))
if(f)return{graphicalItem:a,payload:f}}else if("RadialBar"===u){var p=(l.data||[]).find(t=>jm(e,t))
if(p)return{graphicalItem:a,payload:p}}else if(Tw(a,n)||kw(a,n)||Cw(a,n)){var h=Bw({graphicalItem:a,activeTooltipItem:n,itemData:s.data}),d=void 0===s.activeIndex?h:s.activeIndex
return{graphicalItem:Tj(Tj({},a),{},{childIndex:d}),payload:Cw(a,n)?s.data[h]:a.props.data[h]}}}return null}},{key:"render",value:function(){var t=this
if(!Sr(this))return null
var r,n,i=this.props,a=i.children,l=i.className,c=i.width,s=i.height,u=i.style,f=i.compact,p=i.title,h=i.desc,d=Oj(i,bj),y=Er(d,!1)
if(f)return o.createElement(dO,{state:this.state,width:this.props.width,height:this.props.height,clipPathId:this.clipPathId},o.createElement(Ir,wj({},y,{width:c,height:s,title:p,desc:h}),this.renderClipPath(),Tr(a,this.renderMap)))
this.props.accessibilityLayer&&(y.tabIndex=null!==(r=this.props.tabIndex)&&void 0!==r?r:0,y.role=null!==(n=this.props.role)&&void 0!==n?n:"application",y.onKeyDown=e=>{t.accessibilityManager.keyboardEvent(e)},y.onFocus=()=>{t.accessibilityManager.focus()})
var v=this.parseEventsOfWrapper()
return o.createElement(dO,{state:this.state,width:this.props.width,height:this.props.height,clipPathId:this.clipPathId},o.createElement("div",wj({className:e("recharts-wrapper",l),style:Tj({position:"relative",cursor:"default",width:c,height:s},u)},v,{ref:e=>{t.container=e}}),o.createElement(Ir,wj({},y,{width:c,height:s,title:p,desc:h,style:Dj}),this.renderClipPath(),Tr(a,this.renderMap)),this.renderLegend(),this.renderTooltip()))}}],a&&((e,t)=>{for(var r=0;r<t.length;r++){var n=t[r]
n.enumerable=n.enumerable||!1,n.configurable=!0,"value"in n&&(n.writable=!0),Object.defineProperty(e,Cj(n.key),n)}})(i.prototype,a),Object.defineProperty(i,"prototype",{writable:!1}),i
var i,a}()
kj(y,"displayName",r),kj(y,"defaultProps",Tj({layout:"horizontal",stackOffset:"none",barCategoryGap:"10%",barGap:4,margin:{top:5,right:5,bottom:5,left:5},reverseStackOrder:!1,syncMethod:"index"},h)),kj(y,"getDerivedStateFromProps",(e,t)=>{var r=e.dataKey,n=e.data,o=e.children,i=e.width,a=e.height,l=e.layout,c=e.stackOffset,s=e.margin,u=t.dataStartIndex,f=t.dataEndIndex
if(void 0===t.updateId){var p=$j(e)
return Tj(Tj(Tj({},p),{},{updateId:0},d(Tj(Tj({props:e},p),{},{updateId:0}),t)),{},{prevDataKey:r,prevData:n,prevWidth:i,prevHeight:a,prevLayout:l,prevStackOffset:c,prevMargin:s,prevChildren:o})}if(r!==t.prevDataKey||n!==t.prevData||i!==t.prevWidth||a!==t.prevHeight||l!==t.prevLayout||c!==t.prevStackOffset||!ir(s,t.prevMargin)){var h=$j(e),y={chartX:t.chartX,chartY:t.chartY,isTooltipActive:t.isTooltipActive},v=Tj(Tj({},zj(t,n,l)),{},{updateId:t.updateId+1}),m=Tj(Tj(Tj({},h),y),v)
return Tj(Tj(Tj({},m),d(Tj({props:e},m),t)),{},{prevDataKey:r,prevData:n,prevWidth:i,prevHeight:a,prevLayout:l,prevStackOffset:c,prevMargin:s,prevChildren:o})}if(!Mr(o,t.prevChildren)){var b,g,w,x,O=jr(o,ix),j=O&&null!==(b=null===(g=O.props)||void 0===g?void 0:g.startIndex)&&void 0!==b?b:u,S=O&&null!==(w=null===(x=O.props)||void 0===x?void 0:x.endIndex)&&void 0!==w?w:f,P=j!==u||S!==f,A=Tt(n)||P?t.updateId+1:t.updateId
return Tj(Tj({updateId:A},d(Tj(Tj({props:e},t),{},{updateId:A,dataStartIndex:j,dataEndIndex:S}),t)),{},{prevChildren:o,dataStartIndex:j,dataEndIndex:S})}return null}),kj(y,"renderActiveDot",(e,t,r)=>{var i
return i=n.isValidElement(e)?n.cloneElement(e,t):Dt(e)?e(t):o.createElement(Hg,t),o.createElement(Jr,{className:"recharts-active-dot",key:r},i)})
var v=n.forwardRef((e,t)=>o.createElement(y,wj({},e,{ref:t})))
return v.displayName=y.displayName,v}
export{Ux as $,Ng as A,Yt as B,zs as C,Hg as D,wu as E,ir as F,us as G,Et as H,pr as I,km as J,yO as K,Jr as L,bO as M,ay as N,ly as O,_l as P,hy as Q,Us as R,gm as S,Cs as T,Sm as U,_w as V,Or as W,wm as X,er as Y,xm as Z,Tv as _,hb as a,rr as b,Tt as c,Ht as d,Oy as e,Er as f,Xm as g,Ar as h,Kt as i,Dt as j,$v as k,nm as l,cy as m,Wj as n,Hx as o,wO as p,xO as q,gO as r,vO as s,mO as t,Qt as u,Vv as v,Qr as w,Yv as x,oO as y,Vs as z}
