import{f as t}from"./vendor-data-BaHBZjtO.js"
import{p as r,q as e,r as i,i as a,s as n,t as l,j as o,w as s,v as c,x as h,f}from"./generateCategoricalChart-dq26NRqK.js"
import{g as y,C as u}from"./YAxis-BOBdLeNn.js"
var v=["x1","y1","x2","y2","key"],d=["offset"]
function g(t){return(g="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?t=>typeof t:t=>t&&"function"==typeof Symbol&&t.constructor===Symbol&&t!==Symbol.prototype?"symbol":typeof t)(t)}function p(t,r){var e=Object.keys(t)
if(Object.getOwnPropertySymbols){var i=Object.getOwnPropertySymbols(t)
r&&(i=i.filter(r=>Object.getOwnPropertyDescriptor(t,r).enumerable)),e.push.apply(e,i)}return e}function m(t){for(var r=1;r<arguments.length;r++){var e=null!=arguments[r]?arguments[r]:{}
r%2?p(Object(e),!0).forEach(r=>{var i,a,n,l
i=t,a=r,n=e[r],l=(t=>{if("object"!=g(t)||!t)return t
var r=t[Symbol.toPrimitive]
if(void 0!==r){var e=r.call(t,"string")
if("object"!=g(e))return e
throw new TypeError("@@toPrimitive must return a primitive value.")}return String(t)})(a),(a="symbol"==g(l)?l:l+"")in i?Object.defineProperty(i,a,{value:n,enumerable:!0,configurable:!0,writable:!0}):i[a]=n}):Object.getOwnPropertyDescriptors?Object.defineProperties(t,Object.getOwnPropertyDescriptors(e)):p(Object(e)).forEach(r=>{Object.defineProperty(t,r,Object.getOwnPropertyDescriptor(e,r))})}return t}function x(){return x=Object.assign?Object.assign.bind():function(t){for(var r=1;r<arguments.length;r++){var e=arguments[r]
for(var i in e)Object.prototype.hasOwnProperty.call(e,i)&&(t[i]=e[i])}return t},x.apply(this,arguments)}function b(t,r){if(null==t)return{}
var e,i,a=((t,r)=>{if(null==t)return{}
var e={}
for(var i in t)if(Object.prototype.hasOwnProperty.call(t,i)){if(r.indexOf(i)>=0)continue
e[i]=t[i]}return e})(t,r)
if(Object.getOwnPropertySymbols){var n=Object.getOwnPropertySymbols(t)
for(i=0;i<n.length;i++)e=n[i],r.indexOf(e)>=0||Object.prototype.propertyIsEnumerable.call(t,e)&&(a[e]=t[e])}return a}var O=r=>{var e=r.fill
if(!e||"none"===e)return null
var i=r.fillOpacity,a=r.x,n=r.y,l=r.width,o=r.height,s=r.ry
return t.createElement("rect",{x:a,y:n,ry:s,width:l,height:o,stroke:"none",fill:e,fillOpacity:i,className:"recharts-cartesian-grid-bg"})}
function w(r,e){var i
if(t.isValidElement(r))i=t.cloneElement(r,e)
else if(o(r))i=r(e)
else{var a=e.x1,n=e.y1,l=e.x2,s=e.y2,c=e.key,h=b(e,v),y=f(h,!1)
y.offset
var u=b(y,d)
i=t.createElement("line",x({},u,{x1:a,y1:n,x2:l,y2:s,fill:"none",key:c}))}return i}function P(r){var e=r.x,i=r.width,a=r.horizontal,n=void 0===a||a,l=r.horizontalPoints
if(!n||!l||!l.length)return null
var o=l.map((t,a)=>{var l=m(m({},r),{},{x1:e,y1:t,x2:e+i,y2:t,key:"line-".concat(a),index:a})
return w(n,l)})
return t.createElement("g",{className:"recharts-cartesian-grid-horizontal"},o)}function j(r){var e=r.y,i=r.height,a=r.vertical,n=void 0===a||a,l=r.verticalPoints
if(!n||!l||!l.length)return null
var o=l.map((t,a)=>{var l=m(m({},r),{},{x1:t,y1:e,x2:t,y2:e+i,key:"line-".concat(a),index:a})
return w(n,l)})
return t.createElement("g",{className:"recharts-cartesian-grid-vertical"},o)}function k(r){var e=r.horizontalFill,i=r.fillOpacity,a=r.x,n=r.y,l=r.width,o=r.height,s=r.horizontalPoints,c=r.horizontal
if(void 0!==c&&!c||!e||!e.length)return null
var h=s.map(t=>Math.round(t+n-n)).sort((t,r)=>t-r)
n!==h[0]&&h.unshift(0)
var f=h.map((r,s)=>{var c=h[s+1]?h[s+1]-r:n+o-r
if(c<=0)return null
var f=s%e.length
return t.createElement("rect",{key:"react-".concat(s),y:r,x:a,height:c,width:l,stroke:"none",fill:e[f],fillOpacity:i,className:"recharts-cartesian-grid-bg"})})
return t.createElement("g",{className:"recharts-cartesian-gridstripes-horizontal"},f)}function z(r){var e=r.vertical,i=void 0===e||e,a=r.verticalFill,n=r.fillOpacity,l=r.x,o=r.y,s=r.width,c=r.height,h=r.verticalPoints
if(!i||!a||!a.length)return null
var f=h.map(t=>Math.round(t+l-l)).sort((t,r)=>t-r)
l!==f[0]&&f.unshift(0)
var y=f.map((r,e)=>{var i=f[e+1]?f[e+1]-r:l+s-r
if(i<=0)return null
var h=e%a.length
return t.createElement("rect",{key:"react-".concat(e),x:r,y:o,width:i,height:c,stroke:"none",fill:a[h],fillOpacity:n,className:"recharts-cartesian-grid-bg"})})
return t.createElement("g",{className:"recharts-cartesian-gridstripes-vertical"},y)}var E=(t,r)=>{var e=t.xAxis,i=t.width,a=t.height,n=t.offset
return c(y(m(m(m({},u.defaultProps),e),{},{ticks:h(e,!0),viewBox:{x:0,y:0,width:i,height:a}})),n.left,n.left+n.width,r)},A=(t,r)=>{var e=t.yAxis,i=t.width,a=t.height,n=t.offset
return c(y(m(m(m({},u.defaultProps),e),{},{ticks:h(e,!0),viewBox:{x:0,y:0,width:i,height:a}})),n.top,n.top+n.height,r)},S={horizontal:!0,vertical:!0,stroke:"#ccc",fill:"none",verticalFill:[],horizontalFill:[]}
function F(c){var h,f,y,u,v,d,p=r(),b=e(),w=i(),F=m(m({},c),{},{stroke:null!==(h=c.stroke)&&void 0!==h?h:S.stroke,fill:null!==(f=c.fill)&&void 0!==f?f:S.fill,horizontal:null!==(y=c.horizontal)&&void 0!==y?y:S.horizontal,horizontalFill:null!==(u=c.horizontalFill)&&void 0!==u?u:S.horizontalFill,vertical:null!==(v=c.vertical)&&void 0!==v?v:S.vertical,verticalFill:null!==(d=c.verticalFill)&&void 0!==d?d:S.verticalFill,x:a(c.x)?c.x:w.left,y:a(c.y)?c.y:w.top,width:a(c.width)?c.width:w.width,height:a(c.height)?c.height:w.height}),C=F.x,N=F.y,G=F.width,D=F.height,V=F.syncWithTicks,B=F.horizontalValues,M=F.verticalValues,T=n(),q=l()
if(!a(G)||G<=0||!a(D)||D<=0||!a(C)||C!==+C||!a(N)||N!==+N)return null
var I=F.verticalCoordinatesGenerator||E,W=F.horizontalCoordinatesGenerator||A,Y=F.horizontalPoints,H=F.verticalPoints
if((!Y||!Y.length)&&o(W)){var J=B&&B.length,K=W({yAxis:q?m(m({},q),{},{ticks:J?B:q.ticks}):void 0,width:p,height:b,offset:w},!!J||V)
s(Array.isArray(K),"horizontalCoordinatesGenerator should return Array but instead it returned [".concat(g(K),"]")),Array.isArray(K)&&(Y=K)}if((!H||!H.length)&&o(I)){var L=M&&M.length,Q=I({xAxis:T?m(m({},T),{},{ticks:L?M:T.ticks}):void 0,width:p,height:b,offset:w},!!L||V)
s(Array.isArray(Q),"verticalCoordinatesGenerator should return Array but instead it returned [".concat(g(Q),"]")),Array.isArray(Q)&&(H=Q)}return t.createElement("g",{className:"recharts-cartesian-grid"},t.createElement(O,{fill:F.fill,fillOpacity:F.fillOpacity,x:F.x,y:F.y,width:F.width,height:F.height,ry:F.ry}),t.createElement(P,x({},F,{offset:w,horizontalPoints:Y,xAxis:T,yAxis:q})),t.createElement(j,x({},F,{offset:w,verticalPoints:H,xAxis:T,yAxis:q})),t.createElement(k,x({},F,{horizontalPoints:Y})),t.createElement(z,x({},F,{verticalPoints:H})))}F.displayName="CartesianGrid"
export{F as C}
