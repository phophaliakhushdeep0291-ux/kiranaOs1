const n=[]
function t(t){if(!t?.id||"function"!=typeof t.run)throw new TypeError("A settle check needs an id and a run function")
n.some(n=>n.id===t.id)||n.push(t)}async function r(t){for(const r of n)try{const n=await r.run(t)
if(n)return n}catch{}return null}export{r as f,t as r}
