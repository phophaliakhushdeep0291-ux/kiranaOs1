import http from "node:http";

const login = await fetch("http://127.0.0.1:3000/api/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    mobile: "9708201657",
    password: "Cashier@123"
  })
});

const payload = await login.json();
if (!login.ok || payload?.success === false) {
  throw new Error(payload?.error || `Staff login failed (${login.status})`);
}

const data = payload.data ?? payload;
const session = {
  accessToken: data.accessToken ?? data.token,
  refreshToken: data.refreshToken ?? null,
  user: data.user,
  shop: data.shop
};

const sessionJson = JSON.stringify(session).replaceAll("<", "\\u003c");
const script = `
  const now = String(Date.now());
  localStorage.setItem("kiranaos.auth.session.v1", ${JSON.stringify(sessionJson)});
  localStorage.setItem("kiranaos.security.lastActivity.v1", now);
  sessionStorage.setItem("kiranaos.security.sessionStarted.v1", now);
  location.replace("/billing");
`;

const server = http.createServer((request, response) => {
  if (request.url !== "/session.js") {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "content-type": "application/javascript; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(script, () => server.close());
});

server.listen(5180, "127.0.0.1", () => console.log("BILL-008 staff session ready"));
