import net from "node:net";
import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

function run(executable, args, { timeoutMs = 12_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Hardware adapter timed out")); }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout = (stdout + chunk).slice(-4096); });
    child.stderr.on("data", (chunk) => { stderr = (stderr + chunk).slice(-4096); });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `Hardware adapter exited with code ${code}`));
    });
  });
}

export async function sendNetworkRaw(buffer, { host, port = 9100, timeoutMs = 8_000 }) {
  if (!host) throw new Error("KIRANA_BRIDGE_PRINTER_HOST is required for network printing");
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port: Number(port) });
    const timer = setTimeout(() => socket.destroy(new Error("Printer connection timed out")), timeoutMs);
    socket.once("connect", () => socket.end(buffer));
    socket.once("error", (error) => { clearTimeout(timer); reject(error); });
    socket.once("close", (hadError) => { clearTimeout(timer); if (!hadError) resolve(); });
  });
}

export async function sendWindowsRaw(buffer, { printerName }) {
  if (process.platform !== "win32") throw new Error("Windows raw spool printing is available only on Windows");
  if (!printerName) throw new Error("KIRANA_BRIDGE_PRINTER_NAME is required for Windows printing");
  const directory = await mkdtemp(path.join(os.tmpdir(), "kiranaos-print-"));
  const payloadPath = path.join(directory, "receipt.bin");
  const scriptPath = fileURLToPath(new URL("../scripts/windows-raw-print.ps1", import.meta.url));
  try {
    await writeFile(payloadPath, buffer, { mode: 0o600 });
    await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-PrinterName", printerName, "-PayloadPath", payloadPath]);
  } finally {
    await rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}

export async function readScaleCommand({ executable, args = [] }) {
  if (!executable) throw new Error("Scale adapter is not configured");
  const output = await run(executable, args, { timeoutMs: 4_000 });
  const parsed = JSON.parse(output);
  if (!Number.isFinite(Number(parsed.weight)) || !["g", "kg"].includes(parsed.unit)) throw new Error("Scale adapter returned invalid JSON");
  return { weight: Number(parsed.weight), unit: parsed.unit, ...(typeof parsed.stable === "boolean" ? { stable: parsed.stable } : {}) };
}
