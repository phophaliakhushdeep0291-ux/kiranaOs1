import assert from "node:assert/strict";
import { assessStorageVolume } from "../src/lib/storageVolume.js";

const cwd = "/app";
const railway = { RAILWAY_PROJECT_ID: "project", NODE_ENV: "production" };
const assess = (source) => assessStorageVolume({ source, cwd });

// The production configuration: API volume on a PostgreSQL data path, local storage in /app.
const current = assess({ ...railway, STORAGE_PROVIDER: "local", RAILWAY_VOLUME_MOUNT_PATH: "/var/lib/postgresql/data" });
assert.equal(current.errors.length, 2, JSON.stringify(current));
assert.match(current.errors[0], /PostgreSQL data path.*Mount this service's volume at \/app\/storage/);
assert.match(current.errors[1], /writes to \/app\/storage, outside the volume at \/var\/lib\/postgresql\/data/);

// The documented fix clears it, with BACKUP_DIR kept on the volume.
const fixed = assess({ ...railway, RAILWAY_VOLUME_MOUNT_PATH: "/app/storage", BACKUP_DIR: "/app/storage/database-backups" });
assert.deepEqual(fixed.errors, []);
assert.deepEqual(fixed.warnings, []);
// A relative BACKUP_DIR resolves against the app directory, the way the worker writes it.
assert.deepEqual(assess({ ...railway, RAILWAY_VOLUME_MOUNT_PATH: "/app/storage", BACKUP_DIR: "./storage/db" }).warnings, []);
// Mounting a parent also covers it.
assert.deepEqual(assess({ ...railway, RAILWAY_VOLUME_MOUNT_PATH: "/app" }).errors, []);
// A sibling path that merely shares a prefix does not.
assert.equal(assess({ ...railway, RAILWAY_VOLUME_MOUNT_PATH: "/app/storage-old" }).errors.length, 1);

// No volume at all: local files are on the container disk.
const noVolume = assess({ ...railway, STORAGE_PROVIDER: "local" });
assert.equal(noVolume.errors.length, 1);
assert.match(noVolume.errors[0], /container disk.*or use s3\/r2/);

// The default /app/backups is outside a /app/storage volume.
const backupOutside = assess({ ...railway, RAILWAY_VOLUME_MOUNT_PATH: "/app/storage", BACKUP_DIR: "./backups" });
assert.deepEqual(backupOutside.errors, []);
assert.match(backupOutside.warnings[0], /BACKUP_DIR \/app\/backups is outside the volume/);

// Object storage does not need a volume, and a stray mount is only a warning.
assert.deepEqual(assess({ ...railway, STORAGE_PROVIDER: "r2" }), { errors: [], warnings: [], storageRoot: "/app/storage", mountPath: null });
const r2WithStrayMount = assess({ ...railway, STORAGE_PROVIDER: "r2", RAILWAY_VOLUME_MOUNT_PATH: "/var/lib/postgresql/data" });
assert.deepEqual(r2WithStrayMount.errors, []);
assert.match(r2WithStrayMount.warnings[0], /PostgreSQL data path/);

// Off Railway nothing reports a mount path, so nothing is asserted; development stays quiet.
assert.deepEqual(assess({ NODE_ENV: "production", STORAGE_PROVIDER: "local" }).errors, []);
assert.deepEqual(assess({ RAILWAY_PROJECT_ID: "project", NODE_ENV: "development" }).errors, []);

console.log("storage volume mount examples passed");
