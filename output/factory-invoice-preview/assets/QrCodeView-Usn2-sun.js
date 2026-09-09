import{a as e,j as t}from"./vendor-data-BaHBZjtO.js"
import{e as r}from"./qr-encoder-O1M434ck.js"
function s({value:s,level:a="M",border:i=4,size:l=240,dark:o="#0b1424",light:h="#ffffff",className:d,title:f="QR code"}){const{path:n,dim:c}=e.useMemo(()=>{const e=r(s,a),t=e.length
let l=""
for(let r=0;r<t;r++)for(let s=0;s<t;s++)e[r][s]&&(l+=`M${s+i},${r+i}h1v1h-1z`)
return{path:l,dim:t+2*i}},[s,a,i])
return t.jsxs("svg",{viewBox:`0 0 ${c} ${c}`,width:l,height:l,shapeRendering:"crispEdges",role:"img","aria-label":f,className:d,children:[t.jsx("rect",{width:c,height:c,fill:h}),t.jsx("path",{d:n,fill:o})]})}export{s as Q}
