import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { ApiError } from '../http/apiError.js';
import type { Pool } from 'pg';
import { verifyPostgresDeviceCredential } from '../repositories/postgresCredentials.repository.js';
import { postgresConfig } from '../runtime/postgres.js';

let credentialPool: Pool | null = null;
const authenticatedRequests = new WeakMap<FastifyRequest, string>();

export function setDeviceCredentialPool(pool: Pool | null): void { credentialPool = pool; }
export function deviceCredentialBackend(): 'json' | 'postgres' {
  return process.env.DEVICE_AUTH_BACKEND === 'postgres' ? 'postgres' : 'json';
}

/** The provisioned model is authoritative; a device registration is telemetry, not provisioning. */
export async function getProvisionedDeviceModel(deviceId: string): Promise<string | null> {
  if (deviceCredentialBackend() !== 'postgres') return null;
  if (!credentialPool) throw new Error('PostgreSQL device authentication is not initialized');
  const result = await credentialPool.query<{ model: string }>(
    'SELECT model FROM dongxin.devices WHERE id = $1', [deviceId],
  );
  const model = result.rows[0]?.model;
  if (!model) throw new Error('Authenticated device has no provisioned model');
  return model;
}

function required(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.DEVICE_AUTH_MODE === 'required' || deviceCredentialBackend() === 'postgres';
}
function credentials(): Record<string, string> {
  const raw = process.env.DEVICE_HTTP_CREDENTIALS;
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).some((key) => !key.trim()) || Object.values(parsed).some((value) => typeof value !== 'string' || value.length < 20)) {
    throw new Error('DEVICE_HTTP_CREDENTIALS must map device IDs to independent 20+ character secrets');
  }
  if (new Set(Object.values(parsed)).size !== Object.keys(parsed).length) throw new Error('Each device must use an independent HTTP secret');
  return parsed as Record<string, string>;
}

export function assertDeviceAuthConfiguration(): void {
  if (process.env.DEVICE_AUTH_BACKEND && !['json', 'postgres'].includes(process.env.DEVICE_AUTH_BACKEND)) {
    throw new Error('DEVICE_AUTH_BACKEND must be json or postgres');
  }
  if (deviceCredentialBackend() === 'postgres') {
    postgresConfig();
    return;
  }
  const count = Object.keys(credentials()).length;
  if (required() && !count) throw new Error('Device HTTP authentication requires DEVICE_HTTP_CREDENTIALS');
  if (process.env.NODE_ENV === 'production' && count > 20) {
    throw new Error('JSON-backed hardware pilot is limited to 20 provisioned devices; production storage is not implemented');
  }
}

/** Independent per-device bearer credentials, only over HTTPS in production. */
export async function authenticateDeviceRequest(request: FastifyRequest): Promise<void> {
  if (!required()) return;
  const deviceId = request.headers['x-device-id'];
  const authorization = request.headers.authorization;
  const actual = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (typeof deviceId !== 'string' || !actual) throw new ApiError(401, 'DEVICE_UNAUTHORIZED', '设备认证失败');
  if (authenticatedRequests.get(request) !== deviceId) {
    if (deviceCredentialBackend() === 'postgres') {
      if (!credentialPool) throw new Error('PostgreSQL device authentication is not initialized');
      if (!await verifyPostgresDeviceCredential(credentialPool, deviceId, actual)) {
        throw new ApiError(401, 'DEVICE_UNAUTHORIZED', '设备认证失败');
      }
    } else {
      const configured = credentials();
      const secret = Object.hasOwn(configured, deviceId) ? configured[deviceId] : undefined;
      if (!secret || !timingSafeEqual(createHash('sha256').update(actual).digest(), createHash('sha256').update(secret).digest())) {
        throw new ApiError(401, 'DEVICE_UNAUTHORIZED', '设备认证失败');
      }
    }
    authenticatedRequests.set(request, deviceId);
  }
  // A credential cannot select another device through query/body, including registration.
  for (const source of [request.body, request.query]) {
    if (source && typeof source === 'object' && 'deviceId' in source && source.deviceId !== deviceId) {
      throw new ApiError(403, 'DEVICE_ID_MISMATCH', '设备身份与请求不一致');
    }
  }
}
