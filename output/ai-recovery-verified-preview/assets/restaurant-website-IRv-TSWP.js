function n(n){if("string"!=typeof n||n.length>500)return null
try{const t=new URL(n.trim())
return"https:"!==t.protocol||t.username||t.password||t.search||t.hash?null:/^\/r\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(t.pathname)?"localhost"===t.hostname||t.hostname.endsWith(".localhost")||t.hostname.endsWith(".local")||t.hostname.includes(":")||/^\d+\.\d+\.\d+\.\d+$/.test(t.hostname)?null:t.href.replace(/\/$/,""):null}catch{return null}}function t(t,e){const r=n(t)
return r?`${r}${e?`/t/${encodeURIComponent(e)}`:""}`:null}function e(t){const e=t.restaurant
return n(e?.brand?.websiteUrl)}function r(n,e,r){if("dine_in"!==n.storefront?.mode)return null
const o=t(n.storefront.branding?.websiteUrl,r)
return o&&new URL(o).origin!==new URL(e).origin?o:null}export{n as a,r as g,t as r,e as w}
