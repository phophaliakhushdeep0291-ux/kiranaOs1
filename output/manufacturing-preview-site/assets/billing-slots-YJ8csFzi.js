const n=[]
function o(o){if("function"!=typeof o?.Component)throw new TypeError("A billing slot needs a Component")
n.some(n=>n.id===o.id)||n.push(o)}function e(o){return 0===n.length?[]:n.filter(n=>n.appliesTo(o))}export{e as b,o as r}
