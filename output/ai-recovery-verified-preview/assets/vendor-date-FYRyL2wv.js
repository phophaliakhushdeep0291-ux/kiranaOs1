function t(t){const e=Object.prototype.toString.call(t)
return t instanceof Date||"object"==typeof t&&"[object Date]"===e?new t.constructor(+t):"number"==typeof t||"[object Number]"===e||"string"==typeof t||"[object String]"===e?new Date(t):new Date(NaN)}function e(t,e){return t instanceof Date?new t.constructor(e):new Date(e)}const n=6048e5,a=43200
let r={}
function o(){return r}function i(e,n){const a=o(),r=n?.weekStartsOn??n?.locale?.options?.weekStartsOn??a.weekStartsOn??a.locale?.options?.weekStartsOn??0,i=t(e),s=i.getDay(),u=(s<r?7:0)+s-r
return i.setDate(i.getDate()-u),i.setHours(0,0,0,0),i}function s(t){return i(t,{weekStartsOn:1})}function u(n){const a=t(n),r=a.getFullYear(),o=e(n,0)
o.setFullYear(r+1,0,4),o.setHours(0,0,0,0)
const i=s(o),u=e(n,0)
u.setFullYear(r,0,4),u.setHours(0,0,0,0)
const c=s(u)
return a.getTime()>=i.getTime()?r+1:a.getTime()>=c.getTime()?r:r-1}function c(e){const n=t(e)
return n.setHours(0,0,0,0),n}function d(e){const n=t(e),a=new Date(Date.UTC(n.getFullYear(),n.getMonth(),n.getDate(),n.getHours(),n.getMinutes(),n.getSeconds(),n.getMilliseconds()))
return a.setUTCFullYear(n.getFullYear()),+e-+a}function h(e,n){const a=t(e),r=t(n),o=a.getTime()-r.getTime()
return o<0?-1:o>0?1:o}const l={lessThanXSeconds:{one:"less than a second",other:"less than {{count}} seconds"},xSeconds:{one:"1 second",other:"{{count}} seconds"},halfAMinute:"half a minute",lessThanXMinutes:{one:"less than a minute",other:"less than {{count}} minutes"},xMinutes:{one:"1 minute",other:"{{count}} minutes"},aboutXHours:{one:"about 1 hour",other:"about {{count}} hours"},xHours:{one:"1 hour",other:"{{count}} hours"},xDays:{one:"1 day",other:"{{count}} days"},aboutXWeeks:{one:"about 1 week",other:"about {{count}} weeks"},xWeeks:{one:"1 week",other:"{{count}} weeks"},aboutXMonths:{one:"about 1 month",other:"about {{count}} months"},xMonths:{one:"1 month",other:"{{count}} months"},aboutXYears:{one:"about 1 year",other:"about {{count}} years"},xYears:{one:"1 year",other:"{{count}} years"},overXYears:{one:"over 1 year",other:"over {{count}} years"},almostXYears:{one:"almost 1 year",other:"almost {{count}} years"}}
function m(t){return(e={})=>{const n=e.width?String(e.width):t.defaultWidth
return t.formats[n]||t.formats[t.defaultWidth]}}const f={date:m({formats:{full:"EEEE, MMMM do, y",long:"MMMM do, y",medium:"MMM d, y",short:"MM/dd/yyyy"},defaultWidth:"full"}),time:m({formats:{full:"h:mm:ss a zzzz",long:"h:mm:ss a z",medium:"h:mm:ss a",short:"h:mm a"},defaultWidth:"full"}),dateTime:m({formats:{full:"{{date}} 'at' {{time}}",long:"{{date}} 'at' {{time}}",medium:"{{date}}, {{time}}",short:"{{date}}, {{time}}"},defaultWidth:"full"})},g={lastWeek:"'last' eeee 'at' p",yesterday:"'yesterday at' p",today:"'today at' p",tomorrow:"'tomorrow at' p",nextWeek:"eeee 'at' p",other:"P"}
function w(t){return(e,n)=>{let a
if("formatting"===(n?.context?String(n.context):"standalone")&&t.formattingValues){const e=t.defaultFormattingWidth||t.defaultWidth,r=n?.width?String(n.width):e
a=t.formattingValues[r]||t.formattingValues[e]}else{const e=t.defaultWidth,r=n?.width?String(n.width):t.defaultWidth
a=t.values[r]||t.values[e]}return a[t.argumentCallback?t.argumentCallback(e):e]}}function b(t){return(e,n={})=>{const a=n.width,r=a&&t.matchPatterns[a]||t.matchPatterns[t.defaultMatchWidth],o=e.match(r)
if(!o)return null
const i=o[0],s=a&&t.parsePatterns[a]||t.parsePatterns[t.defaultParseWidth],u=Array.isArray(s)?((t,e)=>{for(let n=0;n<t.length;n++)if(e(t[n]))return n})(s,t=>t.test(i)):((t,e)=>{for(const n in t)if(Object.prototype.hasOwnProperty.call(t,n)&&e(t[n]))return n})(s,t=>t.test(i))
let c
return c=t.valueCallback?t.valueCallback(u):u,c=n.valueCallback?n.valueCallback(c):c,{value:c,rest:e.slice(i.length)}}}function y(t){return(e,n={})=>{const a=e.match(t.matchPattern)
if(!a)return null
const r=a[0],o=e.match(t.parsePattern)
if(!o)return null
let i=t.valueCallback?t.valueCallback(o[0]):o[0]
return i=n.valueCallback?n.valueCallback(i):i,{value:i,rest:e.slice(r.length)}}}const M={code:"en-US",formatDistance:(t,e,n)=>{let a
const r=l[t]
return a="string"==typeof r?r:1===e?r.one:r.other.replace("{{count}}",e.toString()),n?.addSuffix?n.comparison&&n.comparison>0?"in "+a:a+" ago":a},formatLong:f,formatRelative:t=>g[t],localize:{ordinalNumber:t=>{const e=Number(t),n=e%100
if(n>20||n<10)switch(n%10){case 1:return e+"st"
case 2:return e+"nd"
case 3:return e+"rd"}return e+"th"},era:w({values:{narrow:["B","A"],abbreviated:["BC","AD"],wide:["Before Christ","Anno Domini"]},defaultWidth:"wide"}),quarter:w({values:{narrow:["1","2","3","4"],abbreviated:["Q1","Q2","Q3","Q4"],wide:["1st quarter","2nd quarter","3rd quarter","4th quarter"]},defaultWidth:"wide",argumentCallback:t=>t-1}),month:w({values:{narrow:["J","F","M","A","M","J","J","A","S","O","N","D"],abbreviated:["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"],wide:["January","February","March","April","May","June","July","August","September","October","November","December"]},defaultWidth:"wide"}),day:w({values:{narrow:["S","M","T","W","T","F","S"],short:["Su","Mo","Tu","We","Th","Fr","Sa"],abbreviated:["Sun","Mon","Tue","Wed","Thu","Fri","Sat"],wide:["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"]},defaultWidth:"wide"}),dayPeriod:w({values:{narrow:{am:"a",pm:"p",midnight:"mi",noon:"n",morning:"morning",afternoon:"afternoon",evening:"evening",night:"night"},abbreviated:{am:"AM",pm:"PM",midnight:"midnight",noon:"noon",morning:"morning",afternoon:"afternoon",evening:"evening",night:"night"},wide:{am:"a.m.",pm:"p.m.",midnight:"midnight",noon:"noon",morning:"morning",afternoon:"afternoon",evening:"evening",night:"night"}},defaultWidth:"wide",formattingValues:{narrow:{am:"a",pm:"p",midnight:"mi",noon:"n",morning:"in the morning",afternoon:"in the afternoon",evening:"in the evening",night:"at night"},abbreviated:{am:"AM",pm:"PM",midnight:"midnight",noon:"noon",morning:"in the morning",afternoon:"in the afternoon",evening:"in the evening",night:"at night"},wide:{am:"a.m.",pm:"p.m.",midnight:"midnight",noon:"noon",morning:"in the morning",afternoon:"in the afternoon",evening:"in the evening",night:"at night"}},defaultFormattingWidth:"wide"})},match:{ordinalNumber:y({matchPattern:/^(\d+)(th|st|nd|rd)?/i,parsePattern:/\d+/i,valueCallback:t=>parseInt(t,10)}),era:b({matchPatterns:{narrow:/^(b|a)/i,abbreviated:/^(b\.?\s?c\.?|b\.?\s?c\.?\s?e\.?|a\.?\s?d\.?|c\.?\s?e\.?)/i,wide:/^(before christ|before common era|anno domini|common era)/i},defaultMatchWidth:"wide",parsePatterns:{any:[/^b/i,/^(a|c)/i]},defaultParseWidth:"any"}),quarter:b({matchPatterns:{narrow:/^[1234]/i,abbreviated:/^q[1234]/i,wide:/^[1234](th|st|nd|rd)? quarter/i},defaultMatchWidth:"wide",parsePatterns:{any:[/1/i,/2/i,/3/i,/4/i]},defaultParseWidth:"any",valueCallback:t=>t+1}),month:b({matchPatterns:{narrow:/^[jfmasond]/i,abbreviated:/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i,wide:/^(january|february|march|april|may|june|july|august|september|october|november|december)/i},defaultMatchWidth:"wide",parsePatterns:{narrow:[/^j/i,/^f/i,/^m/i,/^a/i,/^m/i,/^j/i,/^j/i,/^a/i,/^s/i,/^o/i,/^n/i,/^d/i],any:[/^ja/i,/^f/i,/^mar/i,/^ap/i,/^may/i,/^jun/i,/^jul/i,/^au/i,/^s/i,/^o/i,/^n/i,/^d/i]},defaultParseWidth:"any"}),day:b({matchPatterns:{narrow:/^[smtwf]/i,short:/^(su|mo|tu|we|th|fr|sa)/i,abbreviated:/^(sun|mon|tue|wed|thu|fri|sat)/i,wide:/^(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i},defaultMatchWidth:"wide",parsePatterns:{narrow:[/^s/i,/^m/i,/^t/i,/^w/i,/^t/i,/^f/i,/^s/i],any:[/^su/i,/^m/i,/^tu/i,/^w/i,/^th/i,/^f/i,/^sa/i]},defaultParseWidth:"any"}),dayPeriod:b({matchPatterns:{narrow:/^(a|p|mi|n|(in the|at) (morning|afternoon|evening|night))/i,any:/^([ap]\.?\s?m\.?|midnight|noon|(in the|at) (morning|afternoon|evening|night))/i},defaultMatchWidth:"any",parsePatterns:{any:{am:/^a/i,pm:/^p/i,midnight:/^mi/i,noon:/^no/i,morning:/morning/i,afternoon:/afternoon/i,evening:/evening/i,night:/night/i}},defaultParseWidth:"any"})},options:{weekStartsOn:0,firstWeekContainsDate:1}}
function p(n,a){const r=t(n),s=r.getFullYear(),u=o(),c=a?.firstWeekContainsDate??a?.locale?.options?.firstWeekContainsDate??u.firstWeekContainsDate??u.locale?.options?.firstWeekContainsDate??1,d=e(n,0)
d.setFullYear(s+1,0,c),d.setHours(0,0,0,0)
const h=i(d,a),l=e(n,0)
l.setFullYear(s,0,c),l.setHours(0,0,0,0)
const m=i(l,a)
return r.getTime()>=h.getTime()?s+1:r.getTime()>=m.getTime()?s:s-1}function v(t,e){return(t<0?"-":"")+Math.abs(t).toString().padStart(e,"0")}const D={y(t,e){const n=t.getFullYear(),a=n>0?n:1-n
return v("yy"===e?a%100:a,e.length)},M(t,e){const n=t.getMonth()
return"M"===e?String(n+1):v(n+1,2)},d:(t,e)=>v(t.getDate(),e.length),a(t,e){const n=t.getHours()/12>=1?"pm":"am"
switch(e){case"a":case"aa":return n.toUpperCase()
case"aaa":return n
case"aaaaa":return n[0]
default:return"am"===n?"a.m.":"p.m."}},h:(t,e)=>v(t.getHours()%12||12,e.length),H:(t,e)=>v(t.getHours(),e.length),m:(t,e)=>v(t.getMinutes(),e.length),s:(t,e)=>v(t.getSeconds(),e.length),S(t,e){const n=e.length,a=t.getMilliseconds()
return v(Math.trunc(a*Math.pow(10,n-3)),e.length)}},x={G:(t,e,n)=>{const a=t.getFullYear()>0?1:0
switch(e){case"G":case"GG":case"GGG":return n.era(a,{width:"abbreviated"})
case"GGGGG":return n.era(a,{width:"narrow"})
default:return n.era(a,{width:"wide"})}},y:(t,e,n)=>{if("yo"===e){const e=t.getFullYear(),a=e>0?e:1-e
return n.ordinalNumber(a,{unit:"year"})}return D.y(t,e)},Y:(t,e,n,a)=>{const r=p(t,a),o=r>0?r:1-r
return"YY"===e?v(o%100,2):"Yo"===e?n.ordinalNumber(o,{unit:"year"}):v(o,e.length)},R:(t,e)=>v(u(t),e.length),u:(t,e)=>v(t.getFullYear(),e.length),Q:(t,e,n)=>{const a=Math.ceil((t.getMonth()+1)/3)
switch(e){case"Q":return String(a)
case"QQ":return v(a,2)
case"Qo":return n.ordinalNumber(a,{unit:"quarter"})
case"QQQ":return n.quarter(a,{width:"abbreviated",context:"formatting"})
case"QQQQQ":return n.quarter(a,{width:"narrow",context:"formatting"})
default:return n.quarter(a,{width:"wide",context:"formatting"})}},q:(t,e,n)=>{const a=Math.ceil((t.getMonth()+1)/3)
switch(e){case"q":return String(a)
case"qq":return v(a,2)
case"qo":return n.ordinalNumber(a,{unit:"quarter"})
case"qqq":return n.quarter(a,{width:"abbreviated",context:"standalone"})
case"qqqqq":return n.quarter(a,{width:"narrow",context:"standalone"})
default:return n.quarter(a,{width:"wide",context:"standalone"})}},M:(t,e,n)=>{const a=t.getMonth()
switch(e){case"M":case"MM":return D.M(t,e)
case"Mo":return n.ordinalNumber(a+1,{unit:"month"})
case"MMM":return n.month(a,{width:"abbreviated",context:"formatting"})
case"MMMMM":return n.month(a,{width:"narrow",context:"formatting"})
default:return n.month(a,{width:"wide",context:"formatting"})}},L:(t,e,n)=>{const a=t.getMonth()
switch(e){case"L":return String(a+1)
case"LL":return v(a+1,2)
case"Lo":return n.ordinalNumber(a+1,{unit:"month"})
case"LLL":return n.month(a,{width:"abbreviated",context:"standalone"})
case"LLLLL":return n.month(a,{width:"narrow",context:"standalone"})
default:return n.month(a,{width:"wide",context:"standalone"})}},w:(a,r,s,u)=>{const c=((a,r)=>{const s=t(a),u=+i(s,r)-+((t,n)=>{const a=o(),r=n?.firstWeekContainsDate??n?.locale?.options?.firstWeekContainsDate??a.firstWeekContainsDate??a.locale?.options?.firstWeekContainsDate??1,s=p(t,n),u=e(t,0)
return u.setFullYear(s,0,r),u.setHours(0,0,0,0),i(u,n)})(s,r)
return Math.round(u/n)+1})(a,u)
return"wo"===r?s.ordinalNumber(c,{unit:"week"}):v(c,r.length)},I:(a,r,o)=>{const i=(a=>{const r=t(a),o=+s(r)-+(t=>{const n=u(t),a=e(t,0)
return a.setFullYear(n,0,4),a.setHours(0,0,0,0),s(a)})(r)
return Math.round(o/n)+1})(a)
return"Io"===r?o.ordinalNumber(i,{unit:"week"}):v(i,r.length)},d:(t,e,n)=>"do"===e?n.ordinalNumber(t.getDate(),{unit:"date"}):D.d(t,e),D:(n,a,r)=>{const o=(n=>{const a=t(n),r=((t,e)=>{const n=c(t),a=c(e),r=+n-d(n),o=+a-d(a)
return Math.round((r-o)/864e5)})(a,(n=>{const a=t(n),r=e(n,0)
return r.setFullYear(a.getFullYear(),0,1),r.setHours(0,0,0,0),r})(a))
return r+1})(n)
return"Do"===a?r.ordinalNumber(o,{unit:"dayOfYear"}):v(o,a.length)},E:(t,e,n)=>{const a=t.getDay()
switch(e){case"E":case"EE":case"EEE":return n.day(a,{width:"abbreviated",context:"formatting"})
case"EEEEE":return n.day(a,{width:"narrow",context:"formatting"})
case"EEEEEE":return n.day(a,{width:"short",context:"formatting"})
default:return n.day(a,{width:"wide",context:"formatting"})}},e:(t,e,n,a)=>{const r=t.getDay(),o=(r-a.weekStartsOn+8)%7||7
switch(e){case"e":return String(o)
case"ee":return v(o,2)
case"eo":return n.ordinalNumber(o,{unit:"day"})
case"eee":return n.day(r,{width:"abbreviated",context:"formatting"})
case"eeeee":return n.day(r,{width:"narrow",context:"formatting"})
case"eeeeee":return n.day(r,{width:"short",context:"formatting"})
default:return n.day(r,{width:"wide",context:"formatting"})}},c:(t,e,n,a)=>{const r=t.getDay(),o=(r-a.weekStartsOn+8)%7||7
switch(e){case"c":return String(o)
case"cc":return v(o,e.length)
case"co":return n.ordinalNumber(o,{unit:"day"})
case"ccc":return n.day(r,{width:"abbreviated",context:"standalone"})
case"ccccc":return n.day(r,{width:"narrow",context:"standalone"})
case"cccccc":return n.day(r,{width:"short",context:"standalone"})
default:return n.day(r,{width:"wide",context:"standalone"})}},i:(t,e,n)=>{const a=t.getDay(),r=0===a?7:a
switch(e){case"i":return String(r)
case"ii":return v(r,e.length)
case"io":return n.ordinalNumber(r,{unit:"day"})
case"iii":return n.day(a,{width:"abbreviated",context:"formatting"})
case"iiiii":return n.day(a,{width:"narrow",context:"formatting"})
case"iiiiii":return n.day(a,{width:"short",context:"formatting"})
default:return n.day(a,{width:"wide",context:"formatting"})}},a:(t,e,n)=>{const a=t.getHours()/12>=1?"pm":"am"
switch(e){case"a":case"aa":return n.dayPeriod(a,{width:"abbreviated",context:"formatting"})
case"aaa":return n.dayPeriod(a,{width:"abbreviated",context:"formatting"}).toLowerCase()
case"aaaaa":return n.dayPeriod(a,{width:"narrow",context:"formatting"})
default:return n.dayPeriod(a,{width:"wide",context:"formatting"})}},b:(t,e,n)=>{const a=t.getHours()
let r
switch(r=12===a?"noon":0===a?"midnight":a/12>=1?"pm":"am",e){case"b":case"bb":return n.dayPeriod(r,{width:"abbreviated",context:"formatting"})
case"bbb":return n.dayPeriod(r,{width:"abbreviated",context:"formatting"}).toLowerCase()
case"bbbbb":return n.dayPeriod(r,{width:"narrow",context:"formatting"})
default:return n.dayPeriod(r,{width:"wide",context:"formatting"})}},B:(t,e,n)=>{const a=t.getHours()
let r
switch(r=a>=17?"evening":a>=12?"afternoon":a>=4?"morning":"night",e){case"B":case"BB":case"BBB":return n.dayPeriod(r,{width:"abbreviated",context:"formatting"})
case"BBBBB":return n.dayPeriod(r,{width:"narrow",context:"formatting"})
default:return n.dayPeriod(r,{width:"wide",context:"formatting"})}},h:(t,e,n)=>{if("ho"===e){let e=t.getHours()%12
return 0===e&&(e=12),n.ordinalNumber(e,{unit:"hour"})}return D.h(t,e)},H:(t,e,n)=>"Ho"===e?n.ordinalNumber(t.getHours(),{unit:"hour"}):D.H(t,e),K:(t,e,n)=>{const a=t.getHours()%12
return"Ko"===e?n.ordinalNumber(a,{unit:"hour"}):v(a,e.length)},k:(t,e,n)=>{let a=t.getHours()
return 0===a&&(a=24),"ko"===e?n.ordinalNumber(a,{unit:"hour"}):v(a,e.length)},m:(t,e,n)=>"mo"===e?n.ordinalNumber(t.getMinutes(),{unit:"minute"}):D.m(t,e),s:(t,e,n)=>"so"===e?n.ordinalNumber(t.getSeconds(),{unit:"second"}):D.s(t,e),S:(t,e)=>D.S(t,e),X:(t,e)=>{const n=t.getTimezoneOffset()
if(0===n)return"Z"
switch(e){case"X":return P(n)
case"XXXX":case"XX":return S(n)
default:return S(n,":")}},x:(t,e)=>{const n=t.getTimezoneOffset()
switch(e){case"x":return P(n)
case"xxxx":case"xx":return S(n)
default:return S(n,":")}},O:(t,e)=>{const n=t.getTimezoneOffset()
switch(e){case"O":case"OO":case"OOO":return"GMT"+k(n,":")
default:return"GMT"+S(n,":")}},z:(t,e)=>{const n=t.getTimezoneOffset()
switch(e){case"z":case"zz":case"zzz":return"GMT"+k(n,":")
default:return"GMT"+S(n,":")}},t:(t,e)=>v(Math.trunc(t.getTime()/1e3),e.length),T:(t,e)=>v(t.getTime(),e.length)}
function k(t,e=""){const n=t>0?"-":"+",a=Math.abs(t),r=Math.trunc(a/60),o=a%60
return 0===o?n+String(r):n+String(r)+e+v(o,2)}function P(t,e){return t%60==0?(t>0?"-":"+")+v(Math.abs(t)/60,2):S(t,e)}function S(t,e=""){const n=t>0?"-":"+",a=Math.abs(t)
return n+v(Math.trunc(a/60),2)+e+v(a%60,2)}const T=(t,e)=>{switch(t){case"P":return e.date({width:"short"})
case"PP":return e.date({width:"medium"})
case"PPP":return e.date({width:"long"})
default:return e.date({width:"full"})}},W=(t,e)=>{switch(t){case"p":return e.time({width:"short"})
case"pp":return e.time({width:"medium"})
case"ppp":return e.time({width:"long"})
default:return e.time({width:"full"})}},Y={p:W,P:(t,e)=>{const n=t.match(/(P+)(p+)?/)||[],a=n[1],r=n[2]
if(!r)return T(t,e)
let o
switch(a){case"P":o=e.dateTime({width:"short"})
break
case"PP":o=e.dateTime({width:"medium"})
break
case"PPP":o=e.dateTime({width:"long"})
break
default:o=e.dateTime({width:"full"})}return o.replace("{{date}}",T(a,e)).replace("{{time}}",W(r,e))}},N=/^D+$/,C=/^Y+$/,F=["D","DD","YY","YYYY"],H=/[yYQqMLwIdDecihHKkms]o|(\w)\1*|''|'(''|[^'])+('|$)|./g,O=/P+p+|P+|p+|''|'(''|[^'])+('|$)|./g,q=/^'([^]*?)'?$/,X=/''/g,E=/[a-zA-Z]/
function j(e,n){const a=o(),r=a.locale??M,i=a.firstWeekContainsDate??a.locale?.options?.firstWeekContainsDate??1,s=a.weekStartsOn??a.locale?.options?.weekStartsOn??0,u=t(e)
if(!(e=>{if(!((n=e)instanceof Date||"object"==typeof n&&"[object Date]"===Object.prototype.toString.call(n)||"number"==typeof e))return!1
var n
const a=t(e)
return!isNaN(Number(a))})(u))throw new RangeError("Invalid time value")
let c=n.match(O).map(t=>{const e=t[0]
return"p"===e||"P"===e?(0,Y[e])(t,r.formatLong):t}).join("").match(H).map(t=>{if("''"===t)return{isToken:!1,value:"'"}
const e=t[0]
if("'"===e)return{isToken:!1,value:z(t)}
if(x[e])return{isToken:!0,value:t}
if(e.match(E))throw new RangeError("Format string contains an unescaped latin alphabet character `"+e+"`")
return{isToken:!1,value:t}})
r.localize.preprocessor&&(c=r.localize.preprocessor(u,c))
const d={firstWeekContainsDate:i,weekStartsOn:s,locale:r}
return c.map(t=>{if(!t.isToken)return t.value
const a=t.value
return((t=>C.test(t))(a)||(t=>N.test(t))(a))&&((t,e,n)=>{const a=((t,e,n)=>{const a="Y"===t[0]?"years":"days of the month"
return`Use \`${t.toLowerCase()}\` instead of \`${t}\` (in \`${e}\`) for formatting ${a} to the input \`${n}\`; see: https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md`})(t,e,n)
if(F.includes(t))throw new RangeError(a)})(a,n,String(e)),(0,x[a[0]])(u,a,r.localize,d)}).join("")}function z(t){const e=t.match(q)
return e?e[1].replace(X,"'"):t}function L(n,r){return((e,n,r)=>{const i=o(),s=r?.locale??i.locale??M,u=h(e,n)
if(isNaN(u))throw new RangeError("Invalid time value")
const c=Object.assign({},r,{addSuffix:r?.addSuffix,comparison:u})
let l,m
u>0?(l=t(n),m=t(e)):(l=t(e),m=t(n))
const f=((e,n)=>{const a=((e,n)=>+t(e)-+t(n))(e,n)/1e3
return(t=>{const e=(0,Math.trunc)(t)
return 0===e?0:e})(a)})(m,l),g=(d(m)-d(l))/1e3,w=Math.round((f-g)/60)
let b
if(w<2)return r?.includeSeconds?f<5?s.formatDistance("lessThanXSeconds",5,c):f<10?s.formatDistance("lessThanXSeconds",10,c):f<20?s.formatDistance("lessThanXSeconds",20,c):f<40?s.formatDistance("halfAMinute",0,c):f<60?s.formatDistance("lessThanXMinutes",1,c):s.formatDistance("xMinutes",1,c):0===w?s.formatDistance("lessThanXMinutes",1,c):s.formatDistance("xMinutes",w,c)
if(w<45)return s.formatDistance("xMinutes",w,c)
if(w<90)return s.formatDistance("aboutXHours",1,c)
if(w<1440){const t=Math.round(w/60)
return s.formatDistance("aboutXHours",t,c)}if(w<2520)return s.formatDistance("xDays",1,c)
if(w<a){const t=Math.round(w/1440)
return s.formatDistance("xDays",t,c)}if(w<86400)return b=Math.round(w/a),s.formatDistance("aboutXMonths",b,c)
if(b=((e,n)=>{const a=t(e),r=t(n),o=h(a,r),i=Math.abs(((e,n)=>{const a=t(e),r=t(n)
return 12*(a.getFullYear()-r.getFullYear())+(a.getMonth()-r.getMonth())})(a,r))
let s
if(i<1)s=0
else{1===a.getMonth()&&a.getDate()>27&&a.setDate(30),a.setMonth(a.getMonth()-o*i)
let n=h(a,r)===-o;(e=>{const n=t(e)
return+(e=>{const n=t(e)
return n.setHours(23,59,59,999),n})(n)===+(e=>{const n=t(e),a=n.getMonth()
return n.setFullYear(n.getFullYear(),a+1,0),n.setHours(23,59,59,999),n})(n)})(t(e))&&1===i&&1===h(e,r)&&(n=!1),s=o*(i-Number(n))}return 0===s?0:s})(m,l),b<12){const t=Math.round(w/a)
return s.formatDistance("xMonths",t,c)}{const t=b%12,e=Math.trunc(b/12)
return t<3?s.formatDistance("aboutXYears",e,c):t<9?s.formatDistance("overXYears",e,c):s.formatDistance("almostXYears",e+1,c)}})(n,(t=>e(t,Date.now()))(n),r)}export{L as a,w as b,m as c,b as d,y as e,j as f}
