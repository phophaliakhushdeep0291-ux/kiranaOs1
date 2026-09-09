import{Z as e}from"./index-DtTTo2f-.js"
function r(e){return[...new Set(["purchase_history_id","purchaseHistoryId","purchase_bill_id","purchaseBillId","local_purchase_history_id","localPurchaseHistoryId","localPurchaseBillId","local_purchase_bill_id"].map(r=>String(e[r]??"")).filter(Boolean))]}function s(e){return["id","local_id","server_id","localId","serverId"].map(r=>String(e[r]??"")).filter(Boolean)}function a(r,a){const t=a.flatMap(e=>Array.isArray(e.supplierPayments)?e.supplierPayments.filter(e=>Boolean(e)&&"object"==typeof e):[]),i=[...r,...t],l=[]
for(const e of r){if("supplier_payment"!==e.kind||"reversed"!==e.status||!e.reversed_at)continue
const r=s(e)
i.some(e=>r.includes(String(e.reverses_payment_id??"")))||l.push({...e,id:`reversal:${r[0]}`,local_id:`reversal:${r[0]}`,server_id:void 0,status:"active",amount:-Math.abs(Number(e.amount)||0),paid_at:e.reversed_at,created_at:e.reversed_at,reverses_payment_id:r[0]})}const o=i.map(e=>"supplier_payment"===e.kind&&"reversed"===e.status&&e.reversed_at?{...e,status:"active"}:e)
return e([...o,...l])}export{a as m,r as s}
