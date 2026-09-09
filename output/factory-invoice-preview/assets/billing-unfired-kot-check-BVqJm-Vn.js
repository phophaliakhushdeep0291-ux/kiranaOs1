import{r as t}from"./settle-checks-BvFvcl9V.js"
import{l as r}from"./restaurant-api-BVtmYTDQ.js"
import{p as e}from"./table-store-BzwiBCDE.js"
import"./index-DtTTo2f-.js"
import"./vendor-data-BaHBZjtO.js"
import"./vendor-react-CdF70ZyV.js"
import"./vendor-ui-CIi-vqR6.js"
import"./vendor-validation-C84QDzN5.js"
import"./billing-calculations-sn4kidtF.js"
async function i(t){if(!t.tableId||!t.cart.length)return null
const i=await r({includeServed:!0}),n=e(t.cart,i.filter(r=>r.billId===t.billId))
return n.length?{title:{key:"restaurant.settle.unfiredTitle",vars:{count:n.length}},body:{key:"restaurant.settle.unfiredBody",vars:{items:n.map(t=>`${t.qty}× ${t.name}`).join(", ")}},confirm:{key:"restaurant.settle.unfiredConfirm"}}:null}t({id:"restaurant/unfired-kot",run:i})
export{i as unfiredKitchenLines}
