import assert from 'node:assert/strict';
import fs from 'node:fs';

const prismaSchema = fs.readFileSync('prisma/schema.prisma', 'utf8');
const postgresSchema = fs.readFileSync('prisma-postgres/schema.prisma', 'utf8');
const postgresMigration = fs.readFileSync('prisma-postgres/migrations/000001_init/migration.sql', 'utf8');
const service = fs.readFileSync('src/modules/auth/auth.service.js', 'utf8');
const deviceService = fs.readFileSync('src/modules/devices/devices.service.js', 'utf8');
const controller = fs.readFileSync('src/modules/auth/auth.controller.js', 'utf8');
const routes = fs.readFileSync('src/modules/auth/auth.routes.js', 'utf8');
const authSchema = fs.readFileSync('src/modules/auth/auth.schema.js', 'utf8');
const regression = fs.readFileSync('tests/backend-regression.examples.js', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));

assert.match(prismaSchema, /model Session \{/, 'Prisma Session model must exist');
assert.match(prismaSchema, /refreshTokenHash\s+String/, 'Session must store hashed refresh token');
assert.match(prismaSchema, /revokedAt\s+DateTime\?/, 'Session must support logout revocation');
assert.match(prismaSchema, /expiresAt\s+DateTime/, 'Session must expire refresh tokens');
assert.match(prismaSchema, /sessions\s+Session\[\]/, 'Shop/User should have Session relation');

assert.match(postgresSchema, /model Session \{/, 'Postgres Prisma schema must include Session');
assert.match(postgresMigration, /CREATE TABLE "Session"/, 'Postgres migration must create Session table');
assert.match(postgresMigration, /Session_userId_fkey/, 'Postgres migration must add Session user FK');
assert.match(postgresMigration, /Session_shopId_fkey/, 'Postgres migration must add Session shop FK');

assert.match(service, /crypto\.randomBytes/, 'refresh token secret should use crypto random bytes');
assert.match(service, /bcrypt\.hash\(refreshSecret/, 'refresh token secret must be bcrypt hashed before storage');
assert.match(service, /bcrypt\.compare\(parsed\.secret/, 'refresh token validation must compare hash with bcrypt');
assert.match(service, /createDeviceBoundLoginSession\(\{ user, reqMeta, sessionData \}\)/, 'login/register must delegate device-bound session creation');
assert.match(deviceService, /export async function createDeviceBoundLoginSession/, 'device lifecycle service must own device-bound session creation');
assert.match(deviceService, /const session = await tx\.session\.create/, 'device-bound login must create the refresh session inside its transaction');
assert.match(deviceService, /await writeRequiredDeviceAudit\(tx,[\s\S]*?action: "LOGIN"/, 'device-bound login must write a required login audit in the same transaction');
assert.match(deviceService, /throw new AppError\("Device change could not be audited", 503, "DEVICE_AUDIT_WRITE_FAILED"\)/, 'device audit failures must fail closed');
assert.match(service, /refreshSession/, 'refreshSession service function must exist');
assert.match(service, /db\.session\.update[\s\S]*revokedAt/, 'logout must revoke session');
assert.match(service, /getMe/, 'getMe service function must exist');
assert.match(service, /accessToken/, 'auth responses must return accessToken');
assert.match(service, /token:\s*accessToken/, 'auth responses should keep token alias for compatibility');
assert.match(service, /refreshToken/, 'auth responses must return refreshToken');

assert.match(controller, /authService\.refreshSession/, 'refresh controller must call refreshSession');
assert.match(controller, /authService\.logout/, 'logout controller must call logout');
assert.match(controller, /authService\.getMe/, '/me controller must fetch current user/shop from DB');

assert.match(routes, /router\.post\("\/refresh"/, 'POST /api/auth/refresh route must exist');
assert.match(routes, /router\.post\("\/logout"/, 'POST /api/auth/logout route must exist');
assert.match(routes, /router\.get\("\/me",\s*requireAuth/, 'GET /api/auth/me must require auth');
assert.match(authSchema, /refreshSchema/, 'refresh request schema must exist');
assert.match(authSchema, /logoutSchema/, 'logout request schema must exist');

assert.match(regression, /tx\.session\.deleteMany/, 'regression cleanup must delete sessions before users/shops');
assert.match(packageJson.scripts['test:billing'], /auth-session\.examples\.js/, 'test chain must include auth-session examples');

console.log('Auth session examples passed');
