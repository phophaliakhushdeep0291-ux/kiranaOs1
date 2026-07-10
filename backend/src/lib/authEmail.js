import tls from "tls";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

const SMTP_HOST = "smtp.gmail.com";
const SMTP_PORT = 465;
const SMTP_TIMEOUT_MS = 15000;

export function getFrontendUrl() {
  if (env.FRONTEND_APP_URL) return env.FRONTEND_APP_URL.replace(/\/$/, "");
  const firstOrigin = env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()).filter(Boolean)[0];
  return (firstOrigin || "http://localhost:5173").replace(/\/$/, "");
}

export async function sendVerificationEmail({ to, name, token }) {
  const link = `${getFrontendUrl()}/verify-email?token=${encodeURIComponent(token)}`;
  return sendAuthEmail({
    to,
    subject: "Verify your KiranaOS email",
    text: [
      `Hi ${name || "there"},`,
      "",
      "Please verify your KiranaOS account email using this link:",
      link,
      "",
      "This link expires in 24 hours.",
    ].join("\n"),
    html: authEmailHtml({
      title: "Verify your email",
      intro: `Hi ${escapeHtml(name || "there")}, confirm this email for your KiranaOS account.`,
      cta: "Verify email",
      link,
      note: "This link expires in 24 hours.",
    }),
    devLink: link,
  });
}

export async function sendPasswordResetEmail({ to, name, token }) {
  const link = `${getFrontendUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  return sendAuthEmail({
    to,
    subject: "Reset your KiranaOS password",
    text: [
      `Hi ${name || "there"},`,
      "",
      "Use this link to reset your KiranaOS password:",
      link,
      "",
      "This link expires in 30 minutes. If you did not request it, ignore this email.",
    ].join("\n"),
    html: authEmailHtml({
      title: "Reset your password",
      intro: `Hi ${escapeHtml(name || "there")}, use this secure link to set a new password.`,
      cta: "Reset password",
      link,
      note: "This link expires in 30 minutes. If you did not request it, ignore this email.",
    }),
    devLink: link,
  });
}

async function sendAuthEmail({ to, subject, text, html, devLink }) {
  if (!to) return { delivered: false, provider: env.EMAIL_PROVIDER, reason: "missing_recipient" };

  if (env.EMAIL_PROVIDER === "disabled") {
    logger.warn({ type: "auth_email_disabled", to, subject });
    return { delivered: false, provider: "disabled", reason: "disabled" };
  }

  if (env.EMAIL_PROVIDER === "console") {
    logger.info({ type: "auth_email_console", to, subject, link: devLink });
    return { delivered: true, provider: "console", devLink };
  }

  if (env.EMAIL_PROVIDER === "gmail_smtp") {
    if (!env.GMAIL_SMTP_USER || !env.GMAIL_APP_PASSWORD) {
      logger.error({ type: "auth_email_gmail_missing_config", to, subject });
      return { delivered: false, provider: "gmail_smtp", reason: "missing_config" };
    }
    await sendGmailSmtp({
      username: env.GMAIL_SMTP_USER,
      password: env.GMAIL_APP_PASSWORD,
      from: env.AUTH_EMAIL_FROM || env.GMAIL_SMTP_USER,
      to,
      subject,
      text,
      html,
    });
    return { delivered: true, provider: "gmail_smtp" };
  }

  return { delivered: false, provider: env.EMAIL_PROVIDER, reason: "unknown_provider" };
}

function sendGmailSmtp({ username, password, from, to, subject, text, html }) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: SMTP_HOST,
      port: SMTP_PORT,
      servername: SMTP_HOST,
      timeout: SMTP_TIMEOUT_MS,
    });
    let buffer = "";
    const queue = [];
    let responseLines = [];

    function cleanup() {
      socket.removeAllListeners();
      socket.end();
    }

    function readResponse() {
      return new Promise((res, rej) => {
        queue.push({ res, rej });
        flushQueue();
      });
    }

    function flushQueue() {
      if (!queue.length || !buffer.includes("\n")) return;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        responseLines.push(line);
        if (/^\d{3} /.test(line)) {
          const pending = queue.shift();
          if (!pending) return;
          const message = responseLines.join("\n");
          responseLines = [];
          if (/^[45]\d\d /.test(line)) pending.rej(new Error(message));
          else pending.res(message);
        }
      }
    }

    async function command(line) {
      socket.write(`${line}\r\n`);
      return readResponse();
    }

    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      flushQueue();
    });
    socket.on("timeout", () => {
      cleanup();
      reject(new Error("Gmail SMTP timed out"));
    });
    socket.on("error", (error) => {
      cleanup();
      reject(error);
    });
    socket.on("secureConnect", async () => {
      try {
        await readResponse();
        await command("EHLO kiranaos.local");
        await command("AUTH LOGIN");
        await command(Buffer.from(username).toString("base64"));
        await command(Buffer.from(password).toString("base64"));
        await command(`MAIL FROM:<${sanitizeEmailAddress(from)}>`);
        await command(`RCPT TO:<${sanitizeEmailAddress(to)}>`);
        await command("DATA");
        socket.write(buildMessage({ from, to, subject, text, html }));
        await readResponse();
        await command("QUIT").catch(() => null);
        cleanup();
        resolve();
      } catch (error) {
        cleanup();
        reject(error);
      }
    });
  });
}

function buildMessage({ from, to, subject, text, html }) {
  const boundary = `kiranaos_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  return [
    `From: ${formatAddress(from)}`,
    `To: ${formatAddress(to)}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    "",
    `--${boundary}--`,
    ".",
    "",
  ].join("\r\n");
}

function authEmailHtml({ title, intro, cta, link, note }) {
  const safeLink = escapeHtml(link);
  return `<!doctype html>
<html>
  <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
    <div style="max-width:520px;margin:0 auto;padding:32px 16px;">
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:28px;">
        <h1 style="margin:0 0 12px;font-size:24px;">${escapeHtml(title)}</h1>
        <p style="margin:0 0 24px;color:#475569;line-height:1.5;">${intro}</p>
        <a href="${safeLink}" style="display:inline-block;background:#005dff;color:#fff;text-decoration:none;border-radius:10px;padding:12px 18px;font-weight:700;">${escapeHtml(cta)}</a>
        <p style="margin:24px 0 0;color:#64748b;font-size:13px;line-height:1.5;">${escapeHtml(note)}</p>
      </div>
    </div>
  </body>
</html>`;
}

function formatAddress(address) {
  return `<${sanitizeEmailAddress(address)}>`;
}

function sanitizeEmailAddress(address) {
  return String(address || "").replace(/[<>\r\n]/g, "").trim();
}

function encodeHeader(value) {
  return String(value || "").replace(/[\r\n]/g, " ");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
