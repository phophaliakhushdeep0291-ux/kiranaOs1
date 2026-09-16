const t={kg:1e3,kilogram:1e3,kilograms:1e3,gram:1,grams:1,g:1,litre:1e3,liter:1e3,litres:1e3,liters:1e3,ltr:1e3,ml:1,piece:1,pieces:1,pcs:1,packet:1,pkt:1,box:1,bundle:1,dozen:12,set:1,pair:1,roll:1,sheet:1,meter:1,metre:1,meters:1,metres:1,mtr:1,yard:1,yards:1,yd:1,strip:1,strips:1,tablet:1,tablets:1,tab:1,bottle:1,bottles:1,tube:1,tubes:1,plate:1,plates:1,glass:1,glasses:1,custom:1},e={kg:"weight",kilogram:"weight",kilograms:"weight",gram:"weight",grams:"weight",g:"weight",litre:"volume",liter:"volume",litres:"volume",liters:"volume",ltr:"volume",ml:"volume",piece:"count",pieces:"count",pcs:"count",packet:"count",pkt:"count",box:"count",bundle:"count",dozen:"count",set:"count",pair:"count",roll:"count",sheet:"count",strip:"count",tablet:"count",strips:"count",tablets:"count",tab:"count",bottle:"count",bottles:"count",tube:"count",tubes:"count",plate:"count",plates:"count",glass:"count",glasses:"count",meter:"length",metre:"length",meters:"length",metres:"length",mtr:"length",yard:"length",yards:"length",yd:"length",custom:"custom"}
function n(t){return Math.round(100*(Number(t||0)+Number.EPSILON))/100}function o(e){return t[(e||"piece").toLowerCase()]??1}function r(t,e,r){const i=o(e),s=o(r||e||"piece")
return n(Number(t||0)*i/s)}function i(t,e,r){const i=o(e||r||"piece"),s=o(r||e||"piece")
return n(Number(t||0)*i/s)}function s(t){return e[(t||"piece").toLowerCase()]??"custom"}function c(t,e){const n=(t||"").trim().toLowerCase(),o=(e||"").trim().toLowerCase()
if(!n||!o||n===o)return
const r=s(n),i=s(o)
return"custom"!==r&&"custom"!==i&&r!==i?`Unit mismatch warning: entered ${t} for a product measured in ${e}. Review quantity before saving.`:void 0}function u(t){const e=Math.max(Number(t.currentStockBaseQty||0),0),o=n(Number(t.currentAverageCost||0)),s=Math.max(Number(t.purchaseQuantity||0),0),c=Number(t.purchaseConversionToBase||0),u=Number(t.rateConversionToBase||0),a=c>0?n(s*c):r(s,t.purchaseUnit,t.productBaseUnit||t.purchaseUnit),l=Math.max(u>0?n(a/u):i(a,t.productBaseUnit||t.purchaseUnit,t.productRateUnit||t.productBaseUnit||t.purchaseUnit),0),m=Math.max(u>0?n(e/u):i(e,t.productBaseUnit||t.productRateUnit||t.purchaseUnit,t.productRateUnit||t.productBaseUnit||t.purchaseUnit),0),d=Number(t.purchaseUnitCost||0),p=Number(t.billAmount||0)>0&&l>0?Number(t.billAmount)/l:0,f=n(d||p),b=f>0&&l>0?n((o*m+f*l)/Math.max(m+l,l)):o
return{purchaseBaseQty:a,purchaseQtyInRateUnit:l,purchaseUnitCost:f,projectedAverageCost:b,minPriceSuggestion:n(b*(1+Math.max(Number(t.minMarginPercent||0),0)/100)),sellingPriceSuggestion:n(b*(1+Math.max(Number(t.sellingMarginPercent||0),0)/100))}}function a(...t){for(const e of t){if(""===e||null==e)continue
const t=Number(e)
if(Number.isFinite(t))return t}}function l(t){return"string"==typeof t&&t.trim()?t.trim():void 0}function m(t,e){return String(t??"").trim().toLowerCase()===String(e??"").trim().toLowerCase()}function d(t){return(t?.sellingUnits??[]).filter(t=>t&&!1!==t.isActive)}function p(t){const e=Number(t.packSizeValue??0),n=String(t.packSizeUnit??"").trim()
return e>0&&n?`${e} ${n}`:t.name??t.unitCode}function f(t){const e=d(t)
return e.find(t=>t.isDefault)??e[0]}function b(t,e){const n=d(t),o=n.find(t=>t.isDefault)??n[0]
if(!e)return o
const r=n.find(t=>((t,e)=>!!e&&(m(t.unitCode,e)||m(t.name,e)||m(t.unitType,e)))(t,e))
if(r)return r
const i=n.filter(t=>m(t.unitType,e))
return i.find(t=>t.isDefault)??i[0]}function g(t){const e=t,o=a(t.stockBaseQty,e.stock_base_qty,e.currentStockBaseQty,e.current_stock_base_qty)
if(void 0!==o)return n(o)
const i=a(t.stockQuantity,e.stock_quantity,e.quantity,e.qty)??0,s=f(t)
return s&&s.conversionToBase>0?n(i*s.conversionToBase):r(i,t.unit??t.rateUnit??t.displayUnit??t.baseUnit??"piece",t.baseUnit)}function h(t){const e=f(t)
return e?.unitCode??l(t?.stockUnit)??l(t?.unit)??l(t?.rateUnit)??l(t?.displayUnit)??l(t?.baseUnit)??"piece"}function U(t,e){const n=b(t,e)
return n?.unitType??l(e)??l(t?.unit)??l(t?.rateUnit)??l(t?.displayUnit)??l(t?.baseUnit)??"piece"}function k(t,e){const n=b(t,e)
return n?.name??l(e)??l(t?.displayUnit)??l(t?.unit)??l(t?.rateUnit)??l(t?.baseUnit)??"piece"}function v(t,e){const o=b(t,e)
return o&&o.conversionToBase>0?n(o.conversionToBase):void 0}function y(t,e,o){const i=b(t,o)
return i&&i.conversionToBase>0?n(Number(e||0)*i.conversionToBase):r(e,o??t?.unit??t?.rateUnit??t?.displayUnit??t?.baseUnit??"piece",t?.baseUnit)}function N(t,e){const o=g(t),r=b(t,e)
if(r&&r.conversionToBase>0)return n(o/r.conversionToBase)
const s=e??t.unit??t.rateUnit??t.displayUnit??t.baseUnit??"piece"
return i(o,t.baseUnit??s,s)}function w(t){const e=k(t),o=f(t),r="per_pack"===t.packagingMode&&o?n(Number(o.onHandQty??0)):N(t)
return Number.isFinite(r)?`${r.toLocaleString("en-IN")} ${e}`:e}function C(t,e){const o=b(t,e)
return n(Number((t?.averageCostPrice??t?.costPerRateUnit??t?.costPrice??o?.costPrice??0)||0))}function B(t,e){return n(N(t,e)*C(t,e))}function T(t,e){const o=Number(e?.costPrice??0)
if(o>0)return n(o)
const r=C(t),i=f(t),s=Number(i?.conversionToBase??0),c=Number(e?.conversionToBase??0)
return r>0&&s>0&&c>0?s===c?r:n(r/s*c):r}function P(t){return!1!==(t?.stockTrackingEnabled??t?.trackStock??!0)}function S(t){const e=_(t),o=P(e),r=d(e)
if("per_pack"===e.packagingMode&&r.length>0)return r.map(t=>{const r=n(Number(t.onHandQty??0)),i=Number(t.lowStockThreshold??0),s=T(e,t)
return{key:`${e.id}:${t.unitCode}`,item:e,unit:t,unitCode:t.unitCode,label:t.name??t.unitCode,quantity:r,unitCost:s,value:n(r*s),isTracked:o,isOut:o&&r<=0,isLow:o&&i>0&&r>0&&r<=i}})
const i=h(e),s=N(e,i),c=g(e),u=Number(e.lowStockThreshold??e.low_stock_threshold??0),a=C(e,i)
return[{key:e.id,item:e,unitCode:i,label:k(e,i),quantity:s,unitCost:a,value:n(s*a),isTracked:o,isOut:o&&c<=0,isLow:o&&u>0&&c>0&&c<=u}]}function _(t){const e=t,n=g(t),o={...t,stockBaseQty:n},r=h(o),i=N(o,r),s=C(o,r),c=a(t.lowStockThreshold,t.low_stock_threshold)??0
return{...t,productId:l(e.productId)??t.id,stockBaseQty:n,stockQuantity:i,stockUnit:r,unit:U(o,r),displayUnit:k(o,r),rateUnit:U(o,r),averageCostPrice:s,costPerRateUnit:s,costPrice:s,isLowStock:c>0&&n<=c}}function M(t){const e=t
return[e.productId,e.product_id,e.id,e.local_id,e.localId,e.server_id,e.serverId,e.clientProductId,e.client_product_id].map(l).filter(t=>Boolean(t))}function Q(t,e){if(!t)return _(e)
const n={...t,...e},o=a(e.averageCostPrice,e.costPerRateUnit,e.costPrice)
void 0!==o&&(n.averageCostPrice=o,n.costPerRateUnit=o,n.costPrice=o)
for(const r of["imageUrl","barcode","sku","aliases","sellingUnits","brand","description","mrp"])null!==n[r]&&void 0!==n[r]||null==t[r]||(n[r]=t[r])
return _(n)}function x(...t){const e=t.flatMap(t=>t??[]).filter(t=>t&&!(t=>{const e=t
return null!=t.deletedAt||null!=e.deleted_at})(t)),n=new Map,o=new Map,r=[]
for(const i of e){const t=M(i),e=[...new Set(t.map(t=>o.get(t)).filter(t=>Boolean(t)))],s=e[0]??t[0]
if(!s){r.push(_(i))
continue}let c=n.get(s)
for(const r of e.slice(1)){c=Q(c,n.get(r)),n.delete(r)
for(const[t,e]of o)e===r&&o.set(t,s)}n.set(s,Q(c,i)),t.forEach(t=>o.set(t,s))}return[...n.values(),...r]}function L(t,...e){const n=new Set
for(const o of t??[])o&&M(o).forEach(t=>n.add(t))
return 0===n.size?[]:x(...e,t).filter(t=>M(t).some(t=>n.has(t)))}export{d as a,N as b,S as c,h as d,T as e,b as f,C as g,y as h,w as i,U as j,c as k,k as l,x as m,_ as n,i as o,P as p,B as q,n as r,v as s,r as t,u,L as v,g as w,p as x}
