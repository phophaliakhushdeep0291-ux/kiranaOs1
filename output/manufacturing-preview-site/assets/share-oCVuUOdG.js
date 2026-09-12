const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/index-Ci-XYli4.js","assets/vendor-data-BaHBZjtO.js","assets/vendor-react-CdF70ZyV.js","assets/vendor-ui-CIi-vqR6.js","assets/vendor-validation-C84QDzN5.js","assets/index-B-026ryc.css"])))=>i.map(i=>d[i]);
import{aO as t}from"./index-Ci-XYli4.js"
function e(t,e=0){const o=Number(t)
return Number.isFinite(o)?o:e}function o(t,e=""){return"string"==typeof t?t:null==t?e:String(t)}function r(t){const e=Math.abs(t)
return"₹"+(Number.isInteger(e)?String(e):e.toFixed(2))}function n(t){const e=String(t??"").replace(/\D/g,"")
return e?10===e.length?"91"+e:11===e.length&&e.startsWith("0")?"91"+e.slice(1):12===e.length&&e.startsWith("91")?e:13===e.length&&e.startsWith("091")?e.slice(1):e:""}function i(t){if(!t)return""
const e=new Date(t)
return Number.isNaN(e.getTime())?"":e.toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}function s(t){const e=o(t).toLowerCase()
if(e)return"upi"===e?"UPI":"udhar"===e?"Udhar":"gift_card"===e?"Store credit":e.charAt(0).toUpperCase()+e.slice(1)}function a(t,e,r){const n=[...new Set((t??[]).map(t=>o(t.mode).toLowerCase()).filter(Boolean))].filter(t=>"credit"!==t)
return e>0&&r>0&&e>=r-.005?"Udhar":e>0&&n.length>0||n.length>1?"Split":n.includes("upi")?"UPI":n.includes("cash")?"Cash":e>0?"Udhar":void 0}function u(t){return c(t.customerMobile,(t=>{const e=[`🧾 *${t.shopName||"मेरी दुकान"} से आपका बिल*`,`बिल नंबर: ${t.billNo}`,`कुल राशि: *${r(t.total)}*`,t.showPreviousUdhar&&Number(t.previousUdhar)>0?`पिछला उधार: ${r(Number(t.previousUdhar))}`:"",t.showGst&&Number(t.gst)>0?`GST: ${r(Number(t.gst))}`:"",t.receiptUrl?`बिल देखें: ${t.receiptUrl}`:"","धन्यवाद 🙏",""].filter(Boolean)
e.push(`🧾 *${t.shopName||"My Shop"}*`),t.shopLocation&&e.push(t.shopLocation)
const o=[`Bill ${t.billNo}`,i(t.dateIso)].filter(Boolean).join(" · ")
o&&e.push(o),t.isReturn&&e.push("_Return / Refund_"),e.push("")
for(const i of t.items)e.push(`• ${i.name} — ${Math.abs(i.quantity)} × ${r(i.rate)} = ${r(i.lineTotal)}`)
t.items.length&&e.push("")
const n=t.paymentMode?` (${t.paymentMode})`:""
return t.isReturn?(e.push(`*Refund total: ${r(t.total)}*`),Math.abs(t.paid)>.005&&e.push(`Refunded to you: ${r(t.paid)}${n}`),t.credit<-.005&&e.push(`Udhar reduced by: ${r(t.credit)}`)):(e.push(`*Total: ${r(t.total)}*`),t.paid>.005&&e.push(`Paid: ${r(t.paid)}${n}`),t.credit>.005&&e.push(`Udhar baki: ${r(t.credit)}`)),e.push(""),e.push("Thank you! 🙏"),e.join("\n")})(t))}function c(t,e){const o=n(t),r=encodeURIComponent(e)
return o?`https://wa.me/${o}?text=${r}`:`https://wa.me/?text=${r}`}function l(t,r={}){const n=(r.items??(Array.isArray(t.items)?t.items:[])).map(t=>{const r=e(t.quantity??t.qty,0),n=e(t.ratePerRateUnit??t.rate_per_rate_unit??t.rate,0),i=e(t.line_total??t.lineTotal,r*n)
return{name:o(t.name??t.productName??t.product_name,"Item"),quantity:r,rate:n,lineTotal:i}}),i=o(t.billType??t.bill_type,"normal_sale"),u=r.total??e(t.grandTotal??t.totalAmount??t.total,0),c=r.credit??e(t.creditAmount??t.credit_amount,0),l=r.paid??e(t.paidAmount??t.buyerPaidAmount,Math.max(0,u-c))
return{shopName:r.shopName||"My Shop",shopLocation:r.shopLocation,billNo:o(t.billNo??t.billNumber??t.bill_no??t.id,"—"),dateIso:o(t.businessDate??t.business_date??t.createdAt??t.created_at)||void 0,items:n,total:u,paid:l,credit:c,paymentMode:r.paymentMode??a(r.payments,c,u)??s(t.refundMode??t.refund_mode),customerName:o(t.customerName??t.customer_name)||void 0,customerMobile:r.customerMobile||o(t.customerMobile??t.customer_mobile)||void 0,previousUdhar:r.previousUdhar,gst:r.gst,showPreviousUdhar:r.showPreviousUdhar,showGst:r.showGst,receiptUrl:r.receiptUrl,isReturn:"sales_return"===i}}async function d(e){const r=o(e.customerMobile??e.customer_mobile)
if(r)return r
const n=o(e.customerId??e.customer_id)
if(n)try{const{offlineDB:e}=await t(async()=>{const{offlineDB:t}=await import("./index-Ci-XYli4.js").then(t=>t.ek)
return{offlineDB:t}},__vite__mapDeps([0,1,2,3,4,5])),r=(await e.getAll("customers")).find(t=>[t.id,t.local_id,t.server_id].some(t=>"string"==typeof t&&t===n))
return o(r?.mobile??r?.customerMobile??r?.customer_mobile)||void 0}catch{return}}function m(t){const e=u(t),o="undefined"!=typeof window&&Boolean(window.open(e,"_blank","noopener,noreferrer"))
return{targetedCustomer:Boolean(n(t.customerMobile)),opened:o}}export{c as a,l as b,u as c,a as d,n,d as r,m as s}
