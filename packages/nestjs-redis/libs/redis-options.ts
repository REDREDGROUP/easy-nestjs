import type { ConnectionOptions } from 'node:tls';

export interface RedisOptions {
  url?: string;
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  database?: number;
  tls?: false | Pick<ConnectionOptions, 'ca' | 'cert' | 'key' | 'servername'>;
  namespace: string;
  defaultTtlMs?: number;
  connectTimeoutMs?: number;
  commandTimeoutMs?: number;
  /** Additional startup attempts only; delayMs waits share the total connection
   * deadline and are cancelled on close. No reconnect after initial success. */
  reconnect?: false | { attempts: number; delayMs: number };
}

function invalid(): never {
  throw new Error('Invalid Redis options');
}

export function validateOptions(options: RedisOptions): RedisOptions {
  if (
    !options ||
    typeof options.namespace !== 'string' ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(options.namespace)
  )
    invalid();
  for (const value of [options.connectTimeoutMs, options.commandTimeoutMs]) {
    if (
      value !== undefined &&
      (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647)
    )
      invalid();
  }
  for (const value of [options.defaultTtlMs, options.database]) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0))
      invalid();
  }
  if (
    options.port !== undefined &&
    (!Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535)
  )
    invalid();
  if (
    options.reconnect &&
    (!Number.isSafeInteger(options.reconnect.attempts) ||
      options.reconnect.attempts < 0 ||
      !Number.isSafeInteger(options.reconnect.delayMs) ||
      options.reconnect.delayMs < 1 ||
      options.reconnect.delayMs > 2_147_483_647)
  )
    invalid();
  if (
    options.tls &&
    Object.keys(options.tls).some(
      (key) => !['ca', 'cert', 'key', 'servername'].includes(key),
    )
  )
    invalid();
  if (options.url !== undefined) {
    if (
      options.host !== undefined ||
      options.port !== undefined ||
      options.username !== undefined ||
      options.password !== undefined ||
      options.database !== undefined
    )
      invalid();
    let url: URL;
    try {
      url = new URL(options.url);
    } catch {
      return invalid();
    }
    if (
      !['redis:', 'rediss:'].includes(url.protocol) ||
      !url.hostname ||
      url.search ||
      url.hash ||
      !/^\/(?:\d+)?$/.test(url.pathname || '/') ||
      (url.protocol === 'rediss:' && options.tls === false) ||
      (url.protocol === 'redis:' && options.tls)
    )
      invalid();
    if (
      url.pathname.length > 1 &&
      !Number.isSafeInteger(Number(url.pathname.slice(1)))
    )
      invalid();
  } else if (
    typeof options.host !== 'string' ||
    !options.host.trim() ||
    /[\s/@]/.test(options.host)
  )
    invalid();
  return {
    ...options,
    tls: options.tls ? { ...options.tls } : options.tls,
    reconnect: options.reconnect ? { ...options.reconnect } : false,
  };
}
