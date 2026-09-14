import{a as e,j as t}from"./vendor-data-BaHBZjtO.js"
import{g as n,c as s,a as r}from"./voice-recognition-DMs16Fd1.js"
import{n as a}from"./voice-text-BkOdDDiw.js"
import{bj as o,c as i,cy as c,cz as l,cA as d}from"./vendor-ui-CIi-vqR6.js"
const u="kirana:voice-dictation-speak",p=new Set(["skip","next","pass","chhodo","chodo","aage","छोड़ो","छोड़","आगे","अगला"]),f=new Set(["stop","cancel","quit","band","bas","बस","रुको","बंद","रोको"]),x=new Set(["save","done","finish","ok","theek","sahi","सेव","बचाओ","ठीक"])
function h(){if("undefined"==typeof window)return!0
try{return"off"!==window.localStorage.getItem(u)}catch{return!0}}function m(t){const{open:o,language:i,promptFor:c,readyPrompt:l,readyNote:d,notUnderstoodPrompt:m,nextField:b,applyAnswer:g,onSave:w,filledNote:k}=t,[v,S]=e.useState(!1),[j,y]=e.useState(!1),[N,C]=e.useState(null),[z,R]=e.useState(""),[E,P]=e.useState(""),[T,$]=e.useState(h),I=e.useRef(null),U=e.useRef(!1),A=e.useRef(new Set),F=e.useRef(null),q=e.useRef(!1),B=e.useRef(T),M=e.useRef(()=>{}),V=e.useMemo(()=>n(),[]),D=r(i),G=Boolean(V)
e.useEffect(()=>{B.current=T},[T])
const H=e.useCallback(()=>{U.current=!1,F.current=null,I.current?.abort?.(),I.current=null,"undefined"!=typeof window&&window.speechSynthesis?.cancel(),y(!1),S(!1),C(null)},[])
e.useEffect(()=>H,[H]),e.useEffect(()=>{o||H()},[o,H])
const J=e.useCallback(()=>{if(!V||!U.current)return
q.current=!1
const e=s(V,{onStart:()=>y(!0),onTranscript:e=>{q.current=!0,M.current(e)},onError:(e,t,n)=>{P(e),"not-allowed"!==n&&"service-not-allowed"!==n||H()},onEnd:()=>{y(!1),I.current=null,U.current&&!q.current&&H()}},D)
I.current=e
try{e.start()}catch{P(m),H()}},[V,D,m,H]),K=e.useCallback(e=>{F.current=e,C(e)
const t=e?c(e):l
e||P(d??t),((e,t,n,s)=>{const r="undefined"==typeof window?void 0:window.speechSynthesis
if(!n||!r||"undefined"==typeof SpeechSynthesisUtterance)return void s()
let a=!1
const o=()=>{a||(a=!0,s())}
try{r.cancel()
const n=new SpeechSynthesisUtterance(e)
n.lang=t,n.onend=o,n.onerror=o,r.speak(n),window.setTimeout(o,6e3)}catch{o()}})(t,D,B.current,J)},[J,D,c,d,l]),L=e.useCallback(e=>{if(!U.current)return
R(e),P("")
const t=(e=>{const t=a(e)
return t?p.has(t)?"skip":f.has(t)?"stop":x.has(t)?"save":"none":"none"})(e)
if("stop"===t)return void H()
if("save"===t)return H(),void w()
const n=F.current
if("skip"===t)return n&&A.current.add(n),void K(b(A.current))
const s=g(n,e)
if(!s)return P(m),void K(n)
k&&P(k(s)),n&&A.current.add(n),K(b(A.current))},[g,K,k,b,m,w,H])
e.useEffect(()=>{M.current=L},[L])
const O=e.useCallback(()=>{G&&(A.current=new Set,R(""),S(!0),U.current=!0,K(b(A.current)))},[K,b,G]),Q=e.useCallback(()=>{$(e=>{const t=!e
try{window.localStorage.setItem(u,t?"on":"off")}catch{}return t||"undefined"==typeof window||window.speechSynthesis?.cancel(),t})},[])
return{supported:G,active:v,listening:j,pending:N,heard:z,note:E,speakPrompts:T,start:O,stop:H,toggleSpeak:Q}}function b({labels:e,supported:n,active:s,listening:r,heard:a,note:u,speakPrompts:p,prompt:f,onStart:x,onStop:h,onToggleSpeak:m,testId:b}){return s?t.jsxs("div",{className:"shrink-0 border-b border-[var(--brand-border)] bg-[var(--brand-softer)] px-5 py-3","data-testid":`${b}-panel`,"aria-live":"polite",children:[t.jsxs("div",{className:"flex items-center gap-2.5",children:[t.jsx("span",{className:"grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-white",children:r?t.jsx(o,{size:15,className:"animate-pulse"}):t.jsx(i,{size:15,className:"animate-spin"})}),t.jsx("p",{className:"min-w-0 flex-1 text-[13px] font-black leading-5 text-[var(--brand-ink)]",children:f}),t.jsx("button",{type:"button",onClick:m,"aria-label":e.speakToggle,"aria-pressed":p,className:"grid h-11 w-11 shrink-0 place-items-center rounded-lg text-[#536383] transition-colors hover:bg-white/70",children:p?t.jsx(c,{size:15}):t.jsx(l,{size:15})}),t.jsxs("button",{type:"button",onClick:h,"data-testid":`${b}-stop`,className:"inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[12px] font-black text-[#536383] transition-colors hover:bg-[#f1f4f8]",children:[t.jsx(d,{size:12}),e.stop]})]}),t.jsxs("p",{className:"mt-1.5 text-[11px] leading-4 text-[#52627e]",children:[r?e.listening:e.starting,a?` · ${e.heard(a)}`:""]}),u?t.jsx("p",{className:"mt-0.5 text-[11px] leading-4 text-[#6d7c98]",children:u}):null,t.jsx("p",{className:"mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b98ad]",children:e.controls})]}):t.jsxs("div",{className:"flex shrink-0 items-center gap-2 border-b border-[#eef1f6] px-5 py-2.5",children:[t.jsxs("button",{type:"button",onClick:x,"data-testid":`${b}-start`,className:"inline-flex h-11 items-center gap-1.5 rounded-lg bg-[var(--brand-softer)] px-3 text-[12px] font-black text-[var(--brand)] transition-colors hover:bg-[var(--brand-soft)] disabled:opacity-50",disabled:!n,children:[t.jsx(o,{size:14}),e.start]}),t.jsx("p",{className:"min-w-0 flex-1 truncate text-[11px] text-[#6d7c98]",children:n?e.hint:e.unsupported})]})}export{b as V,m as u}
