import os from "node:os";
import path from "node:path";
import { mkdir, open, readFile, rename } from "node:fs/promises";

export function defaultConfigPath(env = process.env) {
  if (env.KIRANA_BRIDGE_CONFIG) return path.resolve(env.KIRANA_BRIDGE_CONFIG);
  const base = process.platform === "win32" && env.ProgramData
    ? env.ProgramData
    : path.join(os.homedir(), ".kiranaos");
  return path.join(base, "KiranaOS", "HardwareBridge", "config.json");
}

function envConfig(env) {
  let scaleArgs = [];
  let customerDisplayArgs = [];
  try { scaleArgs = JSON.parse(env.KIRANA_BRIDGE_SCALE_ARGS_JSON || "[]"); } catch { scaleArgs = []; }
  try { customerDisplayArgs = JSON.parse(env.KIRANA_BRIDGE_DISPLAY_ARGS_JSON || "[]"); } catch { customerDisplayArgs = []; }
  if (!Array.isArray(scaleArgs) || scaleArgs.some((value) => typeof value !== "string")) scaleArgs = [];
  if (!Array.isArray(customerDisplayArgs) || customerDisplayArgs.some((value) => typeof value !== "string")) customerDisplayArgs = [];
  return {
    version: 1,
    token: String(env.KIRANA_BRIDGE_TOKEN || ""),
    allowedOrigins: String(env.KIRANA_BRIDGE_ALLOWED_ORIGINS || "http://127.0.0.1:5173,http://localhost:5173")
      .split(",").map((value) => value.trim()).filter(Boolean),
    printer: {
      transport: String(env.KIRANA_BRIDGE_PRINTER_TRANSPORT || "").toLowerCase(),
      name: String(env.KIRANA_BRIDGE_PRINTER_NAME || ""),
      host: String(env.KIRANA_BRIDGE_PRINTER_HOST || ""),
      port: Number(env.KIRANA_BRIDGE_PRINTER_PORT || 9100),
    },
    scale: {
      executable: String(env.KIRANA_BRIDGE_SCALE_EXECUTABLE || ""),
      args: scaleArgs,
    },
    customerDisplay: {
      executable: String(env.KIRANA_BRIDGE_DISPLAY_EXECUTABLE || ""),
      args: customerDisplayArgs,
      width: Number(env.KIRANA_BRIDGE_DISPLAY_WIDTH || 20),
    },
    pairing: null,
    updateManifestUrl: String(env.KIRANA_BRIDGE_UPDATE_MANIFEST_URL || ""),
  };
}

export async function loadBridgeConfig(filePath = defaultConfigPath(), env = process.env) {
  let disk;
  try { disk = JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) {
    if (error?.code !== "ENOENT") throw new Error("Bridge configuration could not be read.");
    return envConfig(env);
  }
  const fallback = envConfig(env);
  return {
    version: 1,
    token: String(disk?.token || fallback.token),
    allowedOrigins: Array.isArray(disk?.allowedOrigins)
      ? disk.allowedOrigins.map(String).map((value) => value.trim()).filter(Boolean)
      : fallback.allowedOrigins,
    printer: {
      transport: String(disk?.printer?.transport || fallback.printer.transport).toLowerCase(),
      name: String(disk?.printer?.name || fallback.printer.name),
      host: String(disk?.printer?.host || fallback.printer.host),
      port: Number(disk?.printer?.port || fallback.printer.port || 9100),
    },
    scale: {
      executable: String(disk?.scale?.executable || fallback.scale.executable),
      args: Array.isArray(disk?.scale?.args) && disk.scale.args.every((value) => typeof value === "string")
        ? [...disk.scale.args]
        : fallback.scale.args,
    },
    customerDisplay: {
      executable: String(disk?.customerDisplay?.executable || fallback.customerDisplay.executable),
      args: Array.isArray(disk?.customerDisplay?.args) && disk.customerDisplay.args.every((value) => typeof value === "string")
        ? [...disk.customerDisplay.args]
        : fallback.customerDisplay.args,
      width: Number(disk?.customerDisplay?.width || fallback.customerDisplay.width || 20),
    },
    pairing: disk?.pairing && typeof disk.pairing === "object" ? { ...disk.pairing } : null,
    updateManifestUrl: String(disk?.updateManifestUrl || fallback.updateManifestUrl),
  };
}

export async function saveBridgeConfig(filePath, config) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  const handle = await open(temporary, "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(config, null, 2), "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
}
