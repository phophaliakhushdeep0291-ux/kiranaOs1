import{a as e}from"./vendor-data-BaHBZjtO.js"
function r(r){const u=e.useRef({value:r,previous:r})
return e.useMemo(()=>(u.current.value!==r&&(u.current.previous=u.current.value,u.current.value=r),u.current.previous),[r])}export{r as u}
