import path from "node:path";

// Railway tells a service where its volume is mounted, and nothing else checks
// that the app writes there. The API's volume was attached at
// /var/lib/postgresql/data — a PostgreSQL data path, on a service that is not
// PostgreSQL — while local storage wrote to /app/storage on the container disk.
// Every export and backup looked saved and was discarded on the next deploy.

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function onRailway(source) {
  return Boolean(source.RAILWAY_PROJECT_ID || source.RAILWAY_ENVIRONMENT_NAME || source.RAILWAY_ENVIRONMENT);
}

/**
 * Compares where local storage writes with where Railway mounted the volume.
 * Returns errors (files will be lost) and warnings (worth a look); both empty
 * off Railway, since only Railway reports its mount path.
 */
export function assessStorageVolume({ source = process.env, cwd = process.cwd() } = {}) {
  const errors = [];
  const warnings = [];
  if (!onRailway(source)) return { errors, warnings, storageRoot: null, mountPath: null };

  const storageProvider = source.STORAGE_PROVIDER || "local";
  const storageRoot = path.resolve(cwd, "storage");
  const mountPath = source.RAILWAY_VOLUME_MOUNT_PATH ? path.resolve(source.RAILWAY_VOLUME_MOUNT_PATH) : null;
  const production = (source.NODE_ENV || "development") === "production";
  const fix = `Mount this service's volume at ${storageRoot}`;

  if (mountPath && isInside(mountPath, "/var/lib/postgresql")) {
    const message = `Volume is mounted at ${mountPath}, a PostgreSQL data path; this service never writes there`;
    (production && storageProvider === "local" ? errors : warnings).push(`${message}. ${fix}.`);
  }

  if (storageProvider === "local" && production) {
    if (!mountPath) {
      errors.push(`STORAGE_PROVIDER=local writes to ${storageRoot} on the container disk, which is discarded on every deploy. ${fix}, or use s3/r2.`);
    } else if (!isInside(storageRoot, mountPath)) {
      errors.push(`STORAGE_PROVIDER=local writes to ${storageRoot}, outside the volume at ${mountPath}; those files are discarded on every deploy. ${fix}.`);
    }
  }

  if (mountPath && source.BACKUP_DIR) {
    const backupDir = path.resolve(cwd, source.BACKUP_DIR);
    if (!isInside(backupDir, mountPath)) {
      warnings.push(`BACKUP_DIR ${backupDir} is outside the volume at ${mountPath}; dumps kept there do not survive a deploy.`);
    }
  }

  return { errors: [...new Set(errors)], warnings, storageRoot, mountPath };
}
