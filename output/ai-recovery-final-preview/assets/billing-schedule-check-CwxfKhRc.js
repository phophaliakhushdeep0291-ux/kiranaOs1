import{r as e}from"./settle-checks-BvFvcl9V.js"
const t=new Set(["h","h1","x"]),r={h:1,x:2,h1:3}
function s(e){const r=e.product?.drugSchedule,s=String(r??"").trim().toLowerCase()
return t.has(s)?s:null}async function o(e){const t=(e.cart??[]).map(e=>({item:e,schedule:s(e)})).filter(e=>null!==e.schedule)
return 0===t.length||e.slotValues?.["pharmacy/prescription"]?null:{title:{key:"shopType.pharmacy.settle.noPrescriptionTitle",vars:{schedule:t.map(e=>e.schedule).reduce((e,t)=>r[t]>r[e]?t:e,t[0].schedule).toUpperCase()}},body:{key:"shopType.pharmacy.settle.noPrescriptionBody",vars:{items:t.map(e=>e.item.product?.name).filter(Boolean).join(", ")}},confirm:{key:"shopType.pharmacy.settle.noPrescriptionConfirm"}}}e({id:"pharmacy/schedule-slip",run:o})
export{o as unslippedScheduleLines}
