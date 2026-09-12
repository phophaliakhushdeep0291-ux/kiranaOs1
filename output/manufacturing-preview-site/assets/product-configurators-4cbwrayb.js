const n=[]
function o(o){if(!o?.id||"function"!=typeof o.load||"function"!=typeof o.Component)throw new TypeError("A product configurator needs an id, loader and component")
n.some(n=>n.id===o.id)||n.push(o)}function t(o){return n.find(n=>n.appliesTo(o))??null}export{t as p,o as r}
