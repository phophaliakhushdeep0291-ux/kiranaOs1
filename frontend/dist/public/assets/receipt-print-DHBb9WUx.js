function o(t){const e=Number.isFinite(t)?t:0;return`Rs ${e.toLocaleString("en-IN",{minimumFractionDigits:Number.isInteger(e)?0:2,maximumFractionDigits:2})}`}function r(t){return t.replace(/[&<>'"]/g,e=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#039;",'"':"&quot;"})[e]??e)}function f(t){return String(t??"").trim()}function n(t,e=""){const i=f(t);return i.length>0?i:e}function u(t){if(!t)return"";const e=new Date(t);return Number.isNaN(e.getTime())?n(t):e.toLocaleString("en-IN",{dateStyle:"medium",timeStyle:"short"})}function x(t){const e=Number.isFinite(t)?t:0;return e.toLocaleString("en-IN",{minimumFractionDigits:Number.isInteger(e)?0:2,maximumFractionDigits:3})}function h(t,e){const i=n(e);if(i)return i;const a=t.trim().toLowerCase();return a==="cash"?"Cash":a==="upi"?"UPI":a==="credit"?"Udhar":a==="card"?"Card":a==="bank"?"Bank":n(t,"Payment")}function w(t){return t.length===0?'<tr><td class="empty" colspan="4">No items recorded</td></tr>':t.map((e,i)=>`
        <tr>
          <td class="item">
            <span class="serial">${i+1}.</span>
            <span>${r(n(e.name,"Item"))}</span>
          </td>
          <td class="right nowrap">${x(e.quantity)} ${r(n(e.unit))}</td>
          <td class="right nowrap">${o(e.rate)}</td>
          <td class="right nowrap">${o(e.total)}</td>
        </tr>`).join("")}function y(t){const e=(t.payments??[]).filter(a=>Number(a.amount)>0),i=e.length>0?e:[...t.paid>0?[{mode:"paid",label:"Paid",amount:t.paid}]:[],...t.credit>0?[{mode:"credit",label:"Udhar",amount:t.credit}]:[]];return i.length===0?"":`
      <div class="section-title">Payment</div>
      <div class="payment-box">
        ${i.map(a=>`
          <div class="line">
            <span>${r(h(a.mode,a.label))}</span>
            <strong>${o(Number(a.amount)||0)}</strong>
          </div>`).join("")}
      </div>`}function v(t){return[n(t==null?void 0:t.address),n(t==null?void 0:t.city),t!=null&&t.phone?`Phone: ${n(t.phone)}`:"",t!=null&&t.gstNumber?`GSTIN: ${n(t.gstNumber)}`:""].filter(Boolean).map(i=>`<div>${r(i)}</div>`).join("")}function $(t){var s,l;const e=n((s=t.shop)==null?void 0:s.name,"KiranaOS"),i=u(t.createdAt),a=n(t.customerName,"Walk-in"),c=n(t.customerMobile),p=n(t.copyLabel,"Customer copy"),m=n(t.billTypeLabel,"Sale receipt"),d=n((l=t.shop)==null?void 0:l.cashierName),g=n(t.footerNote,"Thank you for shopping with us."),b=n(t.status).toLowerCase()==="cancelled";return`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${r(t.billNo)}</title>
  <style>
    @page { size: 80mm auto; margin: 4mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #f3f4f6;
      color: #111827;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 12px;
      line-height: 1.35;
    }
    .receipt-shell {
      width: min(100%, 88mm);
      margin: 0 auto;
      padding: 12px;
    }
    .receipt {
      background: #ffffff;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.14);
      overflow: hidden;
    }
    .inner { padding: 14px; }
    .shop {
      text-align: center;
      border-bottom: 2px solid #111827;
      padding-bottom: 10px;
    }
    .shop-name {
      font-size: 21px;
      font-weight: 900;
      letter-spacing: 0.4px;
      text-transform: uppercase;
    }
    .shop-meta { margin-top: 4px; color: #4b5563; font-size: 11px; }
    .receipt-type {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      border-bottom: 1px dashed #9ca3af;
      padding: 10px 0;
      text-transform: uppercase;
      font-size: 10px;
      font-weight: 800;
      color: #374151;
    }
    .badge {
      border: 1px solid #111827;
      border-radius: 999px;
      padding: 2px 7px;
      color: #111827;
      white-space: nowrap;
    }
    .cancelled {
      margin-top: 10px;
      border: 1px solid #991b1b;
      background: #fef2f2;
      color: #991b1b;
      padding: 7px;
      text-align: center;
      font-weight: 900;
      text-transform: uppercase;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 6px 10px;
      border-bottom: 1px dashed #9ca3af;
      padding: 10px 0;
    }
    .meta-grid span {
      display: block;
      color: #6b7280;
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 800;
    }
    .meta-grid strong {
      display: block;
      margin-top: 1px;
      font-size: 12px;
      word-break: break-word;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }
    th {
      border-bottom: 1px solid #111827;
      padding: 6px 2px;
      color: #374151;
      font-size: 10px;
      text-transform: uppercase;
    }
    td {
      border-bottom: 1px solid #e5e7eb;
      padding: 7px 2px;
      vertical-align: top;
    }
    .item {
      width: 37%;
      font-weight: 700;
      word-break: break-word;
    }
    .serial {
      color: #6b7280;
      font-weight: 700;
      margin-right: 3px;
    }
    .right { text-align: right; }
    .nowrap { white-space: nowrap; }
    .empty {
      padding: 16px 0;
      text-align: center;
      color: #6b7280;
    }
    .summary {
      border-top: 1px dashed #9ca3af;
      margin-top: 10px;
      padding-top: 8px;
    }
    .line {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 5px 0;
    }
    .line span { color: #4b5563; }
    .grand {
      background: #111827;
      color: #ffffff;
      border-radius: 6px;
      margin-top: 8px;
      padding: 8px;
      font-size: 15px;
      font-weight: 900;
    }
    .grand span { color: #ffffff; }
    .due strong { color: #991b1b; }
    .section-title {
      margin-top: 10px;
      color: #6b7280;
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 900;
    }
    .payment-box {
      border: 1px solid #e5e7eb;
      border-radius: 7px;
      margin-top: 5px;
      padding: 6px 8px;
    }
    .footer {
      border-top: 1px dashed #9ca3af;
      margin-top: 12px;
      padding-top: 10px;
      text-align: center;
      color: #4b5563;
      font-size: 11px;
    }
    .system-note {
      margin-top: 6px;
      color: #6b7280;
      font-size: 10px;
    }
    .actions {
      padding: 0 14px 14px;
      text-align: center;
    }
    button {
      width: 100%;
      border: 0;
      border-radius: 8px;
      background: #16a34a;
      color: white;
      cursor: pointer;
      font-weight: 800;
      padding: 10px 12px;
    }
    @media print {
      body { background: #ffffff; }
      .receipt-shell { width: auto; padding: 0; }
      .receipt { border: 0; border-radius: 0; box-shadow: none; }
      .inner { padding: 0; }
      .actions { display: none; }
    }
  </style>
</head>
<body>
  <div class="receipt-shell">
    <div class="receipt">
      <div class="inner">
        <header class="shop">
          <div class="shop-name">${r(e)}</div>
          <div class="shop-meta">${v(t.shop)}</div>
        </header>
        <div class="receipt-type">
          <span>${r(m)}</span>
          <span class="badge">${r(p)}</span>
        </div>
        ${b?'<div class="cancelled">Cancelled bill</div>':""}
        <section class="meta-grid">
          <div><span>Bill no</span><strong>${r(n(t.billNo,"Pending"))}</strong></div>
          <div><span>Date</span><strong>${r(i||"-")}</strong></div>
          <div><span>Customer</span><strong>${r(a)}</strong></div>
          <div><span>Mobile</span><strong>${r(c||"-")}</strong></div>
          ${d?`<div><span>Cashier</span><strong>${r(d)}</strong></div>`:""}
        </section>
        <table>
          <thead>
            <tr><th>Item</th><th class="right">Qty</th><th class="right">Rate</th><th class="right">Amt</th></tr>
          </thead>
          <tbody>${w(t.rows)}</tbody>
        </table>
        <section class="summary">
          <div class="line"><span>Subtotal</span><strong>${o(t.subtotal)}</strong></div>
          ${t.discount>0?`<div class="line"><span>Discount</span><strong>-${o(t.discount)}</strong></div>`:""}
          <div class="line grand"><span>Total</span><strong>${o(t.total)}</strong></div>
          <div class="line"><span>Paid</span><strong>${o(t.paid)}</strong></div>
          <div class="line due"><span>Due / Udhar</span><strong>${o(t.credit)}</strong></div>
        </section>
        ${y(t)}
        <footer class="footer">
          <strong>${r(g)}</strong>
          <div class="system-note">Powered by KiranaOS - local-first counter billing.</div>
        </footer>
      </div>
      <div class="actions"><button onclick="window.print()">Print / Save PDF</button></div>
    </div>
  </div>
</body>
</html>`}function N(t){var e;return`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Saving bill</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, Helvetica, sans-serif; background: #f3f4f6; color: #111827; }
    .box { width: min(92vw, 360px); border: 1px solid #d1d5db; border-radius: 14px; background: white; padding: 22px; box-shadow: 0 16px 36px rgba(15,23,42,0.12); }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 0; color: #4b5563; line-height: 1.45; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Saving bill...</h1>
    <p>${r(n((e=t==null?void 0:t.shop)==null?void 0:e.name,"KiranaOS"))} is saving this bill. Printing will start after the bill number is ready.</p>
  </div>
</body>
</html>`}function k(t){return`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Bill print failed</title>
  <style>
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; font-family: Arial, Helvetica, sans-serif; background: #fef2f2; color: #111827; }
    .box { width: min(92vw, 360px); border: 1px solid #fecaca; border-radius: 14px; background: white; padding: 22px; box-shadow: 0 16px 36px rgba(127,29,29,0.12); }
    h1 { margin: 0 0 8px; color: #991b1b; font-size: 20px; }
    p { margin: 0; color: #4b5563; line-height: 1.45; }
  </style>
</head>
<body>
  <div class="box">
    <h1>Bill was not saved</h1>
    <p>${r(t)}</p>
  </div>
</body>
</html>`}function z(t,e,i={}){t.document.open(),t.document.write($(e)),t.document.close(),t.focus(),(i.autoPrint??!0)&&setTimeout(()=>t.print(),i.printDelayMs??300)}function S(t,e){t.document.open(),t.document.write(N(e)),t.document.close(),t.focus()}function P(t,e){t.document.open(),t.document.write(k(e)),t.document.close(),t.focus()}function R(t,e={}){const i=window.open("","_blank","width=460,height=760");return i?(z(i,t,e),!0):!1}export{z as a,P as b,R as o,S as w};
