import{T as e}from"./index-Ci-XYli4.js"
const t=["piece","dozen","set","pair","bundle","roll","sheet","kg","gram","litre","ml","meter","yard","packet","pack","pouch","box","carton","bottle","jar","can","sachet","strip","tablet","bottle","tube","plate","glass","custom"],r=["all","general","grocery","dairy","beverages","snacks","household","personal_care","stationery","other"],n=["kg","gram","g","litre","liter","ml"]
function a(e){return n.includes(e.trim().toLowerCase())}const i={kg:"gram",gram:"gram",g:"gram",litre:"ml",liter:"ml",ltr:"ml",l:"ml",ml:"ml",piece:"piece",packet:"piece",pack:"piece",pouch:"piece",box:"piece",carton:"piece",bottle:"piece",jar:"piece",can:"piece",sachet:"piece",dozen:"piece",bundle:"bundle",roll:"roll",sheet:"sheet",set:"set",pair:"pair",meter:"meter",yard:"yard",strip:"strip",tablet:"tablet",tube:"tube",plate:"plate",glass:"glass",custom:"custom"},s={kg:1e3,gram:1,g:1,litre:1e3,liter:1e3,ltr:1e3,l:1e3,ml:1,piece:1,packet:1,pack:1,pouch:1,box:1,carton:1,bottle:1,jar:1,can:1,sachet:1,dozen:12,bundle:1,roll:1,sheet:1,set:1,pair:1,meter:1,yard:1,strip:1,tablet:1,tube:1,plate:1,glass:1,custom:1}
function c(e){return i[e]??e??"piece"}function o(t,r){return e(Number(t||0)*(s[r]??1))}function u(e){return Object.hasOwn(s,String(e??"").trim().toLowerCase())}function l(e,t,r){const n=String(e||"unit").trim()
return Number(t)>0&&r?1===Number(t)&&r===n?n:`${n} ${Number(t)} ${r}`:n}function m(e,t,r){return[e,Number(t)>0?Number(t):1,r||"count"].join("-").toLowerCase().replace(/[^a-z0-9_-]+/g,"-").replace(/^-+|-+$/g,"")}function p(t,r){return e(Number(t||0)*(s[r]??1))}function b(t,r){return e(Number(t||0)/(s[r||"piece"]??1))}function g(t,r,n){const a=Number(t?.maximumPrice??0)
if(a>0)return e(a)
if("portion"===String(t?.unitType??"").trim().toLowerCase())return 0
const i=Number(r?.mrp??0)
if(!(i>0))return 0
if(!t||t.isDefault)return e(i)
const s=Number(n?.conversionToBase??0),c=Number(t.conversionToBase??0)
return e(s>0&&c>0?s===c?i:i/s*c:i)}function d(t){return e(Number(t?.averageCostPrice??t?.costPrice??t?.costPerRateUnit??0))}function f(e){return e.unit??e.displayUnit??e.rateUnit??"piece"}function N(e){const t=Number(e.lowStockThreshold??0)
return t>0&&Number(e.stockBaseQty??0)<=t}function h(e){return null!=e.deletedAt||"deleted_at"in e&&null!=e.deleted_at}function k(e){return"inactive"===e.status||!1===e.isActive}function y(e,t){const r=Number(e||0)
return!(r<=0)&&t.filter(e=>Number(e)>0).some(e=>Number(e)<r)}export{r as C,t as U,m as a,c as b,o as c,g as d,d as e,b as f,a as g,k as h,h as i,N as j,u as k,y as n,f as p,l as s,p as t}
