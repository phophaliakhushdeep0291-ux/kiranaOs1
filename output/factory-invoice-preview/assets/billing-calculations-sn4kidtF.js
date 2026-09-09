import{T as t}from"./index-DtTTo2f-.js"
function n(t){return t?.length?t.reduce((t,n)=>{const e=Number(n.price??0),r=Number(n.quantity??1)
return Number.isFinite(e)&&Number.isFinite(r)?t+e*r:t},0):0}function e(t){return t?.length?t.map(t=>`${t.quantity&&t.quantity>1?`${t.quantity}× `:""}${t.name}`).join(", "):""}function r(t){const e=t.sellingUnit?.id??t.sellingUnit?.unitCode??t.unit??"default",r=t.batch?.id??"fefo",i=(u=t.addons,u?.length?u.map(t=>`${t.optionId}x${t.quantity??1}`).sort().join(","):"plain")
var u
const a=Boolean(t.guestSnapshot||t.guestOrderId||t.guestOrderLineId)?`::guest:${JSON.stringify([t.guestOrderId,t.guestOrderLineId,t.rate,n(t.addons),t.note??""])}`:""
return`${t.product.id}::${e}::${r}::${i}::${t.isCustom?"custom":"catalog"}${a}`}const i="split"
function u(t,n,e){return Number.isFinite(t)?Math.min(Math.max(t,n),e):n}function a(t){const n=Number(t)||0
return Math.round(1e3*(n+Number.EPSILON))/1e3||0}function o(n,e){const r=t((Number(n)||0)-(Number(e)||0))
return r>0?r:0}function s(n,e=4){const r=t(Number(n)||0)
if(r<=0)return[]
const i=[50,100,200,500,2e3],u=new Set([r]),a=100*Math.ceil(r/100)
a>r&&u.add(a)
for(const t of i)t>r&&u.add(t)
return[...u].sort((t,n)=>t-n).slice(0,e)}function c(t){return t.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g,"").replace(/[०-९]/g,t=>String("०१२३४५६७८९".indexOf(t))).replace(/[^\p{L}\p{N}\p{M}]+/gu," ").trim()}function d(t){return c([t.name,t.category??"",t.displayUnit??"",t.rateUnit??"",...t.aliases??[]].join(" "))}function l(t){return String(t??"").trim().toLocaleLowerCase("en-US")}function m(t,n,e){const r=t.trim()
if(!r)return{kind:"none"}
const i=((t,n)=>{const e=l(t)
if(!e)return null
for(const r of n){if(l(r.barcode)===e||l(r.sku)===e)return{product:r}
const t=(r.sellingUnits??[]).find(t=>!1!==t.isActive&&(l(t.barcode)===e||l(t.sku)===e))
if(t)return{product:r,sellingUnit:t}}return null})(r,e)
if(i)return{kind:"match",...i}
const u=((t,n)=>{const e=t.trim()
if(!e)return null
const r=e.toLowerCase()
return n.find(t=>t.barcode&&String(t.barcode).trim().toLowerCase()===r||t.sku&&String(t.sku).trim().toLowerCase()===r)||(1===n.length?n[0]:null)})(r,n)
return u?{kind:"match",product:u}:(t=>{const n=t.trim()
return!(!n||/\s/.test(n)||n.length>48)&&(!!/^\d{8,}$/.test(n)||/^[A-Za-z0-9][A-Za-z0-9._/-]{9,}$/.test(n)&&/\d/.test(n))})(r)?{kind:"unknown-code",code:r}:{kind:"none"}}async function f(t){if(t.skip)return t.add(t.product),{bound:!1,added:!0}
try{await t.bind(t.product,t.code)}catch(n){return{bound:!1,added:!1,error:n instanceof Error?n.message:String(n)}}return t.add(t.product),{bound:!0,added:!0}}function p(n,e=1){const r=Number(n.sellingPrice??n.defaultPricePerRateUnit??0),i=Number(n.retailPrice??n.retailPricePerRateUnit??r),u=Number(n.wholesalePrice??n.wholesalePricePerRateUnit??r),a=Number(n.retailFromQuantity??1),o=Number(n.wholesaleFromQuantity??0)
return t(o>0&&e>=o&&u>0?u:a>0&&e>=a&&i>0?i:r)}function b(n){return t(Number(n.minimumSellingPrice??n.minPricePerRateUnit??0))}function g(n){if(n.isCustom)return!1
const e=Math.max(0,Number(n.quantity)||0)
return(e>0?t(Number(n.rate)-M(n)/e):Number(n.rate))<Number(n.sellingUnit?.minimumPrice??b(n.product))||!n.manualRate&&!0===n.pricing?.requiresApproval}const N=100,h=10
function y(e,r){let i=0,u=Math.max(0,Number(r)||0)
for(const o of e){const e=Math.max(0,Number(o.quantity)||0),r=n(o.addons),a=o.isCustom?Number(o.rate)||0:Number(o.sellingUnit?.defaultPrice??o.pricing?.originalUnitPrice??p(o.product,e))||0
i+=t((a+r)*e),u+=M(o),!o.isCustom&&(!o.pricing?.appliedRuleId||o.manualRate)&&a>o.rate&&(u+=t((a-o.rate)*e))}i=t(i),u=t(u)
const a=t(Math.max(100,10*i/100))
return{referenceSubtotal:i,approvalDiscount:u,threshold:a,requiresApproval:i>0&&u>=a-.005}}function U(n,e,r){return JSON.stringify({discount:t(e),loyaltyPoints:Math.max(0,Math.floor(Number(r)||0)),lines:n.map(n=>({productId:n.product.id,unitId:n.sellingUnit?.id??n.sellingUnit?.unitCode??n.unit,quantity:a(n.quantity),rate:t(n.rate),lineDiscount:M(n),pricingRuleId:n.pricing?.appliedRuleId??null,addons:(n.addons??[]).map(n=>({id:n.optionId,quantity:n.quantity??1,price:t(n.price)}))}))})}function P(n){return t(Number(n.quantity)*q(n))}function q(e){return t(Number(e.rate)+n(e.addons))}function M(n){return t(Math.min(Math.max(Number(n.lineDiscount)||0,0),P(n)))}function S(n){return t(P(n)-M(n))}function $(n,e){const r=n.reduce((n,e)=>{const r=Number(e.product?.mrp)||0,i=Number(e.rate)||0,u=Number(e.quantity)||0
return n+(r>i?t((r-i)*u):0)+M(e)},0)
return t(Math.max(0,r+(Number(e)||0)))}function x(n){return t(n.reduce((t,n)=>t+S(n),0))}function k(n){return t(n.reduce((t,n)=>t+M(n),0))}function w(t){return t.isUdharEntry||t.creditAmount>0||t.isCreditMode||t.isSplitMode&&t.splitUdharAmount>0}export{h as L,i as S,d as a,f as b,S as c,r as d,e,P as f,M as g,b as h,n as i,u as j,o as k,a as l,q as m,c as n,$ as o,p,x as q,m as r,s,k as t,U as u,N as v,y as w,g as x,w as y}
