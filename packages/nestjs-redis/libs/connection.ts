import { setTimeout as delay } from 'node:timers/promises';
import { createClient, type RedisClientType } from '@redis/client';
import { OperationGuard, RedisOperationError } from './operation-guard';
import { type RedisOptions, validateOptions } from './redis-options';

export interface RedisConnection {
  readonly client: RedisClientType;
  readonly guard: OperationGuard;
  readonly options: RedisOptions;
  readonly initialized: boolean;
  connect(): Promise<void>;
}

/** Allocates an owned SDK client; sockets open only in the shared startup phase. */
export function createConnection(input: RedisOptions): RedisConnection {
  const options = validateOptions(input);
  const cancellation = new AbortController();
  const retry = options.reconnect;
  const socket = {
    host: options.host,
    port: options.port,
    signal: cancellation.signal,
    connectTimeout: options.connectTimeoutMs ?? 5_000,
    reconnectStrategy: false as const,
  };
  let client: RedisClientType;
  try {
    client = createClient({
      url: options.url,
      username: options.username,
      password: options.password,
      database: options.database,
      disableOfflineQueue: true,
      socket:
        options.url?.startsWith('rediss:') || options.tls
          ? { ...socket, ...options.tls, tls: true, rejectUnauthorized: true }
          : { ...socket, tls: false },
    });
  } catch {
    throw new RedisOperationError();
  }
  const guard = new OperationGuard(() => {
    // The SDK only retains a socket after connect/secureConnect. Node's signal
    // also cancels the socket while that initial handshake is still pending.
    cancellation.abort();
    client.destroy();
  });
  client.on('error', () => {}); // Consume SDK errors; never log provider payloads.
  let initialized = false;
  return {
    client,
    guard,
    options,
    get initialized() {
      return initialized;
    },
    async connect(): Promise<void> {
      try {
        await guard.run(async () => {
          for (let attempt = 0; ; attempt++) {
            guard.assertOpen();
            try {
              await client.connect();
              return;
            } catch {
              guard.assertOpen();
              if (!retry || attempt >= retry.attempts)
                throw new RedisOperationError();
              // Own the wait so shutdown and the total startup deadline cancel
              // it, including while the SDK has no socket to destroy.
              await delay(retry.delayMs, undefined, {
                signal: cancellation.signal,
              });
            }
          }
        }, options.connectTimeoutMs ?? 5_000);
        initialized = true;
      } catch {
        guard.close();
        throw new RedisOperationError();
      }
    },
  };
}
