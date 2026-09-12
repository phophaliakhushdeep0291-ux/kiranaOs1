import{a as e}from"./vendor-data-BaHBZjtO.js"
import{T as t,an as i,ak as n,ao as r,J as u}from"./index-DtTTo2f-.js"
var o=(e=>(e.CUSTOMER_FIXED_PRICE="CUSTOMER_FIXED_PRICE",e.CUSTOMER_QUANTITY_PRICE="CUSTOMER_QUANTITY_PRICE",e.CUSTOMER_GROUP_PRICE="CUSTOMER_GROUP_PRICE",e.CUSTOMER_GROUP_QUANTITY_PRICE="CUSTOMER_GROUP_QUANTITY_PRICE",e.PRODUCT_QUANTITY_PRICE="PRODUCT_QUANTITY_PRICE",e.SELLING_UNIT_PRICE="SELLING_UNIT_PRICE",e.PROMOTIONAL_PRICE="PROMOTIONAL_PRICE",e.PAYMENT_METHOD_PRICE="PAYMENT_METHOD_PRICE",e.LEARNED_RECOMMENDATION="LEARNED_RECOMMENDATION",e.DEFAULT_PRICE="DEFAULT_PRICE",e))(o||{})
const a={CUSTOMER_QUANTITY_PRICE:1,CUSTOMER_FIXED_PRICE:2,CUSTOMER_GROUP_QUANTITY_PRICE:3,CUSTOMER_GROUP_PRICE:4,PRODUCT_QUANTITY_PRICE:5,SELLING_UNIT_PRICE:6,PROMOTIONAL_PRICE:7,LEARNED_RECOMMENDATION:8,PAYMENT_METHOD_PRICE:9,DEFAULT_PRICE:100},c=.005
function l(e){return e.priority??a[e.ruleType]??100}function d(e){let t=0
return e.locationId&&(t+=16),e.customerId&&(t+=8),e.customerGroup&&(t+=4),e.sellingUnitId&&(t+=3),e.unitCode&&(t+=2),null==e.minQuantity&&null==e.maxQuantity||(t+=1),t}function s(e,i){if(null!=e.fixedUnitPrice&&e.fixedUnitPrice>0)return t(e.fixedUnitPrice)
const n=i.defaultPrice,r=i.productCost??0,u=e.adjustmentValue??0
switch(e.adjustmentType){case"FIXED_PRICE":return t(u)
case"FIXED_DISCOUNT":return t(n-u)
case"PERCENTAGE_DISCOUNT":return t(n*(1-u/100))
case"MARKUP_ON_COST":return t(r*(1+u/100))
case"MARGIN_ON_COST":return u>=100?null:t(r/(1-u/100))
default:return null}}function m(e,t){return e.locationId&&e.locationId!==t.locationId?[!1,"Different store location"]:e.productId&&e.productId!==t.productId?[!1,"Different product"]:e.sellingUnitId&&e.sellingUnitId!==t.sellingUnitId?[!1,"Different selling unit or pack size"]:e.unitCode&&e.unitCode!==t.unitCode?[!1,`Applies to unit ${e.unitCode}`]:e.customerId&&e.customerId!==t.customerId?[!1,"Different customer"]:e.customerGroup&&e.customerGroup!==t.customerGroup?[!1,`Applies to ${e.customerGroup} group`]:e.paymentMethod&&e.paymentMethod!==t.paymentMethod?[!1,`Applies to ${e.paymentMethod} payments`]:null!=e.minQuantity&&t.quantity<e.minQuantity-c?[!1,`Minimum quantity is ${e.minQuantity}`]:null!=e.maxQuantity&&t.quantity>e.maxQuantity+c?[!1,`Maximum quantity is ${e.maxQuantity}`]:((e,t)=>{const i=new Date(t).getTime()
return!(Number.isFinite(i)&&(e.validFrom&&new Date(e.validFrom).getTime()>i||e.validUntil&&new Date(e.validUntil).getTime()<i))})(e,t.billDate)?null==s(e,t)?[!1,"Rule could not resolve a price"]:[!0,"Matched"]:[!1,"Rule not valid on this date"]}function p(e,t=0){const i=Number(e)
return Number.isFinite(i)?i:t}function I(e){const t=e,i=p(t.sellingPrice??t.defaultPricePerRateUnit),n=[],r=p(t.retailPrice??t.retailPricePerRateUnit,i),u=p(t.retailFromQuantity,1),a=p(t.wholesalePrice??t.wholesalePricePerRateUnit,i),c=p(t.wholesaleFromQuantity,0)
return c>0&&a>0&&n.push({id:`product:${e.id}:wholesale`,ruleType:o.PRODUCT_QUANTITY_PRICE,productId:e.id,minQuantity:c,fixedUnitPrice:a,label:`Bulk price for ${c}+ units`,confidence:1}),r>0&&r!==i&&u>0&&n.push({id:`product:${e.id}:retail`,ruleType:o.PRODUCT_QUANTITY_PRICE,productId:e.id,minQuantity:u,maxQuantity:c>0?c-1:void 0,fixedUnitPrice:r,label:u>1?`Quantity price for ${u}+ units`:void 0,confidence:1}),n}const P=new Set(Object.values(o))
function R(e){return e?.id&&P.has(e.ruleType)?e.status&&"ACTIVE"!==e.status?null:{id:e.id,ruleType:e.ruleType,priority:e.priority??void 0,productId:e.productId??void 0,locationId:e.locationId??void 0,sellingUnitId:e.sellingUnitId??void 0,unitCode:e.unitCode??void 0,customerId:e.customerId??void 0,customerGroup:e.customerGroup??void 0,paymentMethod:e.paymentMethod??void 0,minQuantity:e.minQuantity??void 0,maxQuantity:e.maxQuantity??void 0,fixedUnitPrice:e.fixedUnitPrice??void 0,adjustmentType:e.adjustmentType??void 0,adjustmentValue:e.adjustmentValue??void 0,combinePolicy:e.combinePolicy??void 0,validFrom:e.validFrom??void 0,validUntil:e.validUntil??void 0,requiresOwnerApproval:e.requiresOwnerApproval??!1,label:e.name,confidence:1}:null}function E(e,n){const r=!1===n.useLegacyProductRules?(n.shopRules??[]).filter(t=>t.productId!==e.id||Boolean(t.sellingUnitId||t.unitCode)):n.shopRules??[],u=[...!1===n.useLegacyProductRules?[]:I(e),...r],a=((e,t)=>{const i=e,n=p(t.defaultPrice??i.sellingPrice??i.defaultPricePerRateUnit)
return{shopId:t.shopId,locationId:t.locationId,productId:e.id,sellingUnitId:t.sellingUnitId,unitCode:t.unitCode??e.rateUnit??e.displayUnit??"piece",unitLabel:t.unitLabel,customerId:t.customerId,customerGroup:t.customerGroup,quantity:t.quantity,billDate:t.billDate,paymentMethod:t.paymentMethod,productCost:p(t.productCost??i.averageCostPrice??i.costPrice??e.costPerRateUnit),defaultPrice:n,minimumSellingPrice:p(t.minimumSellingPrice??i.minimumSellingPrice??e.minPricePerRateUnit),maximumRetailPrice:p(t.maximumRetailPrice??e.mrp),source:t.source,staffUserId:t.staffUserId,deviceId:t.deviceId}})(e,{shopId:n.shopId??"",locationId:n.locationId??i()??void 0,quantity:n.quantity,billDate:n.billDate??(new Date).toISOString(),unitCode:n.unitCode,sellingUnitId:n.sellingUnitId,unitLabel:n.unitLabel,defaultPrice:n.defaultPrice,minimumSellingPrice:n.minimumSellingPrice,maximumRetailPrice:n.maximumRetailPrice,productCost:n.productCost,customerId:n.customerId,customerGroup:n.customerGroup,paymentMethod:n.paymentMethod,source:n.source??"BILLING"})
return((e,i)=>{const n=t(e.defaultPrice),r=t(e.minimumSellingPrice??0),u=e.maximumRetailPrice&&e.maximumRetailPrice>0?t(e.maximumRetailPrice):null,a=[],p=[]
for(const t of i){const[i,n]=m(t,e)
a.push({ruleId:t.id,ruleType:t.ruleType,matched:i,reason:n}),i&&p.push({rule:t,price:s(t,e)})}p.sort((e,t)=>{const i=l(e.rule),n=l(t.rule)
if(i!==n)return i-n
const r=d(e.rule),u=d(t.rule)
return r!==u?u-r:Math.abs(e.price-t.price)>c?e.price-t.price:e.rule.id.localeCompare(t.rule.id)})
const I=p[0],P=I?I.price:n,R=I?.rule.minimumMarginPercent??e.minimumMarginPercent,E=e.productCost&&null!=R&&R>0&&R<100?t(e.productCost/(1-R/100)):0,C=t(Math.max(r,E))
let T=P,U=!1,_=!1
C>0&&T<C-c&&(U=!0,T=C),null!=u&&T>u+c&&(_=!0,T=u),T=t(T)
const f=I?I.rule.ruleType:o.DEFAULT_PRICE,y=I?I.rule.id:null,O=I?I.rule.confidence??1:1,M=!!U||Boolean(I?.rule.requiresOwnerApproval),N=U?`Price is below the minimum of ₹${C}. Owner approval required.`:I?((e,t)=>{if(e.label)return e.label
switch(e.ruleType){case o.CUSTOMER_FIXED_PRICE:return"Customer price applied"
case o.CUSTOMER_QUANTITY_PRICE:return`Customer bulk price for ${t.quantity}+ ${t.unitLabel??t.unitCode}`
case o.CUSTOMER_GROUP_PRICE:return`${t.customerGroup??"Group"} customer price applied`
case o.CUSTOMER_GROUP_QUANTITY_PRICE:return`${t.customerGroup??"Group"} bulk price applied`
case o.PRODUCT_QUANTITY_PRICE:return`Quantity price applied: ${e.minQuantity??""}+ ${t.unitLabel??t.unitCode}`
case o.SELLING_UNIT_PRICE:return`Price for ${t.unitLabel??t.unitCode}`
case o.PROMOTIONAL_PRICE:return e.label??"Promotional price applied"
case o.PAYMENT_METHOD_PRICE:return`${t.paymentMethod??"Payment"} price applied`
case o.LEARNED_RECOMMENDATION:return"Suggested from past accepted sales"
default:return"Default product price applied"}})(I.rule,e):"Default product price applied",A=Array.from(new Set(p.map(e=>e.price).filter(e=>Math.abs(e-T)>c))).slice(0,3)
return{recommendedUnitPrice:T,originalUnitPrice:n,minimumAllowedPrice:C,maximumAllowedPrice:u,appliedRuleId:y,appliedRuleType:f,explanation:N,confidence:O,requiresApproval:M,alternativePrices:A,calculationVersion:"pricing-v1",trace:{consideredRules:a,selectedRuleId:y,finalPrice:T,belowMinimum:U,aboveMaximum:_}}})(a,u)}function C(e="ACTIVE"){const t=e?`?status=${encodeURIComponent(e)}`:""
return n(`/pricing/rules${t}`,{cache:"no-store"})}function T(e,t){return n("/pricing/rules",{method:"POST",ownerPin:t,body:JSON.stringify(e)})}function U(e,t,i){return n(`/pricing/rules/${encodeURIComponent(e)}`,{method:"PATCH",ownerPin:i,body:JSON.stringify(t)})}function _(e,t){return n(`/pricing/rules/${encodeURIComponent(e)}`,{method:"DELETE",ownerPin:t})}function f(e){return n(`/pricing/products/${encodeURIComponent(e)}/units`,{cache:"no-store"})}function y(e,t,i){return n(`/pricing/products/${encodeURIComponent(e)}/units`,{method:"POST",ownerPin:i,body:JSON.stringify(t)})}function O(e,t,i){return n(`/pricing/products/${encodeURIComponent(e)}/units/${encodeURIComponent(t)}`,{method:"DELETE",ownerPin:i})}const M=e=>`kirana-os:pricing-rules:v2:${e??"primary"}`
async function N(e=i()){const t=await u.getSetting(M(e)).catch(()=>null)
return Array.isArray(t)?t:[]}async function A(e=i()){try{const t=(await C("ACTIVE")).rules??[]
return await(async(e,t=i())=>{await u.setSetting(M(t),e).catch(()=>{})})(t,e),t}catch{return N(e)}}function g(){const[t,n]=e.useState([]),[u,o]=e.useState(0),[a,c]=e.useState(()=>i())
return e.useEffect(()=>{const e=()=>c(i())
return window.addEventListener(r,e),()=>window.removeEventListener(r,e)},[]),e.useEffect(()=>{let e=!0
return n([]),N(a).then(t=>{e&&n(t)}),A(a).then(t=>{e&&n(t)}),()=>{e=!1}},[u,a]),{rules:e.useMemo(()=>t.map(R).filter(e=>null!=e),[t]),refresh:()=>o(e=>e+1)}}export{y as a,O as b,T as c,_ as d,f as e,g as f,E as g,C as l,A as r,U as u}
