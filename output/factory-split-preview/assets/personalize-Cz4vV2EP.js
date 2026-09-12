function e(e,r,t){return 0===t.size?[...e]:e.map((e,n)=>({item:e,index:n,score:t.get(r(e))??-1})).sort((e,r)=>r.score-e.score||e.index-r.index).map(e=>e.item)}function r(e){return new Map((e??[]).map(e=>[e.key,e.score]))}function t(e,r,t=4){if(!e)return{reason:null,productIds:[]}
const n=new Set(r)
if(0===r.length){const r=e.predictedProducts
if(!r?.sufficientData)return{reason:null,productIds:[]}
const o=r.products.map(e=>e.productId).filter(e=>!n.has(e))
return o.length>0?{reason:"predicted",productIds:o.slice(0,t)}:{reason:null,productIds:[]}}const o=new Map
for(const c of[...r].reverse())for(const r of e.productCombos?.[c]??[])n.has(r.productId)||o.set(r.productId,(o.get(r.productId)??0)+r.score)
const s=[...o.entries()].sort((e,r)=>r[1]-e[1]).slice(0,t).map(([e])=>e)
return s.length>0?{reason:"combo",productIds:s}:{reason:null,productIds:[]}}function n(e,r,t=5){const n=e?.searchSuggestions??[],o=r.trim().toLowerCase()
return n.filter(e=>e.query!==o).filter(e=>0===o.length||e.query.includes(o)).slice(0,t).map(e=>e.query)}function o(e,r=5){return new Set((e?.onlineTrending??[]).slice(0,r).map(e=>e.key))}function s(e,r){const t=e?.preferredFilters?.[r]??[]
return t[0]?.filter??null}export{n as m,e as o,s as p,t as s,o as t,r as u}
