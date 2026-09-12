import{u as e,s as i,r as a,C as t,l as n,v as o,a as s,M as r,P as c,n as l,b as d}from"./voice-text-BkOdDDiw.js"
const m=new Set(["mrp","gstRate","costPrice","sellingPrice","minimumSellingPrice","retailPrice","wholesalePrice","stockQuantity","lowStockAlert","packSize"]),h=new Set(["barcode","hsn"]),u=new Set(["name","brand","category","aliases"]),g=new Set(["mrp","costPrice","sellingPrice","minimumSellingPrice","retailPrice","wholesalePrice"]),p={kg:"kg",kilo:"kg",kilos:"kg",kilogram:"kg",kilograms:"kg","किलो":"kg","किलोग्राम":"kg",g:"gram",gm:"gram",gms:"gram",gram:"gram",grams:"gram","ग्राम":"gram",ml:"ml","मिली":"ml","मिलीलीटर":"ml",litre:"litre",liter:"litre",litres:"litre",liters:"litre",ltr:"litre",l:"litre","लीटर":"litre",piece:"piece",pieces:"piece",pcs:"piece",pc:"piece","नग":"piece","पीस":"piece",packet:"packet",packets:"packet",pkt:"packet","पैकेट":"packet",box:"box",boxes:"box","डिब्बा":"box",tablet:"tablet",tablets:"tablet","गोली":"tablet",dozen:"dozen","दर्जन":"dozen"},f=new Set(["add","create","new","make","save","register","edit","update","change","customise","customize","product","products","item","items","naya","nayi","naye","jodo","daalo","dalo","banao","aitam","samaan","saman","नया","नई","नयी","नए","जोड़ो","जोड़","डालो","बनाओ","प्रोडक्ट","आइटम","सामान","माल","जोड़ें"]),k=new Set(["from","se","से","upar","ऊपर"])
function v(e){return l(e)}function b(e){if(e)return p[e]}const P=d({name:["product name","item name","name","naam","नाम","प्रोडक्ट का नाम"],category:["category","categorie","shreni","श्रेणी","कैटेगरी","केटेगरी"],brand:["brand","company","kampani","ब्रांड","ब्रँड","कंपनी","कम्पनी"],unit:["unit","sold as","इकाई","यूनिट"],packSize:["pack size","pack of","packet of","pack","पैक साइज","पैक","पैकेट"],barcode:["barcode","bar code","ean","बारकोड","बार कोड"],hsn:["hsn code","hsn","एचएसएन"],aliases:["aliases","alias","also called","also known as","dusra naam","doosra naam","उपनाम","दूसरा नाम"],mrp:["mrp","m r p","printed price","packet price","एमआरपी","छपा दाम","प्रिंट रेट"],gstRate:["gst rate","gst","tax","जीएसटी","टैक्स","कर"],costPrice:["cost price","purchase price","buying price","average cost","avg cost","cost","kharid","khareed","kharidi","खरीद दाम","खरीद","लागत","कॉस्ट"],sellingPrice:["selling price","sale price","sell price","selling","sell","price","rate","daam","bhav","keemat","बिक्री दाम","बिक्री","दाम","भाव","कीमत","रेट"],minimumSellingPrice:["minimum selling price","minimum selling","minimum price","min price","minimum","min","kam se kam","न्यूनतम","कम से कम"],retailPrice:["retail price","retail","khudra","खुदरा"],wholesalePrice:["wholesale price","wholesale","thok","थोक"],stockQuantity:["opening stock","stock","quantity","qty","maal","स्टॉक","मात्रा","माल"],lowStockAlert:["low stock alert","low stock","reorder level","reorder","alert","कम स्टॉक","अलर्ट"]})
function y(l){const d=v(l).split(" ").filter(Boolean)
if(!d.length)return{}
const u=new Set,g={},p=[],y=[],x=(e,i)=>{for(let a=e;a<=i;a+=1)u.add(a)},Q=new Set
for(const{field:e,tokens:t}of P)for(let r=0;r<d.length;r+=1){if(!n(d,r,t,u))continue
const c="aliases"===e?p.length>0:Q.has(e),l=r+t.length-1,f=o(d,l+1,u)
if(f>=d.length||u.has(f)||s(P,d,f,u)){if(m.has(e)&&!Q.has(e)&&r>0&&!u.has(r-1)){const a=i(d[r-1])
if(void 0!==a){j(g,e,a,void 0),Q.add(e),x(r-1,l)
continue}}x(r,l)
continue}if(h.has(e)){if(!/^\d{3,}$/.test(d[f]))continue
c||(z(g,e,d[f]),Q.add(e)),x(r,f)
continue}if(m.has(e)){const t=a(d,f)
if(void 0===t)continue
const{value:n,end:o}=t
x(r,o)
const s=b(d[o+1])
if(s&&x(o+1,o+1),c||(j(g,e,n,s),Q.add(e)),w(d,f,o,u,x),"retailPrice"===e||"wholesalePrice"===e){const a=s?o+2:o+1
if(k.has(d[a]??"")){const t=i(d[a+1])
void 0!==t&&("retailPrice"===e?g.retailFromQuantity=t:g.wholesaleFromQuantity=t,x(a,a+1),b(d[a+2])&&x(a+2,a+2))}}continue}const v=S(d,f,u,"aliases"===e?12:4)
v.length&&(x(r,f+v.length-1),"aliases"!==e?c||(Q.add(e),"name"!==e&&y.push({field:e,labelAt:r,from:f,to:f+v.length-1}),"unit"===e?g.unit=b(v[0])??v[0]:"name"===e?g.name=v.join(" "):"brand"===e?g.brand=v.join(" "):"category"===e&&(g.category=v.join(" "))):p.push(...v))}if(p.length&&(g.aliases=e(p)),void 0===g.packSizeValue)for(let e=0;e<d.length-1;e+=1){if(u.has(e)||u.has(e+1))continue
const a=i(d[e]),t=b(d[e+1])
if(void 0!==a&&t&&!(a<=0)){g.packSizeValue=a,g.packSizeUnit=t,x(e,e+1)
break}}if(void 0===g.sellingPrice&&!Q.has("sellingPrice"))for(let e=0;e<d.length;e+=1){if(u.has(e))continue
const a=i(d[e])
if(void 0===a||a<=0)continue
const t=d[e+1],n=e>0?d[e-1]:void 0,o=void 0!==t&&r.has(t)&&!u.has(e+1)?e+1:void 0!==n&&r.has(n)&&!u.has(e-1)?e-1:void 0
if(void 0!==o&&!b(d[e+1])){g.sellingPrice=a,x(Math.min(e,o),Math.max(e,o))
break}}if(void 0===g.name){const e=d.filter((e,i)=>!u.has(i)).filter(e=>!(f.has(e)||t.has(e)||r.has(e)||c.has(e)||k.has(e)||void 0!==i(e))).join(" ").trim()
e.length>=2&&(g.name=e)}if(void 0===g.name&&y.length>0&&(e=>void 0!==e.mrp||void 0!==e.costPrice||void 0!==e.sellingPrice||void 0!==e.minimumSellingPrice||void 0!==e.retailPrice||void 0!==e.wholesalePrice||void 0!==e.stockQuantity||void 0!==e.lowStockAlert||void 0!==e.gstRate||void 0!==e.barcode||void 0!==e.hsn||void 0!==e.packSizeValue)(g)){const e=d.findIndex(e=>!f.has(e)&&!t.has(e)),i=y.find(i=>i.labelAt===e),a=i?d.slice(i.from,i.to+1).join(" ").trim():""
i&&a.length>=2&&(g.name=a,((e,i)=>{"category"===i?e.category=void 0:"brand"===i?e.brand=void 0:"unit"===i&&(e.unit=void 0)})(g,i.field))}return g}function S(e,a,n,o){const l=[]
for(let d=a;d<e.length&&l.length<o&&!n.has(d);d+=1){const a=e[d]
if(void 0!==i(a))break
if(r.has(a)||c.has(a))break
if(f.has(a)||t.has(a))break
if(s(P,e,d,n))break
l.push(a)}return l}function w(e,i,a,t,n){const o=e[i-1],s=e[a+1]
o&&(r.has(o)||c.has(o))&&!t.has(i-1)&&n(i-1,i-1),s&&(r.has(s)||c.has(s))&&!t.has(a+1)&&n(a+1,a+1)}function z(e,i,a){"barcode"===i?e.barcode=a:e.hsn=a}function j(e,i,a,t){return"packSize"===i?(e.packSizeValue=a,void(t&&(e.packSizeUnit=t))):"stockQuantity"===i?(e.stockQuantity=a,void(t&&void 0===e.unit&&(e.unit=t))):(t&&void 0===e.unit&&"gstRate"!==i&&(e.unit=t),void(e[i]=a))}function x(n,o){const r=y(o),c=Object.keys(r).filter(e=>"name"!==e)
if(u.has(n)&&r.name&&c.some(e=>g.has(e))){if("name"===n)return r
const{name:i,...a}=r,t={...a}
return"aliases"===n?t.aliases=e(i.split(" ")):"brand"===n?t.brand=i:t.category=i,t}if(c.length>0&&(e=>{const i=v(e).split(" ").filter(Boolean),a=new Set
return i.some((e,t)=>s(P,i,t,a))})(o))return r
const l=v(o).split(" ").filter(Boolean)
if(!l.length)return{}
if(h.has(n)){const e=l.find(e=>/^\d{3,}$/.test(e))
if(!e)return{}
const i={}
return z(i,n,e),i}if(m.has(n)){const e=l.findIndex(e=>void 0!==i(e))
if(-1===e)return{}
const t=a(l,e)
if(void 0===t)return{}
const o={}
return j(o,n,t.value,b(l[t.end+1])),o}if("unit"===n){const e=l.map(e=>b(e)).find(Boolean)
return e?{unit:e}:{unit:l[0]}}const d=l.filter(e=>!f.has(e)&&!t.has(e))
return d.length?"aliases"===n?{aliases:e(d)}:"brand"===n?{brand:d.join(" ")}:"category"===n?{category:d.join(" ")}:{name:d.join(" ")}:{}}export{x as a,y as p}
