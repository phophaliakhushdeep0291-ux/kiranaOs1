import{f as e,L as t,m as r,i as a,a as n,A as i,b as o,c as s,d as l,e as c,h as p,g as u,u as y,j as h,G as m,k as d,l as f,D as v,n as b,o as A}from"./generateCategoricalChart-XCnZf7y-.js"
import{f as x,a as g}from"./vendor-data-BaHBZjtO.js"
import{bA as O}from"./index-DbQMpL2c.js"
import{X as P,Y as j}from"./YAxis-DZyHdcxk.js"
var w,E=["layout","type","stroke","connectNulls","isRange","ref"],k=["key"]
function S(e){return(S="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?e=>typeof e:e=>e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e)(e)}function D(e,t){if(null==e)return{}
var r,a,n=((e,t)=>{if(null==e)return{}
var r={}
for(var a in e)if(Object.prototype.hasOwnProperty.call(e,a)){if(t.indexOf(a)>=0)continue
r[a]=e[a]}return r})(e,t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(e)
for(a=0;a<i.length;a++)r=i[a],t.indexOf(r)>=0||Object.prototype.propertyIsEnumerable.call(e,r)&&(n[r]=e[r])}return n}function M(){return M=Object.assign?Object.assign.bind():function(e){for(var t=1;t<arguments.length;t++){var r=arguments[t]
for(var a in r)Object.prototype.hasOwnProperty.call(r,a)&&(e[a]=r[a])}return e},M.apply(this,arguments)}function L(e,t){var r=Object.keys(e)
if(Object.getOwnPropertySymbols){var a=Object.getOwnPropertySymbols(e)
t&&(a=a.filter(t=>Object.getOwnPropertyDescriptor(e,t).enumerable)),r.push.apply(r,a)}return r}function N(e){for(var t=1;t<arguments.length;t++){var r=null!=arguments[t]?arguments[t]:{}
t%2?L(Object(r),!0).forEach(t=>{T(e,t,r[t])}):Object.getOwnPropertyDescriptors?Object.defineProperties(e,Object.getOwnPropertyDescriptors(r)):L(Object(r)).forEach(t=>{Object.defineProperty(e,t,Object.getOwnPropertyDescriptor(r,t))})}return e}function C(e,t){for(var r=0;r<t.length;r++){var a=t[r]
a.enumerable=a.enumerable||!1,a.configurable=!0,"value"in a&&(a.writable=!0),Object.defineProperty(e,_(a.key),a)}}function B(){try{var e=!Boolean.prototype.valueOf.call(Reflect.construct(Boolean,[],()=>{}))}catch(t){}return(B=()=>!!e)()}function I(e){return(I=Object.setPrototypeOf?Object.getPrototypeOf.bind():e=>e.__proto__||Object.getPrototypeOf(e))(e)}function R(e,t){return(R=Object.setPrototypeOf?Object.setPrototypeOf.bind():(e,t)=>(e.__proto__=t,e))(e,t)}function T(e,t,r){return(t=_(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e}function _(e){var t=(e=>{if("object"!=S(e)||!e)return e
var t=e[Symbol.toPrimitive]
if(void 0!==t){var r=t.call(e,"string")
if("object"!=S(r))return r
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(e)})(e)
return"symbol"==S(t)?t:t+""}var z=function(){function m(){var e,t,r,a;((e,t)=>{if(!(this instanceof t))throw new TypeError("Cannot call a class as a function")})(0,m)
for(var n=arguments.length,i=new Array(n),o=0;o<n;o++)i[o]=arguments[o]
return T((t=this,r=m,a=[].concat(i),r=I(r),e=((e,t)=>{if(t&&("object"===S(t)||"function"==typeof t))return t
if(void 0!==t)throw new TypeError("Derived constructors may only return object or undefined")
return(e=>{if(void 0===e)throw new ReferenceError("this hasn't been initialised - super() hasn't been called")
return e})(e)})(t,B()?Reflect.construct(r,a||[],I(t).constructor):r.apply(t,a))),"state",{isAnimationFinished:!0}),T(e,"id",y("recharts-area-")),T(e,"handleAnimationEnd",()=>{var t=e.props.onAnimationEnd
e.setState({isAnimationFinished:!0}),h(t)&&t()}),T(e,"handleAnimationStart",()=>{var t=e.props.onAnimationStart
e.setState({isAnimationFinished:!1}),h(t)&&t()}),e}return((e,t)=>{if("function"!=typeof t&&null!==t)throw new TypeError("Super expression must either be null or a function")
e.prototype=Object.create(t&&t.prototype,{constructor:{value:e,writable:!0,configurable:!0}}),Object.defineProperty(e,"prototype",{writable:!1}),t&&R(e,t)})(m,g.PureComponent),d=m,v=[{key:"getDerivedStateFromProps",value:(e,t)=>e.animationId!==t.prevAnimationId?{prevAnimationId:e.animationId,curPoints:e.points,curBaseLine:e.baseLine,prevPoints:t.curPoints,prevBaseLine:t.curBaseLine}:e.points!==t.curPoints||e.baseLine!==t.curBaseLine?{curPoints:e.points,curBaseLine:e.baseLine}:null}],(f=[{key:"renderDots",value:function(r,a,n){var i=this.props.isAnimationActive,o=this.state.isAnimationFinished
if(i&&!o)return null
var s=this.props,l=s.dot,c=s.points,p=s.dataKey,u=e(this.props,!1),y=e(l,!0),h=c.map((e,t)=>{var r=N(N(N({key:"dot-".concat(t),r:3},u),y),{},{index:t,cx:e.x,cy:e.y,dataKey:p,value:e.value,payload:e.payload,points:c})
return m.renderDotItem(l,r)}),d={clipPath:r?"url(#clipPath-".concat(a?"":"dots-").concat(n,")"):null}
return x.createElement(t,M({className:"recharts-area-dots"},d),h)}},{key:"renderHorizontalRect",value:function(e){var t=this.props,n=t.baseLine,i=t.points,o=t.strokeWidth,s=i[0].x,l=i[i.length-1].x,c=e*Math.abs(s-l),p=r(i.map(e=>e.y||0))
return a(n)&&"number"==typeof n?p=Math.max(n,p):n&&Array.isArray(n)&&n.length&&(p=Math.max(r(n.map(e=>e.y||0)),p)),a(p)?x.createElement("rect",{x:s<l?s:s-c,y:0,width:c,height:Math.floor(p+(o?parseInt("".concat(o),10):1))}):null}},{key:"renderVerticalRect",value:function(e){var t=this.props,n=t.baseLine,i=t.points,o=t.strokeWidth,s=i[0].y,l=i[i.length-1].y,c=e*Math.abs(s-l),p=r(i.map(e=>e.x||0))
return a(n)&&"number"==typeof n?p=Math.max(n,p):n&&Array.isArray(n)&&n.length&&(p=Math.max(r(n.map(e=>e.x||0)),p)),a(p)?x.createElement("rect",{x:0,y:s<l?s:s-c,width:p+(o?parseInt("".concat(o),10):1),height:Math.floor(c)}):null}},{key:"renderClipRect",value:function(e){return"vertical"===this.props.layout?this.renderVerticalRect(e):this.renderHorizontalRect(e)}},{key:"renderAreaStatically",value:function(r,a,i,o){var s=this.props,l=s.layout,c=s.type,p=s.stroke,u=s.connectNulls,y=s.isRange
s.ref
var h=D(s,E)
return x.createElement(t,{clipPath:i?"url(#clipPath-".concat(o,")"):null},x.createElement(n,M({},e(h,!0),{points:r,connectNulls:u,type:c,baseLine:a,layout:l,stroke:"none",className:"recharts-area-area"})),"none"!==p&&x.createElement(n,M({},e(this.props,!1),{className:"recharts-area-curve",layout:l,type:c,connectNulls:u,fill:"none",points:r})),"none"!==p&&y&&x.createElement(n,M({},e(this.props,!1),{className:"recharts-area-curve",layout:l,type:c,connectNulls:u,fill:"none",points:a})))}},{key:"renderAreaWithAnimation",value:function(e,r){var n=this,c=this.props,p=c.points,u=c.baseLine,y=c.isAnimationActive,h=c.animationBegin,m=c.animationDuration,d=c.animationEasing,f=c.animationId,v=this.state,b=v.prevPoints,A=v.prevBaseLine
return x.createElement(i,{begin:h,duration:m,isActive:y,easing:d,from:{t:0},to:{t:1},key:"area-".concat(f),onAnimationEnd:this.handleAnimationEnd,onAnimationStart:this.handleAnimationStart},i=>{var c=i.t
if(b){var y,h=b.length/p.length,m=p.map((e,t)=>{var r=Math.floor(t*h)
if(b[r]){var a=b[r],n=o(a.x,e.x),i=o(a.y,e.y)
return N(N({},e),{},{x:n(c),y:i(c)})}return e})
return y=a(u)&&"number"==typeof u?o(A,u)(c):s(u)||l(u)?o(A,0)(c):u.map((e,t)=>{var r=Math.floor(t*h)
if(A[r]){var a=A[r],n=o(a.x,e.x),i=o(a.y,e.y)
return N(N({},e),{},{x:n(c),y:i(c)})}return e}),n.renderAreaStatically(m,y,e,r)}return x.createElement(t,null,x.createElement("defs",null,x.createElement("clipPath",{id:"animationClipPath-".concat(r)},n.renderClipRect(c))),x.createElement(t,{clipPath:"url(#animationClipPath-".concat(r,")")},n.renderAreaStatically(p,u,e,r)))})}},{key:"renderArea",value:function(e,t){var r=this.props,a=r.points,n=r.baseLine,i=r.isAnimationActive,o=this.state,s=o.prevPoints,l=o.prevBaseLine,p=o.totalLength
return i&&a&&a.length&&(!s&&p>0||!c(s,a)||!c(l,n))?this.renderAreaWithAnimation(e,t):this.renderAreaStatically(a,n,e,t)}},{key:"render",value:function(){var r,a=this.props,n=a.hide,i=a.dot,o=a.points,l=a.className,c=a.top,y=a.left,h=a.xAxis,m=a.yAxis,d=a.width,f=a.height,v=a.isAnimationActive,b=a.id
if(n||!o||!o.length)return null
var A=this.state.isAnimationFinished,g=1===o.length,P=O("recharts-area",l),j=h&&h.allowDataOverflow,w=m&&m.allowDataOverflow,E=j||w,k=s(b)?this.id:b,S=null!==(r=e(i,!1))&&void 0!==r?r:{r:3,strokeWidth:2},D=S.r,M=void 0===D?3:D,L=S.strokeWidth,N=void 0===L?2:L,C=(p(i)?i:{}).clipDot,B=void 0===C||C,I=2*M+N
return x.createElement(t,{className:P},j||w?x.createElement("defs",null,x.createElement("clipPath",{id:"clipPath-".concat(k)},x.createElement("rect",{x:j?y:y-d/2,y:w?c:c-f/2,width:j?d:2*d,height:w?f:2*f})),!B&&x.createElement("clipPath",{id:"clipPath-dots-".concat(k)},x.createElement("rect",{x:y-I/2,y:c-I/2,width:d+I,height:f+I}))):null,g?null:this.renderArea(E,k),(i||g)&&this.renderDots(E,B,k),(!v||A)&&u.renderCallByParent(this.props,o))}}])&&C(d.prototype,f),v&&C(d,v),Object.defineProperty(d,"prototype",{writable:!1}),d
var d,f,v}()
w=z,T(z,"displayName","Area"),T(z,"defaultProps",{stroke:"#3182bd",fill:"#3182bd",fillOpacity:.6,xAxisId:0,yAxisId:0,legendType:"line",connectNulls:!1,points:[],dot:!1,activeDot:!0,hide:!1,isAnimationActive:!m.isSsr,animationBegin:0,animationDuration:1500,animationEasing:"ease"}),T(z,"getBaseValue",(e,t,r,n)=>{var i=e.layout,o=e.baseValue,s=t.props.baseValue,l=null!=s?s:o
if(a(l)&&"number"==typeof l)return l
var c="horizontal"===i?n:r,p=c.scale.domain()
if("number"===c.type){var u=Math.max(p[0],p[1]),y=Math.min(p[0],p[1])
return"dataMin"===l?y:"dataMax"===l||u<0?u:Math.max(Math.min(p[0],p[1]),0)}return"dataMin"===l?p[0]:"dataMax"===l?p[1]:p[0]}),T(z,"getComposedData",e=>{var t,r=e.props,a=e.item,n=e.xAxis,i=e.yAxis,o=e.xAxisTicks,s=e.yAxisTicks,l=e.bandSize,c=e.dataKey,p=e.stackedData,u=e.dataStartIndex,y=e.displayedData,h=e.offset,m=r.layout,v=p&&p.length,b=w.getBaseValue(r,a,n,i),A="horizontal"===m,x=!1,g=y.map((e,t)=>{var r
v?r=p[u+t]:(r=d(e,c),Array.isArray(r)?x=!0:r=[b,r])
var a=null==r[1]||v&&null==d(e,c)
return A?{x:f({axis:n,ticks:o,bandSize:l,entry:e,index:t}),y:a?null:i.scale(r[1]),value:r,payload:e}:{x:a?null:n.scale(r[1]),y:f({axis:i,ticks:s,bandSize:l,entry:e,index:t}),value:r,payload:e}})
return t=v||x?g.map(e=>{var t=Array.isArray(e.value)?e.value[0]:null
return A?{x:e.x,y:null!=t&&null!=e.y?i.scale(t):null}:{x:null!=t?n.scale(t):null,y:e.y}}):A?i.scale(b):n.scale(b),N({points:g,baseLine:t,layout:m,isRange:x},h)}),T(z,"renderDotItem",(e,t)=>{var r
if(x.isValidElement(e))r=x.cloneElement(e,t)
else if(h(e))r=e(t)
else{var a=O("recharts-area-dot","boolean"!=typeof e?e.className:""),n=t.key,i=D(t,k)
r=x.createElement(v,M({},i,{key:n,className:a}))}return r})
var V=b({chartName:"AreaChart",GraphicalChild:z,axisComponents:[{axisType:"xAxis",AxisComp:P},{axisType:"yAxis",AxisComp:j}],formatAxisMap:A})
export{V as A,z as a}
