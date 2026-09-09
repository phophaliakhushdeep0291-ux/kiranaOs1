import{ak as n}from"./index-DbQMpL2c.js"
async function a(a,e){if(!(a instanceof Blob)||0===a.size)throw new Error("Recorded audio is empty")
const i=new FormData,o="voice-command."+((t=a.type).includes("mp4")?"m4a":t.includes("ogg")?"ogg":t.includes("wav")?"wav":t.includes("mpeg")||t.includes("mp3")?"mp3":"webm")
var t
return i.append("audio",a,o),n("/ai/transcribe",{method:"POST",body:i,signal:e?.signal})}async function e(a,e){return n("/ai/parse-command",{method:"POST",body:JSON.stringify({transcript:a.command,...a.context?{context:a.context}:{}}),signal:e?.signal})}async function i(a){return n("/ai/product-aliases",{method:"POST",body:JSON.stringify(a)})}export{a,i as b,e as r}
