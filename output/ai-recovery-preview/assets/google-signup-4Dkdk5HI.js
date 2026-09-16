const t="kiranaos.google.signup.v1"
function e(e){try{sessionStorage.setItem(t,JSON.stringify(e))}catch{}}function s(){try{const e=sessionStorage.getItem(t)
if(!e)return null
sessionStorage.removeItem(t)
const s=JSON.parse(e)
return"string"==typeof s?.email&&s.email?s:null}catch{return null}}export{s as c,e as s}
