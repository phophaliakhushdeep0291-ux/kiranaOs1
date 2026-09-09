const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/kirana-catalog.generated-UgfmrhJj.js","assets/index-CYG8yywH.js","assets/vendor-data-BaHBZjtO.js","assets/vendor-react-CdF70ZyV.js","assets/vendor-ui-CIi-vqR6.js","assets/vendor-validation-C84QDzN5.js","assets/index-B-026ryc.css","assets/product-import-csv-n-wU1CUa.js","assets/product-form-state-B1XDDhgV.js","assets/product-pricing-CIkCS_1x.js"])))=>i.map(i=>d[i]);
import{J as t,eh as e,ej as r,aO as a}from"./index-CYG8yywH.js"
import{P as n,a as o,b as i,f as s}from"./product-import-csv-n-wU1CUa.js"
function c(t){for(const e of t)Object.freeze(e.aliases),Object.freeze(e)
return Object.freeze(t)}function l(t){return/[",\n]/.test(t)?`"${t.replace(/"/g,'""')}"`:t}const d={name:t=>t.name,category:t=>t.category,unit:t=>t.unit,skuBarcode:t=>t.skuBarcode,mrp:t=>String(t.mrp),costPrice:t=>String(t.costPrice),sellingPrice:t=>String(t.sellingPrice),gstRate:t=>String(t.gstRate),stockQuantity:t=>String(t.stockQuantity),lowStockAlert:t=>String(t.lowStockAlert),reorderLevel:t=>String(t.reorderLevel),hsn:t=>t.hsn,brand:t=>t.brand,aliasesText:t=>t.aliases.join(", "),description:t=>t.description,packSizeValue:t=>String(t.packSizeValue),packSizeUnit:t=>t.packSizeUnit,isLooseItem:t=>t.isLooseItem?"yes":"no",isActive:t=>t.isActive?"yes":"no",sellingUnits:()=>"",imageUrl:()=>""},p="Artha kirana starter catalog",u="starter-catalog"
async function g(a,{signal:c,onProgress:g,batchSize:A=40,ownerPin:f,ownerPinReason:S}={},m){const _=(t=>{const e=n.map(t=>{const e=d[t.field]
if(!e)throw new Error(`The starter catalog has no value for the "${t.header}" import column.`)
return e})
return`${n.map(t=>l(t.header)).join(",")}\n${t.map(t=>e.map(e=>l(e(t))).join(",")).join("\n")}\n`})(a),R=o(_,void 0,m)
if(R.headerError)throw new Error(`The built-in catalog did not parse: ${R.headerError}`)
const w=await t.getAll("products"),T=i(R,w,"skip-existing"),h=T.rows.flatMap(t=>"create"===t.action&&t.finalInput?[{action:"create",rowNumber:t.rowNumber,input:t.finalInput}]:[]),k=s(_),C=h.length
let y=0
g?.({created:y,total:C})
try{for(let t=0;t<C;t+=A){if(c?.aborted)return{created:y,skipped:T.skipCount,invalid:T.errorCount,total:C,cancelled:!0}
const r=h.slice(t,t+A)
await e(r,{fingerprint:`${k}-${t/A}`,fileName:p,source:u,totalRows:r.length,skippedRows:0,errorRows:0},f?{ownerPin:f,reason:S||"Approved built-in starter catalog"}:void 0,{deferCacheRefresh:!0}),y+=r.length,g?.({created:y,total:C})}}finally{y>0&&await r()}return{created:y,skipped:T.skipCount,invalid:T.errorCount,total:C,cancelled:!1}}async function A(t={}){const{KIRANA_STARTER_CATALOG:e}=await a(async()=>{const{KIRANA_STARTER_CATALOG:t}=await import("./kirana-catalog.generated-UgfmrhJj.js")
return{KIRANA_STARTER_CATALOG:t}},__vite__mapDeps([0,1,2,3,4,5,6,7,8,9]))
return g(e,t)}const f=Object.freeze(Object.defineProperty({__proto__:null,STARTER_CATALOG_FILE_NAME:p,STARTER_CATALOG_SOURCE:u,importStarterCatalogItems:g,loadKiranaStarterCatalog:A,loadStarterCatalogForBusinessType:async(t,e={})=>{if("kirana"===t)return A(e)
const{tradeStarterCatalog:r}=await a(async()=>{const{tradeStarterCatalog:t}=await import("./trade-catalogs-D3jo5mkH.js")
return{tradeStarterCatalog:t}},[])
return g(r(t),e,t)}},Symbol.toStringTag,{value:"Module"}))
export{c as f,f as l}
