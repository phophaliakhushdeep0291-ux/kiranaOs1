import{aU as e,e7 as t}from"./index-CYG8yywH.js"
import{e as r,f as i,i as n,p as a,j as o}from"./product-form-state-B1XDDhgV.js"
import{k as s,s as c,c as l,a as u}from"./product-pricing-CIkCS_1x.js"
const d=[{header:"Name",field:"name",example:"Tata Salt 1kg",required:!0},{header:"Category",field:"category",example:"Grocery"},{header:"Unit",field:"unit",example:"piece"},{header:"SKU/Barcode",field:"skuBarcode",example:"8901234567890"},{header:"MRP",field:"mrp",example:"28"},{header:"Cost Price",field:"costPrice",example:"22",required:!0},{header:"Selling Price",field:"sellingPrice",example:"26",required:!0},{header:"GST %",field:"gstRate",example:"0"},{header:"Opening Stock",field:"stockQuantity",example:"100"},{header:"Low Stock Alert",field:"lowStockAlert",example:"10"},{header:"Reorder Level",field:"reorderLevel",example:"20"},{header:"HSN",field:"hsn",example:"25010010"},{header:"Brand",field:"brand",example:"Tata"},{header:"Aliases",field:"aliasesText",example:"namak, salt"},{header:"Description",field:"description",example:"Iodised salt"},{header:"Pack Size",field:"packSizeValue",example:"1"},{header:"Pack Unit",field:"packSizeUnit",example:"kg"},{header:"Loose Item",field:"isLooseItem",example:"no"},{header:"Active",field:"isActive",example:"yes"},{header:"Pack Sizes",field:"sellingUnits",example:"packet 500 gram @ 30 | packet 5 kg @ 265"},{header:"Image URL",field:"imageUrl",example:"https://example.com/tata-salt.jpg"}],p={name:["name","product name","item name","item","stock item","particulars"],category:["category","product category","item category","group","item group","parent"],unit:["unit","uom","base unit","base units","sale unit","sales unit","primary unit"],skuBarcode:["sku barcode","sku","barcode","bar code","item code","product code","code"],mrp:["mrp","item mrp","maximum retail price"],costPrice:["cost price","purchase price","purchase rate","buy price","buying price","standard cost"],sellingPrice:["selling price","sale price","sales price","selling rate","sale rate","standard price"],gstRate:["gst","gst percent","gst rate","tax","tax percent","tax rate"],stockQuantity:["opening stock","opening balance","opening quantity","stock","stock quantity","current stock","closing stock","quantity"],lowStockAlert:["low stock alert","low stock","minimum stock","min stock","alert quantity"],reorderLevel:["reorder level","re order level","reorder quantity","reorder point"],hsn:["hsn","hsn code","hsn sac","hsn sac code"],brand:["brand","manufacturer","company"],aliasesText:["aliases","alias","search aliases","alternate name","alternative name"],description:["description","product description","item description","notes"],packSizeValue:["pack size","packet size","net quantity","net qty","weight","size"],packSizeUnit:["pack unit","packet unit","weight unit","size unit","net unit"],isLooseItem:["loose item","is loose","loose","item type","stock type"],isActive:["active","is active","status","enabled"],sellingUnits:["pack sizes","other pack sizes","extra packs","selling units"]},m=new Set(["mrp","costPrice","sellingPrice","gstRate","stockQuantity","lowStockAlert","reorderLevel","packSizeValue"]),f=new Set(["packet","pack","pouch"])
function h(e){return/[",\n]/.test(e)?`"${e.replace(/"/g,'""')}"`:e}function g(e){return"boolean"===e.type?"no":"select"===e.type?e.options?.[0]??"":(e.placeholder??"").replace(/^e\.g\.\s*/i,"")}function k(e){return o(e).map(e=>({header:e.label,field:`attr:${e.key}`,example:g(e)}))}function v(t=e()){return[...d,...k(t)]}function b(e){const t=[]
let r=[],i="",n=!1
const a=e.replace(/\r\n/g,"\n").replace(/\r/g,"\n")
for(let o=0;o<a.length;o+=1){const e=a[o]
if(n)'"'===e?'"'===a[o+1]?(i+='"',o+=1):n=!1:i+=e
else if('"'===e){if(i.length>0)throw new Error("A quoted value starts after unquoted text.")
n=!0}else","===e?(r.push(i),i=""):"\n"===e?(r.push(i),t.push(r),r=[],i=""):i+=e}if(n)throw new Error("The CSV contains an unclosed quoted value.")
return(i.length>0||r.length>0)&&(r.push(i),t.push(r)),t}function w(e){return e.replace(/^\uFEFF/,"").toLowerCase().replace(/%/g," percent ").replace(/[^a-z0-9]+/g," ").trim()}function y(e){return Array.from(new Set([e.header,...p[e.field]??[]].map(w)))}function S(t,r=e()){const i=t.map(w),n={},a=new Set
for(const e of v(r)){const t=y(e),r=i.findIndex((e,r)=>!a.has(r)&&t.includes(e))
r>=0&&(n[e.field]=r,a.add(r))}return n}function x(e){const t=new Set(e.map(w))
return d.filter(e=>t.has(w(e.header))).length>=8?"kiranaos":t.has("stock item")||t.has("base units")||t.has("standard cost")?"tally":t.has("item mrp")||t.has("purchase rate")||t.has("low stock quantity")?"mybillbook":t.has("item code")&&(t.has("sale price")||t.has("purchase price"))?"vyapar":"generic"}function P(e){const t=b(e).filter(e=>e.some(e=>""!==e.trim()))
if(0===t.length)throw new Error("The file is empty.")
const r=t[0].map((e,t)=>0===t?e.replace(/^\uFEFF/,"").trim():e.trim())
return{headers:r,mapping:S(r),source:x(r),dataRowCount:Math.max(0,t.length-1)}}function z(e){const t=e.trim()
if(!t)return 0
const r=t.startsWith("(")&&t.endsWith(")"),i=t.replace(/[\u20B9,\s]/g,"").replace(/^(?:rs\.?|inr)/i,"").replace(/%$/,"").replace(/^\(/,"").replace(/\)$/,""),n=Number(i)
return Number.isFinite(n)?r?-n:n:Number.NaN}function U(e){const t=(e??"").trim()
if(!t)return""
try{const e=new URL(t)
return"https:"===e.protocol||"http:"===e.protocol?e.toString():""}catch{return""}}function L(e,t){const r=e.trim().toLowerCase()
return r?!!["yes","y","true","1","active","enabled","loose"].includes(r)||!["no","n","false","0","inactive","disabled","packed","packet"].includes(r)&&t:t}const C=/[|;\n]+/
function $(e,t){const r=e.indexOf(t)
return-1===r?[e,void 0]:[e.slice(0,r),e.slice(r+1)]}function A(e){return e.filter(e=>!e.isDefault&&!1!==e.isActive).map(e=>{const t=c(e.unitType,e.packSizeValue,e.packSizeUnit),r=String(e.barcode??"").trim()
return`${t} @ ${Number(e.defaultPrice)||0}${r?` #${r}`:""}`}).join(" | ")}function N(e,t){const r=[],i=[],n=new Set
if(!e.trim())return{units:r,errors:i}
for(const a of e.split(C)){const e=a.trim()
if(!e)continue
const[o,d]=$(e,"#"),[p,m]=$(o,"@")
if(void 0===m){i.push(`Pack "${e}" needs a price — write it as "packet 500 gram @ 30"`)
continue}const f=z(m)
if(!Number.isFinite(f)||f<0){i.push(`Pack "${e}" has no valid price`)
continue}const h=p.trim().split(/\s+/).filter(Boolean)
let g,k,v
if(h.length>=3&&Number(h[1])>0)[g,k,v]=[h[0],Number(h[1]),h[2]]
else if(2===h.length&&Number(h[0])>0)[g,k,v]=[t,Number(h[0]),h[1]]
else{if(1!==h.length||Number.isFinite(Number(h[0]))){i.push(`Pack "${e}" is not a size — write it as "packet 500 gram @ 30"`)
continue}[g,k,v]=[h[0],1,h[0]]}if(g=g.toLowerCase(),v=v.toLowerCase(),!s(v)){i.push(`Pack "${e}" uses an unknown measure "${v}"`)
continue}const b=l(k,v)
if(!(b>0)){i.push(`Pack "${e}" has no size`)
continue}const w=u(g,k,v)
n.has(w)?i.push(`Pack "${c(g,k,v)}" is listed twice`):(n.add(w),r.push({name:c(g,k,v),unitType:g,unitCode:w,packSizeValue:k,packSizeUnit:v,conversionToBase:b,barcode:(d??"").trim()||null,defaultPrice:f,costPrice:null,maximumPrice:null,onHandQty:null,isDefault:!1,isActive:!0}))}return{units:r,errors:i}}function q(e,t){const r={}
for(const i of o(t)){const t=(e[`attr:${i.key}`]??"").trim()
if(t){if("number"===i.type){const e=z(t)
Number.isFinite(e)&&(r[i.key]=e)
continue}"boolean"!==i.type?r[i.key]=i.maxLength?t.slice(0,i.maxLength):t:r[i.key]=L(t,!1)}}return r}function R(e,r,i){const a=t=>z(e[t]??"")
return{attributes:q(e,r),name:(e.name??"").trim(),packagingMode:"pooled",variantAxes:[],category:(e.category??"").trim()||t(r),brand:(e.brand??"").trim()||void 0,unit:((e.unit??"").trim()||"piece").toLowerCase(),packSizeValue:a("packSizeValue")||1,packSizeUnit:((e.packSizeUnit??"").trim()||"piece").toLowerCase(),sellingUnits:i,barcode:(e.skuBarcode??"").trim(),hsn:(e.hsn??"").trim()||void 0,aliasesText:(e.aliasesText??"").trim(),mrp:a("mrp"),costPrice:a("costPrice"),sellingPrice:a("sellingPrice"),gstRate:a("gstRate"),minimumSellingPrice:0,retailPrice:0,retailFromQuantity:1,wholesalePrice:0,wholesaleFromQuantity:10,stockQuantity:a("stockQuantity"),lowStockAlert:a("lowStockAlert"),batchTrackingEnabled:!1,stockTrackingEnabled:n(r),drugSchedule:null,reorderLevel:a("reorderLevel"),description:(e.description??"").trim()||void 0,imageUrl:U(e.imageUrl),isLooseItem:L(e.isLooseItem??"",!1),isActive:L(e.isActive??"",!0)}}function T(e){return{rows:[],validCount:0,errorCount:0,headers:[],mapping:{},source:"generic",headerError:e}}function F(t,n,a=e()){let o
try{o=b(t).filter(e=>e.some(e=>""!==e.trim()))}catch(k){return T(k instanceof Error?k.message:"The CSV could not be parsed.")}if(0===o.length)return T("The file is empty.")
const s=o[0].map((e,t)=>0===t?e.replace(/^\uFEFF/,"").trim():e.trim()),c=v(a),l=n??S(s,a),u=x(s),p=d.filter(e=>e.required&&void 0===l[e.field]).map(e=>e.header)
if(p.length>0)return{...T(`Map the required columns before continuing: ${p.join(", ")}.`),headers:s,mapping:l,source:u}
const h=[]
for(let e=1;e<o.length;e+=1){const t=o[e],n={},s=[]
for(const e of c){const r=l[e.field],i=void 0===r?"":t[r]??""
n[e.field]=i,void 0!==r&&""!==i.trim()&&s.push(e.field)}const u=[]
for(const e of d.filter(e=>e.required))(n[e.field]??"").trim()||u.push(`${e.header} is required`)
for(const e of m){const t=n[e]??""
if(t.trim()&&Number.isNaN(z(t))){const t=d.find(t=>t.field===e)?.header??String(e)
u.push(`${t} is not a valid number`)}}const p=N(n.sellingUnits??"",((n.unit??"").trim()||"piece").toLowerCase())
u.push(...p.errors)
const g=R(n,a,p.units)
!g.isLooseItem&&f.has(g.unit.toLowerCase())&&(s.includes("packSizeValue")&&s.includes("packSizeUnit")||u.push("Packed items require Pack Size and Pack Unit (for example 500 g or 1 kg)"))
const k=r.safeParse(g)
let v
if(k.success)0===u.length&&(v=i(k.data))
else for(const e of k.error.issues)u.push(e.message)
h.push({rowNumber:e,name:n.name?.trim()||`(row ${e})`,values:n,providedFields:s,formData:k.success?k.data:void 0,input:v,errors:Array.from(new Set(u)),valid:0===u.length&&Boolean(v)})}const g=h.filter(e=>e.valid).length
return{rows:h,validCount:g,errorCount:h.length-g,headers:s,mapping:l,source:u}}function j(e){return String(e??"").trim().toLowerCase().replace(/[^a-z0-9]+/g," ").trim()}function B(e){return String(e??"").trim().replace(/\s+/g,"").toUpperCase()}function E(e){const t=e.sellingUnits?.find(e=>e.isDefault)??e.sellingUnits?.[0]
return[j(e.name),j(e.brand),j(t?.unitType??e.unit??e.displayUnit),j(t?.packSizeValue),j(t?.packSizeUnit)].join("|")}function I(e){return Array.from(new Set([B(e.barcode),B(e.sku),...(e.sellingUnits??[]).map(e=>B(e.barcode))].filter(Boolean)))}function V(e){return E(i(a(e)))}function M(e,t){const n=a(t),o=n,s=e.formData
for(const r of e.providedFields)"skuBarcode"===r?o.barcode=e.values.skuBarcode?.trim()??"":o[r]=s[r]
const c=r.parse(n)
return i(c)}function D(e,t,r){t&&e.set(t,[...e.get(t)??[],r])}function Q(e,t,r="skip-existing"){const i=new Map,n=new Map
for(const p of e.rows.filter(e=>e.valid&&e.input)){const e=B(p.input?.barcode??p.input?.sku),t=p.input?E(p.input):"",r=e?i:n,a=e||t
r.set(a,[...r.get(a)??[],p.rowNumber])}const a=new Map,o=new Map
for(const p of t.filter(e=>!e.deletedAt)){for(const e of I(p))D(a,e,p)
D(o,V(p),p)}const s=e.rows.map(e=>{if(!e.valid||!e.input)return{...e,action:"invalid"}
const t=B(e.input.barcode??e.input.sku),s=E(e.input),c=t?i.get(t):n.get(s)
if((c?.length??0)>1)return{...e,errors:[...e.errors,`Duplicate ${t?"barcode":"product and pack size"} in rows ${c?.join(", ")}`],valid:!1,action:"invalid"}
const l=t?a.get(t)??[]:[],u=o.get(s)??[]
if(l.length>1||!t&&u.length>1)return{...e,errors:[...e.errors,"Multiple existing products match this row. Resolve the duplicate products first."],valid:!1,action:"invalid"}
let d=l[0],p=d?"barcode":void 0
if(!d&&1===u.length){const r=u[0],i=I(r)
if(t&&i.length>0&&!i.includes(t))return{...e,errors:[...e.errors,"The same product and pack size already exists with a different barcode."],valid:!1,action:"invalid"}
d=r,p="name-pack"}if(!d)return{...e,action:"create",finalInput:e.input}
if("skip-existing"===r)return{...e,action:"skip",matchedProductId:d.id,matchReason:p}
try{return{...e,action:"update",matchedProductId:d.id,matchReason:p,finalInput:M(e,d)}}catch(m){return{...e,errors:[...e.errors,m instanceof Error?m.message:"Could not merge this row with the existing product."],valid:!1,action:"invalid"}}}),c=s.filter(e=>"create"===e.action).length,l=s.filter(e=>"update"===e.action).length,u=s.filter(e=>"skip"===e.action).length,d=s.filter(e=>"invalid"===e.action).length
return{rows:s,createCount:c,updateCount:l,skipCount:u,errorCount:d,importCount:c+l}}function O(e,t){if("undefined"==typeof document)return
const r=new Blob([e],{type:"text/csv;charset=utf-8;"}),i=URL.createObjectURL(r),n=document.createElement("a")
n.href=i,n.download=t,document.body.appendChild(n),n.click(),document.body.removeChild(n),URL.revokeObjectURL(i)}function G(t="artha-products-template.csv"){O(((t=e())=>{const r=v(t)
return`${r.map(e=>h(e.header)).join(",")}\n${r.map(e=>h(e.example)).join(",")}\n`})(),t)}function H(e,t="artha-product-import-errors.csv"){O((e=>[["Row","Action","Errors",...d.map(e=>e.header)],...e.rows.filter(e=>"invalid"===e.action).map(e=>[String(e.rowNumber),e.action,e.errors.join("; "),...d.map(t=>e.values[t.field]??"")])].map(e=>e.map(h).join(",")).join("\n")+"\n")(e),t)}function W(e){let t=2166136261
for(let r=0;r<e.length;r+=1)t^=e.charCodeAt(r),t=Math.imul(t,16777619)
return`products-${(t>>>0).toString(16).padStart(8,"0")}-${e.length}`}export{d as P,F as a,Q as b,H as c,G as d,h as e,W as f,A as g,P as i,v as p}
