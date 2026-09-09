import{a as e,j as s}from"./vendor-data-BaHBZjtO.js"
import{k as i,K as t,a5 as a,cu as l,cv as r,B as d,cw as n}from"./index-Ci-XYli4.js"
import{S as o}from"./switch-DWKEqFS-.js"
import{S as c}from"./SettingsShell-CBugTE3P.js"
import{C as m,a as h,B as x,R as p}from"./ui-CU_2RWed.js"
import{u}from"./use-settings-prefs-8Hlsogn_.js"
import{as as j,l as b,aW as f,b as g}from"./vendor-ui-CIi-vqR6.js"
import"./vendor-react-CdF70ZyV.js"
import"./vendor-validation-C84QDzN5.js"
import"./index-DLkqWn8u.js"
import"./queries-Cm1QJwBl.js"
import"./query-options-DZ4mp_BJ.js"
const v=e=>["Billing","Dashboard","Cloud Backup",e("settings.hub.title")]
function y(){const{t:y}=i(),{toast:k}=t(),{patch:N}=u(),{isEnabled:w,setVisibility:B,patchVisibility:z}=a(),C=e.useMemo(()=>l.filter(e=>r(e.id)),[w]),S=e.useMemo(()=>C.filter(e=>!w(e.id)).length,[C,w])
return s.jsxs(c,{children:[s.jsxs(m,{children:[s.jsx(h,{icon:s.jsx(b,{size:15}),title:y("chrome.modulesTitle"),sub:y("chrome.modulesHelp"),action:s.jsxs("div",{className:"flex items-center gap-2",children:[s.jsx(x,{tone:S>0?"amber":"green",children:S>0?`${S} hidden`:"Everything visible"}),S>0&&s.jsxs(d,{variant:"outline",size:"sm",className:"h-8 gap-1.5 text-xs",onClick:()=>{const e={}
for(const s of C)s.defaultForBusinessTypes&&(e[s.id]=!0)
B(e),N({moduleVisibility:e}),k({title:y("settings.modules.allBackOn"),description:y("settings.modules.allBackOnHelp")})},children:[s.jsx(j,{size:13})," Show all"]})]})}),s.jsx("div",{className:"px-5 pb-5",children:s.jsxs("div",{className:"grid gap-3 lg:grid-cols-2",children:[s.jsx("div",{className:"rounded-[12px] border border-[#e4ebf6] bg-[#f8faff] p-4",children:s.jsxs("div",{className:"flex gap-3",children:[s.jsx(f,{className:"mt-0.5 shrink-0 text-[var(--brand)]",size:17}),s.jsxs("div",{children:[s.jsx("p",{className:"text-[13px] font-black text-[var(--brand-ink)]",children:y("settings.modules.hidesNeverDeletes")}),s.jsx("p",{className:"mt-1 text-[11px] leading-5 text-[#52627e]",children:"A module you switch off is only removed from the sidebar, the mobile menu and the dashboard shortcuts. Its data stays exactly where it is, keeps syncing, and comes straight back the moment you switch the module on again."})]})]})}),s.jsx("div",{className:"rounded-[12px] border border-emerald-100 bg-emerald-50/70 p-4",children:s.jsxs("div",{className:"flex gap-3",children:[s.jsx(g,{className:"mt-0.5 shrink-0 text-emerald-700",size:17}),s.jsxs("div",{children:[s.jsx("p",{className:"text-[13px] font-black text-emerald-950",children:y("settings.modules.alwaysAvailable")}),s.jsxs("p",{className:"mt-1 text-[11px] leading-5 text-emerald-800",children:[v(y).join(", ")," cannot be hidden — they are how you bill, check the day and keep your data backed up."]})]})]})})]})})]}),n.map(e=>{const i=C.filter(s=>s.group===e)
if(0===i.length)return null
const t=i.every(e=>w(e.id))
return s.jsxs(m,{children:[s.jsx(h,{title:e,sub:`${i.filter(e=>w(e.id)).length} of ${i.length} showing`,action:s.jsx(d,{variant:"outline",size:"sm",className:"h-8 text-xs",onClick:()=>((e,s)=>{const i={}
for(const t of C)t.group===e&&(i[t.id]=s)
N({moduleVisibility:z(i)})})(e,!t),children:t?"Hide all":"Show all"})}),s.jsx("div",{className:"px-5 pb-4",children:i.map((e,t)=>s.jsx(p,{label:e.label,desc:e.description,last:t===i.length-1,pill:s.jsx(o,{checked:w(e.id),onCheckedChange:s=>((e,s)=>{N({moduleVisibility:z({[e]:s})})})(e.id,s)})},e.id))})]},e)})]})}export{y as default}
