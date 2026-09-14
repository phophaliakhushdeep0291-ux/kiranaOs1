var t=Object.defineProperty,e=(e,r,s)=>((e,r,s)=>r in e?t(e,r,{enumerable:!0,configurable:!0,writable:!0,value:s}):e[r]=s)(e,"symbol"!=typeof r?r+"":r,s)
function r(t,e,r){if(e<0||e>31||t>>>e!=0)throw new RangeError("Value out of range")
for(let s=e-1;s>=0;s--)r.push(t>>>s&1)}function s(t,e){return!!(t>>>e&1)}function n(t){if(!t)throw new Error("Assertion error")}const o=class{constructor(t,e){this.ordinal=t,this.formatBits=e}}
e(o,"LOW",new o(0,1)),e(o,"MEDIUM",new o(1,0)),e(o,"QUARTILE",new o(2,3)),e(o,"HIGH",new o(3,2))
let i=o
const a=class{constructor(t,e){this.modeBits=t,this.numBitsCharCount=e}numCharCountBits(t){return this.numBitsCharCount[Math.floor((t+7)/17)]}}
e(a,"NUMERIC",new a(1,[10,12,14])),e(a,"ALPHANUMERIC",new a(2,[9,11,13])),e(a,"BYTE",new a(4,[8,16,16])),e(a,"KANJI",new a(8,[8,10,12])),e(a,"ECI",new a(7,[0,0,0]))
let l=a
const h=class t{constructor(t,e,r){if(this.mode=t,this.numChars=e,this.bitData=r,e<0)throw new RangeError("Invalid argument")
this.bitData=r.slice()}static makeBytes(e){let s=[]
for(const t of e)r(t,8,s)
return new t(l.BYTE,e.length,s)}static makeNumeric(e){if(!t.isNumeric(e))throw new RangeError("String contains non-numeric characters")
let s=[]
for(let t=0;t<e.length;){const n=Math.min(e.length-t,3)
r(parseInt(e.substring(t,t+n),10),3*n+1,s),t+=n}return new t(l.NUMERIC,e.length,s)}static makeAlphanumeric(e){if(!t.isAlphanumeric(e))throw new RangeError("String contains unencodable characters in alphanumeric mode")
let s,n=[]
for(s=0;s+2<=e.length;s+=2){let o=45*t.ALPHANUMERIC_CHARSET.indexOf(e.charAt(s))
o+=t.ALPHANUMERIC_CHARSET.indexOf(e.charAt(s+1)),r(o,11,n)}return s<e.length&&r(t.ALPHANUMERIC_CHARSET.indexOf(e.charAt(s)),6,n),new t(l.ALPHANUMERIC,e.length,n)}static makeSegments(e){return""==e?[]:t.isNumeric(e)?[t.makeNumeric(e)]:t.isAlphanumeric(e)?[t.makeAlphanumeric(e)]:[t.makeBytes(t.toUtf8ByteArray(e))]}static makeEci(e){let s=[]
if(e<0)throw new RangeError("ECI assignment value out of range")
if(e<128)r(e,8,s)
else if(e<16384)r(2,2,s),r(e,14,s)
else{if(!(e<1e6))throw new RangeError("ECI assignment value out of range")
r(6,3,s),r(e,21,s)}return new t(l.ECI,0,s)}static isNumeric(e){return t.NUMERIC_REGEX.test(e)}static isAlphanumeric(e){return t.ALPHANUMERIC_REGEX.test(e)}getData(){return this.bitData.slice()}static getTotalBits(t,e){let r=0
for(const s of t){const t=s.mode.numCharCountBits(e)
if(s.numChars>=1<<t)return 1/0
r+=4+t+s.bitData.length}return r}static toUtf8ByteArray(t){t=encodeURI(t)
let e=[]
for(let r=0;r<t.length;r++)"%"!=t.charAt(r)?e.push(t.charCodeAt(r)):(e.push(parseInt(t.substring(r+1,r+3),16)),r+=2)
return e}}
e(h,"NUMERIC_REGEX",/^[0-9]*$/),e(h,"ALPHANUMERIC_REGEX",/^[A-Z0-9 $%*+.\/:-]*$/),e(h,"ALPHANUMERIC_CHARSET","0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:")
let u=h
const c=class t{constructor(r,s,o,i){if(e(this,"size"),e(this,"mask"),e(this,"modules",[]),e(this,"isFunction",[]),this.version=r,this.errorCorrectionLevel=s,r<t.MIN_VERSION||r>t.MAX_VERSION)throw new RangeError("Version value out of range")
if(i<-1||i>7)throw new RangeError("Mask value out of range")
this.size=4*r+17
let a=[]
for(let t=0;t<this.size;t++)a.push(!1)
for(let t=0;t<this.size;t++)this.modules.push(a.slice()),this.isFunction.push(a.slice())
this.drawFunctionPatterns()
const l=this.addEccAndInterleave(o)
if(this.drawCodewords(l),-1==i){let t=1e9
for(let e=0;e<8;e++){this.applyMask(e),this.drawFormatBits(e)
const r=this.getPenaltyScore()
r<t&&(i=e,t=r),this.applyMask(e)}}n(0<=i&&i<=7),this.mask=i,this.applyMask(i),this.drawFormatBits(i),this.isFunction=[]}static encodeText(e,r){const s=u.makeSegments(e)
return t.encodeSegments(s,r)}static encodeBinary(e,r){const s=u.makeBytes(e)
return t.encodeSegments([s],r)}static encodeSegments(e,s,o=1,a=40,l=-1,h=!0){if(!(t.MIN_VERSION<=o&&o<=a&&a<=t.MAX_VERSION)||l<-1||l>7)throw new RangeError("Invalid value")
let c,d
for(c=o;;c++){const r=8*t.getNumDataCodewords(c,s),n=u.getTotalBits(e,c)
if(n<=r){d=n
break}if(c>=a)throw new RangeError("Data too long")}for(const r of[i.MEDIUM,i.QUARTILE,i.HIGH])h&&d<=8*t.getNumDataCodewords(c,r)&&(s=r)
let f=[]
for(const t of e){r(t.mode.modeBits,4,f),r(t.numChars,t.mode.numCharCountBits(c),f)
for(const e of t.getData())f.push(e)}n(f.length==d)
const m=8*t.getNumDataCodewords(c,s)
n(f.length<=m),r(0,Math.min(4,m-f.length),f),r(0,(8-f.length%8)%8,f),n(f.length%8==0)
for(let t=236;f.length<m;t^=253)r(t,8,f)
let g=[]
for(;8*g.length<f.length;)g.push(0)
return f.forEach((t,e)=>g[e>>>3]|=t<<7-(7&e)),new t(c,s,g,l)}getModule(t,e){return 0<=t&&t<this.size&&0<=e&&e<this.size&&this.modules[e][t]}drawFunctionPatterns(){for(let r=0;r<this.size;r++)this.setFunctionModule(6,r,r%2==0),this.setFunctionModule(r,6,r%2==0)
this.drawFinderPattern(3,3),this.drawFinderPattern(this.size-4,3),this.drawFinderPattern(3,this.size-4)
const t=this.getAlignmentPatternPositions(),e=t.length
for(let r=0;r<e;r++)for(let s=0;s<e;s++)0==r&&0==s||0==r&&s==e-1||r==e-1&&0==s||this.drawAlignmentPattern(t[r],t[s])
this.drawFormatBits(0),this.drawVersion()}drawFormatBits(t){const e=this.errorCorrectionLevel.formatBits<<3|t
let r=e
for(let s=0;s<10;s++)r=r<<1^1335*(r>>>9)
const o=21522^(e<<10|r)
n(o>>>15==0)
for(let n=0;n<=5;n++)this.setFunctionModule(8,n,s(o,n))
this.setFunctionModule(8,7,s(o,6)),this.setFunctionModule(8,8,s(o,7)),this.setFunctionModule(7,8,s(o,8))
for(let n=9;n<15;n++)this.setFunctionModule(14-n,8,s(o,n))
for(let n=0;n<8;n++)this.setFunctionModule(this.size-1-n,8,s(o,n))
for(let n=8;n<15;n++)this.setFunctionModule(8,this.size-15+n,s(o,n))
this.setFunctionModule(8,this.size-8,!0)}drawVersion(){if(this.version<7)return
let t=this.version
for(let r=0;r<12;r++)t=t<<1^7973*(t>>>11)
const e=this.version<<12|t
n(e>>>18==0)
for(let r=0;r<18;r++){const t=s(e,r),n=this.size-11+r%3,o=Math.floor(r/3)
this.setFunctionModule(n,o,t),this.setFunctionModule(o,n,t)}}drawFinderPattern(t,e){for(let r=-4;r<=4;r++)for(let s=-4;s<=4;s++){const n=Math.max(Math.abs(s),Math.abs(r)),o=t+s,i=e+r
0<=o&&o<this.size&&0<=i&&i<this.size&&this.setFunctionModule(o,i,2!=n&&4!=n)}}drawAlignmentPattern(t,e){for(let r=-2;r<=2;r++)for(let s=-2;s<=2;s++)this.setFunctionModule(t+s,e+r,1!=Math.max(Math.abs(s),Math.abs(r)))}setFunctionModule(t,e,r){this.modules[e][t]=r,this.isFunction[e][t]=!0}addEccAndInterleave(e){const r=this.version,s=this.errorCorrectionLevel
if(e.length!=t.getNumDataCodewords(r,s))throw new RangeError("Invalid argument")
const o=t.NUM_ERROR_CORRECTION_BLOCKS[s.ordinal][r],i=t.ECC_CODEWORDS_PER_BLOCK[s.ordinal][r],a=Math.floor(t.getNumRawDataModules(r)/8),l=o-a%o,h=Math.floor(a/o)
let u=[]
const c=t.reedSolomonComputeDivisor(i)
for(let n=0,f=0;n<o;n++){let r=e.slice(f,f+h-i+(n<l?0:1))
f+=r.length
const s=t.reedSolomonComputeRemainder(r,c)
n<l&&r.push(0),u.push(r.concat(s))}let d=[]
for(let t=0;t<u[0].length;t++)u.forEach((e,r)=>{(t!=h-i||r>=l)&&d.push(e[t])})
return n(d.length==a),d}drawCodewords(e){if(e.length!=Math.floor(t.getNumRawDataModules(this.version)/8))throw new RangeError("Invalid argument")
let r=0
for(let t=this.size-1;t>=1;t-=2){6==t&&(t=5)
for(let n=0;n<this.size;n++)for(let o=0;o<2;o++){const i=t-o,a=t+1&2?n:this.size-1-n
!this.isFunction[a][i]&&r<8*e.length&&(this.modules[a][i]=s(e[r>>>3],7-(7&r)),r++)}}n(r==8*e.length)}applyMask(t){if(t<0||t>7)throw new RangeError("Mask value out of range")
for(let e=0;e<this.size;e++)for(let r=0;r<this.size;r++){let s
switch(t){case 0:s=(r+e)%2==0
break
case 1:s=e%2==0
break
case 2:s=r%3==0
break
case 3:s=(r+e)%3==0
break
case 4:s=(Math.floor(r/3)+Math.floor(e/2))%2==0
break
case 5:s=r*e%2+r*e%3==0
break
case 6:s=(r*e%2+r*e%3)%2==0
break
case 7:s=((r+e)%2+r*e%3)%2==0
break
default:throw new Error("Unreachable")}!this.isFunction[e][r]&&s&&(this.modules[e][r]=!this.modules[e][r])}}getPenaltyScore(){let e=0
for(let n=0;n<this.size;n++){let r=!1,s=0,o=[0,0,0,0,0,0,0]
for(let i=0;i<this.size;i++)this.modules[n][i]==r?(s++,5==s?e+=t.PENALTY_N1:s>5&&e++):(this.finderPenaltyAddHistory(s,o),r||(e+=this.finderPenaltyCountPatterns(o)*t.PENALTY_N3),r=this.modules[n][i],s=1)
e+=this.finderPenaltyTerminateAndCount(r,s,o)*t.PENALTY_N3}for(let n=0;n<this.size;n++){let r=!1,s=0,o=[0,0,0,0,0,0,0]
for(let i=0;i<this.size;i++)this.modules[i][n]==r?(s++,5==s?e+=t.PENALTY_N1:s>5&&e++):(this.finderPenaltyAddHistory(s,o),r||(e+=this.finderPenaltyCountPatterns(o)*t.PENALTY_N3),r=this.modules[i][n],s=1)
e+=this.finderPenaltyTerminateAndCount(r,s,o)*t.PENALTY_N3}for(let n=0;n<this.size-1;n++)for(let r=0;r<this.size-1;r++){const s=this.modules[n][r]
s==this.modules[n][r+1]&&s==this.modules[n+1][r]&&s==this.modules[n+1][r+1]&&(e+=t.PENALTY_N2)}let r=0
for(const t of this.modules)r=t.reduce((t,e)=>t+(e?1:0),r)
const s=this.size*this.size,o=Math.ceil(Math.abs(20*r-10*s)/s)-1
return n(0<=o&&o<=9),e+=o*t.PENALTY_N4,n(0<=e&&e<=2568888),e}getAlignmentPatternPositions(){if(1==this.version)return[]
{const t=Math.floor(this.version/7)+2,e=2*Math.floor((8*this.version+3*t+5)/(4*t-4))
let r=[6]
for(let s=this.size-7;r.length<t;s-=e)r.splice(1,0,s)
return r}}static getNumRawDataModules(e){if(e<t.MIN_VERSION||e>t.MAX_VERSION)throw new RangeError("Version number out of range")
let r=(16*e+128)*e+64
if(e>=2){const t=Math.floor(e/7)+2
r-=(25*t-10)*t-55,e>=7&&(r-=36)}return n(208<=r&&r<=29648),r}static getNumDataCodewords(e,r){return Math.floor(t.getNumRawDataModules(e)/8)-t.ECC_CODEWORDS_PER_BLOCK[r.ordinal][e]*t.NUM_ERROR_CORRECTION_BLOCKS[r.ordinal][e]}static reedSolomonComputeDivisor(e){if(e<1||e>255)throw new RangeError("Degree out of range")
let r=[]
for(let t=0;t<e-1;t++)r.push(0)
r.push(1)
let s=1
for(let n=0;n<e;n++){for(let e=0;e<r.length;e++)r[e]=t.reedSolomonMultiply(r[e],s),e+1<r.length&&(r[e]^=r[e+1])
s=t.reedSolomonMultiply(s,2)}return r}static reedSolomonComputeRemainder(e,r){let s=r.map(()=>0)
for(const n of e){const e=n^s.shift()
s.push(0),r.forEach((r,n)=>s[n]^=t.reedSolomonMultiply(r,e))}return s}static reedSolomonMultiply(t,e){if(t>>>8!=0||e>>>8!=0)throw new RangeError("Byte out of range")
let r=0
for(let s=7;s>=0;s--)r=r<<1^285*(r>>>7),r^=(e>>>s&1)*t
return n(r>>>8==0),r}finderPenaltyCountPatterns(t){const e=t[1]
n(e<=3*this.size)
const r=e>0&&t[2]==e&&t[3]==3*e&&t[4]==e&&t[5]==e
return(r&&t[0]>=4*e&&t[6]>=e?1:0)+(r&&t[6]>=4*e&&t[0]>=e?1:0)}finderPenaltyTerminateAndCount(t,e,r){return t&&(this.finderPenaltyAddHistory(e,r),e=0),e+=this.size,this.finderPenaltyAddHistory(e,r),this.finderPenaltyCountPatterns(r)}finderPenaltyAddHistory(t,e){0==e[0]&&(t+=this.size),e.pop(),e.unshift(t)}}
e(c,"MIN_VERSION",1),e(c,"MAX_VERSION",40),e(c,"PENALTY_N1",3),e(c,"PENALTY_N2",3),e(c,"PENALTY_N3",40),e(c,"PENALTY_N4",10),e(c,"ECC_CODEWORDS_PER_BLOCK",[[-1,7,10,15,20,26,18,20,24,30,18,20,24,26,30,22,24,28,30,28,28,28,28,30,30,26,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],[-1,10,16,26,18,24,16,18,22,22,26,30,22,22,24,24,28,28,26,26,26,26,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28,28],[-1,13,22,18,26,18,24,18,22,20,24,28,26,24,20,30,24,28,28,26,30,28,30,30,30,30,28,30,30,30,30,30,30,30,30,30,30,30,30,30,30],[-1,17,28,22,16,22,28,26,26,24,28,24,28,22,24,24,30,28,28,26,28,30,24,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30,30]]),e(c,"NUM_ERROR_CORRECTION_BLOCKS",[[-1,1,1,1,1,1,2,2,2,2,4,4,4,4,4,6,6,6,6,7,8,8,9,9,10,12,12,12,13,14,15,16,17,18,19,19,20,21,22,24,25],[-1,1,1,1,2,2,4,4,4,5,5,5,8,9,9,10,10,11,13,14,16,17,17,18,20,21,23,25,26,28,29,31,33,35,37,38,40,43,45,47,49],[-1,1,1,2,2,4,4,6,6,8,8,8,10,12,16,12,17,16,18,21,20,23,23,25,27,29,34,34,35,38,40,43,45,48,51,53,56,59,62,65,68],[-1,1,1,2,4,4,4,5,6,8,8,11,11,16,16,18,16,19,21,25,25,25,34,30,32,35,37,40,42,45,48,51,54,57,60,63,66,70,74,77,81]])
let d=c
function f(t){switch(t){case"L":return i.LOW
case"M":return i.MEDIUM
case"Q":return i.QUARTILE
case"H":return i.HIGH}}function m(t,e="M"){const r=d.encodeText(t,f(e)),s=[]
for(let n=0;n<r.size;n++){const t=[]
for(let e=0;e<r.size;e++)t.push(r.getModule(e,n))
s.push(t)}return s}function g(t,e={}){const{level:r="M",border:s=4,dark:n="#0b1424",light:o="#ffffff"}=e
if(s<0)throw new RangeError("Border must be non-negative")
const i=d.encodeText(t,f(r)),a=i.size+2*s
let l=""
for(let h=0;h<i.size;h++)for(let t=0;t<i.size;t++)i.getModule(t,h)&&(l+=`${l?" ":""}M${t+s},${h+s}h1v1h-1z`)
return`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${a} ${a}" shape-rendering="crispEdges">${"transparent"===o?"":`<rect width="${a}" height="${a}" fill="${o}"/>`}<path d="${l}" fill="${n}"/></svg>`}export{g as a,m as e}
