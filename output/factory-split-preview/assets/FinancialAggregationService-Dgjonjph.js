import{aZ as e,M as t,P as a,T as n,J as r,a_ as o,a$ as i,al as s,aA as u,b0 as c,Z as l,U as d}from"./index-CYG8yywH.js"
import{m as p,s as m}from"./supplier-payment-history-DMqabSla.js"
function _(e=new Date){return`${e.getFullYear()}-${String(e.getMonth()+1).padStart(2,"0")}-${String(e.getDate()).padStart(2,"0")}`}function h(e,t=0){const a=Number(e??t)
return Number.isFinite(a)?a:t}function f(e,t,a=""){if(!y(e))return a
for(const n of t){const t=e[n]
if("string"==typeof t&&t.trim().length>0)return t.trim()
if("number"==typeof t&&Number.isFinite(t))return String(t)}return a}function y(e){return"object"==typeof e&&null!==e&&!Array.isArray(e)}function b(e){const t=String(e.status??e.purchasePaymentStatus??e.purchase_payment_status??"").toLowerCase()
return Boolean(e.deleted_at??e.deletedAt??e.merged_into_id??e.mergedIntoId)||"deleted"===t}function g(e){return f(e,["createdAt","created_at","billDate","bill_date","paidAt","paid_at","entry_at","updatedAt","updated_at"])}function I(e,t=!1){const[a,n,r]=e.split("-").map(Number),o=new Date(a,(n||1)-1,r||1)
return t&&o.setHours(23,59,59,999),o}function v(e,t){const a=g(e)
if(!a)return!1
const n=I(t.from).getTime(),r=I(t.to,!0).getTime(),o=new Date(a).getTime()
return Number.isFinite(o)&&o>=n&&o<=r}function k(e){return[f(e,["id"]),f(e,["local_id","localId"]),f(e,["server_id","serverId"]),f(e,["billId","bill_id"]),f(e,["serverBillId","server_bill_id"]),f(e,["localBillId","local_bill_id"]),f(e,["clientBillId","client_bill_id"])].filter(Boolean)}function S(e,t=!1){return f(e,t?["billId","bill_id","serverBillId","server_bill_id","localBillId","local_bill_id","clientBillId","client_bill_id","reference_id","source_id","id"]:["billId","bill_id","serverBillId","server_bill_id","localBillId","local_bill_id","clientBillId","client_bill_id","reference_id","source_id"])||null}function A(e){return f(e,["customerId","customer_id"])||null}function w(e){return[f(e,["id"]),f(e,["server_id","serverId"]),f(e,["local_id","localId"]),f(e,["paymentId","payment_id"]),f(e,["clientPaymentId","client_payment_id","localPaymentId","local_payment_id"]),f(e,["idempotencyKey","idempotency_key"]),f(e,["ledgerEntryId","ledger_entry_id"]),f(e,["localLedgerEntryId","local_ledger_entry_id"]),f(e,["clientLedgerId","client_ledger_id"])].filter(Boolean)}function N(e){return[f(e,["id"]),f(e,["server_id","serverId"]),f(e,["idempotencyKey","idempotency_key"]),f(e,["paymentId","payment_id"]),f(e,["source_id","sourceId"]),f(e,["localPaymentId","local_payment_id"]),f(e,["clientPaymentId","client_payment_id"]),f(e,["clientLedgerId","client_ledger_id"]),f(e,["local_id","localId"])].filter(Boolean)}function M(e){return f(e,["productId","product_id"])||null}function B(e){return!i(e)&&!(e=>String(e.status??"").toLowerCase().includes("cancel"))(e)&&!(e=>"conflict"===String(e.sync_status??e.syncStatus??"").toLowerCase())(e)}function T(e){return n(h(e.grandTotal??e.grand_total??e.totalAmount??e.total_amount??e.netAmount??e.net_amount??e.actualAmount??e.actual_amount,0))}function P(e){const t=h(e.creditAmount??e.credit_amount??e.dueAmount??e.due_amount,NaN)
return Number.isFinite(t)?n(Math.max(0,t)):n(Math.max(0,T(e)-(e=>n(h(e.paidAmount??e.paid_amount??e.buyerPaidAmount??e.buyer_paid_amount,0)))(e)))}function C(e){return n(h(e.discount??e.discountAmount??e.discount_amount,0))}function x(e){return h(e?.sellingPrice??e?.defaultPricePerRateUnit??e?.retailPrice??e?.retailPricePerRateUnit,0)}function U(e,t){return h(e.costPerRateUnit??e.cost_per_rate_unit??e.costPrice??e.cost_price,(e=>h(e?.costPrice??e?.costPerRateUnit??e?.averageCostPrice,0))(t))}function D(e){return n(h(e.amount??e.paidAmount??e.paid_amount,0))}function K(e){const t=String(e.mode??e.paymentMode??e.payment_mode??"cash").toLowerCase()
return"card"===t||"bank_transfer"===t?"bank":t}function L(e){const t=String(e.status??e.sync_status??"").toLowerCase()
return!b(e)&&!e.reversed_at&&!e.reversedAt&&"reversed"!==t&&"cancelled"!==t}function F(e){return l(e).filter(e=>L(e)).reduce((e,t)=>{const a=K(t)
return"cash"===a&&(e.cash=n(e.cash+D(t))),"upi"===a&&(e.upi=n(e.upi+D(t))),"bank"===a&&(e.bank=n(e.bank+D(t))),e},{cash:0,upi:0,bank:0})}function R(e,t){const a=(e=>{const t=(e=>{const t=Array.isArray(e.payments)?e.payments:[],a=S(e,!0)??void 0,n=A(e)??void 0
return t.filter(y).map(t=>({...t,billId:t.billId??t.bill_id??a,bill_id:t.bill_id??t.billId??a,customerId:t.customerId??t.customer_id??n,customer_id:t.customer_id??t.customerId??n,paidAt:t.paidAt??t.paid_at??t.createdAt??t.created_at??e.businessDate??e.business_date??e.createdAt??e.created_at,paid_at:t.paid_at??t.paidAt??t.created_at??t.createdAt??e.business_date??e.businessDate??e.created_at??e.createdAt}))})(e)
return t.length>0?F(t):{cash:n(h(e.cashAmount??e.cash_amount,0)),upi:n(h(e.upiAmount??e.upi_amount,0)),bank:n(h(e.bankAmount??e.bank_amount,0))}})(e)
return a.cash>0||a.upi>0||a.bank>0?a:((e,t)=>{const a=new Set(k(e))
return 0===a.size?{cash:0,upi:0,bank:0}:F(t.filter(e=>{const t=S(e)
return Boolean(t&&a.has(t))}))})(e,t)}function $(e,t,a){"cash"===t&&(e.cash=n(e.cash+a)),"upi"===t&&(e.upi=n(e.upi+a)),"bank"===t&&(e.bank=n(e.bank+a))}function E(e,t,a){const r=new Map(a.map(e=>[e.id,e])),o=new Map
for(const n of t.filter(e=>!b(e))){const e=S(n)
if(!e)continue
const t=o.get(e)??[]
t.push(n),o.set(e,t)}const i=new Map
for(const u of e){const e=[],t=new Set
for(const n of k(u))for(const a of o.get(n)??[])t.has(a)||(t.add(a),e.push(a))
const a=h(u.subtotal??u.subtotalAmount??u.subtotal_amount,T(u)+C(u)),c=Array.isArray(u.items)?u.items.filter(y).filter(e=>!b(e)):[],l=c.length>0?c:s(e,a)
for(const o of l){const e=M(o)??`custom:${f(o,["name","productName","product_name"],"item")}`,t=r.get(e),a=h(o.quantity??o.qty,0),s=T(u)<0,c=s?-Math.abs(a):a,l=h(o.ratePerRateUnit??o.rate_per_rate_unit??o.rate??o.price,x(t)),d=h(o.line_total??o.lineTotal??o.total,c*l),p=n(s?-Math.abs(d):d),m=n(c*U(o,t)),_=n(p-m),y=i.get(e)??{productId:e,productName:t?.name??f(o,["name","productName","product_name"],"Custom item"),quantity:0,revenue:0,cost:0,profit:0,marginPct:0}
y.quantity=n(y.quantity+c),y.revenue=n(y.revenue+p),y.cost=n(y.cost+m),y.profit=n(y.profit+_),y.marginPct=y.revenue>0?Math.round(y.profit/y.revenue*100):0,i.set(e,y)}}return[...i.values()].sort((e,t)=>t.revenue-e.revenue||t.profit-e.profit)}function j(e){return!b(e)&&"purchase"===String(e.action??e.type??"").toLowerCase()}function q(e){return n(h(e.billAmount??e.bill_amount??e.purchaseBillAmount??e.purchase_bill_amount??e.grandTotal??e.grand_total??e.totalAmount??e.total_amount??e.amount,0))}function O(e){const t=h(e.purchasePaidAmount??e.purchase_paid_amount??e.paidAmount??e.paid_amount,NaN)
if(Number.isFinite(t))return n(Math.max(0,t))
const a=String(e.purchasePaymentStatus??e.purchase_payment_status??e.paymentStatus??e.payment_status??"paid").toLowerCase()
return"due"===a||"unpaid"===a||"pending"===a?0:q(e)}function W(e){const t=h(e.purchaseDueAmount??e.purchase_due_amount??e.dueAmount??e.due_amount,NaN)
return Number.isFinite(t)?n(Math.max(0,t)):n(Math.max(0,q(e)-O(e)))}function H(e){const t=String(e.purchasePaymentMode??e.purchase_payment_mode??e.paymentMode??e.payment_mode??"cash").toLowerCase()
return"card"===t||"bank_transfer"===t?"bank":t}function z(e){return String(e??"").trim().toLowerCase().replace(/\s+/g," ")}function Y(e){return f(e,["invoiceNumber","invoice_number","purchaseBillNo","purchase_bill_no","supplierBillNo","supplier_bill_no","billNo","bill_no"],"-")}function Z(e,t){const a=g(e)
if(!a)return"no-date"
const n=new Date(a).getTime()
return Number.isFinite(n)?t&&"-"!==t?new Date(n).toISOString().slice(0,10):String(Math.floor(n/9e5)):a.slice(0,16)}function J(e){const t=Y(e),a=z(f(e,["supplierId","supplier_id"])||f(e,["supplierName","supplier_name"],"supplier")),n=z(f(e,["productId","product_id"],"product")),r=q(e).toFixed(2),o=O(e).toFixed(2),i=W(e).toFixed(2)
return["purchase-business",a,n,z(t||"-"),r,o,i,Z(e,t)].join("|")}function G(e){const t=Y(e),a=z(f(e,["supplierId","supplier_id"])||f(e,["supplierName","supplier_name"],"supplier")),n=z(f(e,["productId","product_id"],"product")),r=q(e).toFixed(2)
return["purchase-stable",a,n,z(t||"-"),r,Z(e,t)].join("|")}function Q(e){return[f(e,["purchaseHistoryId","purchase_history_id"]),f(e,["purchaseBillId","purchase_bill_id"]),f(e,["localPurchaseHistoryId","local_purchase_history_id"]),f(e,["localPurchaseBillId","local_purchase_bill_id"])].filter(Boolean).map(e=>`purchase-id:${e}`)}function V(e,t){let a="purchase_bill"===t?100:50
const n=String(e.sync_status??e.status??"").toLowerCase()
return"synced"===n&&(a+=10),"pending_sync"!==n&&"syncing"!==n||(a-=5),f(e,["server_id","serverId"])&&(a+=5),a}function X(e,t,a,n){const r=f(e,["supplierId","supplier_id"])||null,o=r?n.get(r):void 0,i=q(e),s=O(e),u=W(e),c="purchase_bill"===a?["status","purchasePaymentStatus","purchase_payment_status"]:["purchasePaymentStatus","purchase_payment_status","status"]
return{id:f(e,["id","local_id","server_id"],"purchase_bill"===a?`purchase_${t}`:`movement_${t}`),purchaseKeys:[...m(e),..."purchase_bill"===a?["id","local_id","server_id","localId","serverId"].map(t=>String(e[t]??"")).filter(Boolean):[]],supplierId:r,supplierName:o?.name??f(e,["supplierName","supplier_name"],"Supplier"),invoiceNumber:Y(e),date:g(e),amount:i,paid:s,due:u,paymentMode:H(e),status:f(e,c,u>0?"due":"paid"),source:a,dedupeKeys:[...Q(e),..."purchase_bill"===a?["id","local_id","server_id","localId","serverId"].map(t=>e[t]?`purchase-id:${e[t]}`:"").filter(Boolean):[],G(e),J(e)],priority:V(e,a)}}function ee(e){const r=e.date??_(),o=e.range??{from:r,to:r},i=t(e.bills??[],{includeUserDeleted:!0}),s=(e.billItems??[]).filter(e=>!b(e)),y=p(e.payments??[],e.purchaseBills??[]).filter(e=>!b(e)),I=a((e.ledger??[]).filter(e=>!b(e))),M=(e.products??[]).filter(e=>!b(e)),x=(e.customers??[]).filter(e=>!b(e)),U=e.suppliers??[],F=e.inventoryMovements??[],q=e.purchaseBills??[],O=i.filter(e=>B(e)&&v(e,o)),W=((e,t,a)=>{const n=new Map(a.map(e=>[e.id,e]))
return e.map(e=>{const a=R(e,t),r=A(e),o=r?n.get(r):void 0,i=T(e)
return{billId:S(e,!0)??f(e,["id"],"unknown"),billNo:f(e,["billNo","billNumber","bill_no","number"],"Bill"),customerId:r,customerName:o?.name??f(e,["customerName","customer_name"],r?"Customer":"Walk-in customer"),amount:i,cash:a.cash,upi:a.upi,bank:a.bank,udhar:P(e),date:g(e),status:f(e,["status"],"saved")}})})(O,y,x),H=n(W.reduce((e,t)=>e+t.amount,0)),z=n(O.reduce((e,t)=>e+C(t),0)),Y=n(W.reduce((e,t)=>e+t.cash,0)),Z=n(W.reduce((e,t)=>e+t.upi,0)),J=n(W.reduce((e,t)=>e+t.bank,0)),G=n(W.reduce((e,t)=>e+t.udhar,0)),Q=E(O,s,M),V=((e,t,a)=>n(e.reduce((e,r)=>{const o=(e=>{const t=e.grossProfit??e.gross_profit
if(null==t||""===t)return null
const a=Number(t)
return Number.isFinite(a)?n(a):null})(r)
return null!==o?e+o:e+E([r],t,a).reduce((e,t)=>e+t.profit,0)-C(r)},0)))(O,s,M),ee=((e,t,a,r,o)=>{const{saleBillIds:i,todaySaleBillIds:s}=((e,t)=>{const a=new Set,n=new Set
for(const r of e.filter(B))for(const e of k(r))a.add(e)
for(const r of t)for(const e of k(r))n.add(e)
return{saleBillIds:a,todaySaleBillIds:n}})(a,r),d=(e=>{const t=new Map
for(const a of e)for(const e of w(a))t.has(e)||t.set(e,a)
return t})(e),p=((e,t)=>e.reduce((e,a)=>{const r=R(a,t)
return e.cash=n(e.cash+r.cash),e.upi=n(e.upi+r.upi),e.bank=n(e.bank+r.bank),e},{cash:0,upi:0,bank:0}))(r,e),m=new Set,_=t.filter(e=>(e=>!b(e)&&!e.reversed_at&&!e.reversedAt)(e)&&v(e,o)&&"PAYMENT"===u(e.type,e.source_type)).filter(e=>{const t=S(e)
return!t||!i.has(t)||!s.has(t)}).reduce((e,t)=>{for(const a of N(t))m.add(a)
return $(e,((e,t)=>{const a=f(e,["mode","paymentMode","payment_mode"])
if(a)return K({mode:a})
for(const n of N(e)){const e=t.get(n)
if(e)return K(e)}return"cash"})(t,d),Math.abs(c(t))),e},{cash:0,upi:0,bank:0}),h={cash:0,upi:0,bank:0},y={cash:0,upi:0,bank:0}
for(const n of l(e.filter(e=>L(e)&&v(e,o)))){if(w(n).some(e=>m.has(e)))continue
const e=S(n),t=Boolean(e&&i.has(e)&&!s.has(e))
e&&s.has(e)||(t?$(h,K(n),D(n)):!e&&A(n)&&$(y,K(n),D(n)))}const g=((e,t)=>{const a=(e,t)=>n(t>0&&e+.004>=t?Math.max(0,e-t):e)
return{cash:a(e.cash,t.cash),upi:a(e.upi,t.upi),bank:a(e.bank,t.bank)}})(y,p)
return{cash:n(_.cash+h.cash+g.cash),upi:n(_.upi+h.upi+g.upi),bank:n(_.bank+h.bank+g.bank)}})(y,I,i,O,o),te=n(Y+ee.cash),ae=n(Z+ee.upi),ne=n(J+ee.bank),re=((e,t)=>{const a=new Map(t.map(e=>[e.id,e])),r=new Map
for(const n of e.filter(e=>!b(e))){const e=A(n)
if(!e)continue
const t=r.get(e)??[]
t.push(n),r.set(e,t)}const o=[]
if(r.size>0)for(const[i,s]of r.entries()){const e=n(Math.max(0,d(s)))
if(e<=0)continue
const t=a.get(i)
o.push({customerId:i,customerName:t?.name??"Customer",mobile:t?.mobile??null,outstanding:e})}else for(const i of t.filter(e=>!b(e))){const e=n(Math.max(0,h(i.udharAmount??i.totalUdhar,0)))
e<=0||o.push({customerId:i.id,customerName:i.name,mobile:i.mobile??null,outstanding:e})}return o.sort((e,t)=>t.outstanding-e.outstanding)})(I,x),oe=((e,t,a)=>{const n=new Map(a.map(e=>[e.id,e]))
return(e=>{const t=new Set,a=[],n=[...e].sort((e,t)=>t.priority-e.priority||t.date.localeCompare(e.date))
for(const r of n){if(r.dedupeKeys.some(e=>t.has(e))){const e=a.find(e=>e.dedupeKeys.some(e=>r.dedupeKeys.includes(e)))
e&&(e.purchaseKeys=[...new Set([...e.purchaseKeys??[],...r.purchaseKeys??[]])],e.dedupeKeys=[...new Set([...e.dedupeKeys,...r.dedupeKeys])],r.dedupeKeys.forEach(e=>t.add(e)))
continue}r.dedupeKeys.forEach(e=>t.add(e)),a.push(r)}return a.sort((e,t)=>t.date.localeCompare(e.date)).map(({dedupeKeys:e,priority:t,...a})=>a)})([...e.filter(e=>!b(e)).map((e,t)=>X(e,t,"purchase_bill",n)),...t.filter(j).map((e,t)=>X(e,t,"inventory_movement",n))])})(q,F,U),ie=oe.filter(e=>e.date&&v({created_at:e.date},o)),se=y.filter(e=>"supplier_payment"===e.kind&&!["reversed","cancelled","voided"].includes(String(e.status??"").toLowerCase())),ue={cash:0,upi:0,bank:0}
for(const t of se){const e=f(t,["paid_at","paidAt","created_at","createdAt"]),a=K(t)
a in ue&&e&&v({created_at:e},o)&&(ue[a]+=h(t.amount,0))}for(const t of ie){const e=new Set([t.id,...t.purchaseKeys??[]]),a=se.filter(t=>m(t).some(t=>e.has(t))).reduce((e,t)=>e+h(t.amount,0),0),r=Math.max(0,n(t.paid-a))
t.paymentMode in ue&&(ue[t.paymentMode]+=r)}const ce=n(ue.cash),le=n(ue.upi),de=n(ue.bank),pe=n(ie.reduce((e,t)=>e+t.due,0)),me=n(oe.reduce((e,t)=>e+t.due,0)),_e=n(Math.max(0,Number(e.openingCash)||0)),he=n(Math.max(0,Number(e.cashIn)||0)),fe=n(Math.max(0,Number(e.cashOut)||0)),ye=n(Math.max(0,Number(e.cashExpenses)||0)),be={openingCash:_e,cashSales:Y,cashUdharRecovery:ee.cash,supplierCashPaid:ce,expenses:ye,ownerWithdrawals:0,cashIn:he,cashOut:fe,expectedClosingCash:n(_e+te+he-ce-ye-fe-0)}
return{generatedAt:e.generatedAt??(new Date).toISOString(),date:r,revenueToday:H,profitToday:n(V),grossMarginPct:H>0?Math.round(V/H*100):0,discountToday:z,cashSalesToday:Y,upiSalesToday:Z,bankSalesToday:J,udharSalesToday:G,cashUdharRecoveryToday:ee.cash,upiUdharRecoveryToday:ee.upi,bankUdharRecoveryToday:ee.bank,totalCashCollectedToday:te,totalUpiCollectedToday:ae,totalBankCollectedToday:ne,totalOutstandingUdhar:n(re.reduce((e,t)=>e+t.outstanding,0)),totalBillsToday:O.length,totalCustomersWithUdhar:re.length,revenueBreakdown:W,profitByProduct:Q,collectionBreakdown:{cashSalesToday:Y,upiSalesToday:Z,bankSalesToday:J,cashUdharRecoveryToday:ee.cash,upiUdharRecoveryToday:ee.upi,bankUdharRecoveryToday:ee.bank,totalCashCollectedToday:te,totalUpiCollectedToday:ae,totalBankCollectedToday:ne},supplierDue:me,supplierDueRows:oe,supplierCashPaidToday:ce,supplierUpiPaidToday:le,supplierBankPaidToday:de,purchaseDueToday:pe,expensesToday:ye,ownerWithdrawalToday:0,cashDrawer:be,outstandingCustomers:re,hasLocalData:i.length>0||y.length>0||I.length>0||M.length>0||x.length>0||oe.length>0,dataSourceLabel:"FinancialAggregationService"}}async function te(e){return r.getAll(e).then(e=>o(e)).catch(()=>[])}const ae={aggregate:ee,buildSnapshot:async(t=_())=>{await e().catch(()=>{})
const[a,n,r,o,i,s,u,c,l]=await Promise.all([te("bills"),te("bill_items"),te("payments"),te("customer_ledger"),te("products"),te("customers"),te("suppliers"),te("inventory_movements"),te("purchase_bills")])
return ee({bills:a,billItems:n,payments:r,ledger:o,products:i,customers:s,suppliers:u,inventoryMovements:c,purchaseBills:l,date:t})}}
export{ae as F,ee as a}
