import KeyvRedis from '@keyv/redis';
import type { RedisClientType } from '@redis/client';
import type { RedisConnection } from './connection';
import { RedisOperationError } from './operation-guard';

/** Retain SDK serialization/commands, but never let lazy adapter access reopen an owned socket. */
export class OwnedRedisStore extends KeyvRedis<string> {
  constructor(private readonly connection: RedisConnection) {
    super(connection.client, {
      namespace: `en:${connection.options.namespace}:cache`,
      keyPrefixSeparator: ':',
      throwOnConnectError: true,
      throwOnErrors: true,
      noNamespaceAffectsAll: false,
    });
    this.on('error', () => {
      if (connection.initialized) connection.guard.close();
    });
  }

  override async getClient(): Promise<RedisClientType> {
    if (!this.connection.client.isOpen) this.connection.guard.close();
    this.connection.guard.assertOpen();
    return this.connection.client;
  }

  override async clear(): Promise<void> {
    try {
      const client = await this.getClient();
      for await (const keys of client.scanIterator({
        MATCH: this.createKeyPrefix('*', this.namespace),
        COUNT: this.clearBatchSize,
        TYPE: 'string',
      })) {
        this.connection.guard.assertOpen();
        // Observe each deletion before requesting another batch. The inherited
        // clear accumulates unobserved promises until every SCAN has completed.
        for (
          let offset = 0;
          offset < keys.length;
          offset += this.clearBatchSize
        ) {
          this.connection.guard.assertOpen();
          await client.unlink(keys.slice(offset, offset + this.clearBatchSize));
        }
        this.connection.guard.assertOpen();
      }
    } catch {
      this.connection.guard.close();
      throw new RedisOperationError();
    }
  }
}
