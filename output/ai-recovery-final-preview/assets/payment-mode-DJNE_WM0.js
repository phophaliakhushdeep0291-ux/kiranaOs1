function t(t){const n=Number(t)
return Number.isFinite(n)?n:0}const n=["credit","partial","unpaid","due"]
function e(e){const r=String(e.paymentStatus??e.payment_status??"").toLowerCase()
if((n=>Math.max(t(n.creditAmount??n.credit_amount),t(n.udharAmount??n.udhar_amount),t(n.dueAmount??n.due_amount),t(n.outstandingAmount??n.outstanding_amount)))(e)>0||n.includes(r))return"udhar"
const a=String(e.paymentMode??e.payment_mode??"").toLowerCase()
if(a&&"credit"!==a)return a
const o=Array.isArray(e.payments)?e.payments:[],u=[...new Set(o.filter(n=>"credit"!==String(n.mode??"").toLowerCase()&&t(n.amount)>0).map(t=>String(t.mode??"").toLowerCase()))]
return u.length>1?"split":1===u.length?u[0]:"cash"}export{e as r}
