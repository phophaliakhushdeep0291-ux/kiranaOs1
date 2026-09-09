import{a as e,j as i}from"./vendor-data-BaHBZjtO.js"
import{L as r}from"./vendor-react-CdF70ZyV.js"
import{B as s}from"./index-DbQMpL2c.js"
import{d as t}from"./queries-BRKlWdT9.js"
import{q as a,M as n}from"./vendor-ui-CIi-vqR6.js"
import"./vendor-validation-C84QDzN5.js"
import"./query-options-DZ4mp_BJ.js"
function o(){const[o,d]=e.useState(!1),l=e.useMemo(()=>"undefined"==typeof window?"":new URLSearchParams(window.location.search).get("token")||"",[]),c=t()
e.useEffect(()=>{l&&!o&&(d(!0),c.mutate({data:{token:l}}))},[o,l,c])
const m=c.isSuccess,f=!l||c.isError
return i.jsx("div",{className:"app-shell flex min-h-screen items-center justify-center bg-background px-4 py-8",children:i.jsxs("div",{className:"w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-xl",children:[i.jsx("div",{className:"mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl "+(m?"bg-emerald-100 text-emerald-700":f?"bg-destructive/10 text-destructive":"bg-primary/10 text-primary"),children:f?i.jsx(a,{size:26}):i.jsx(n,{size:26})}),i.jsx("h1",{className:"text-2xl font-black text-foreground",children:m?"Email verified":f?"Verification failed":"Verifying email..."}),i.jsx("p",{className:"mt-2 text-sm text-muted-foreground",children:m?"Your Artha email is verified. You can use it for safer account recovery.":f?"This verification link is invalid or expired. Please request a new link from sign in.":"Please wait while we confirm your email."}),i.jsx(s,{asChild:!0,className:"mt-6 h-11 w-full",children:i.jsx(r,{href:"/login",children:"Back to sign in"})})]})})}export{o as default}
