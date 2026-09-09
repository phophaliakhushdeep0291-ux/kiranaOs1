import{ak as i,aV as s}from"./index-DbQMpL2c.js"
const o=(o="all")=>i(`/gift-cards${s({status:o,limit:100})}`),a=s=>i("/gift-cards/lookup",{method:"POST",body:JSON.stringify({code:s})}),t=s=>i("/gift-cards",{method:"POST",ownerPin:s.ownerPin,body:JSON.stringify(s)}),d=(s,o)=>i(`/gift-cards/${s}/disable`,{method:"POST",ownerPin:o.ownerPin,body:JSON.stringify(o)})
export{a,d,t as i,o as l}
