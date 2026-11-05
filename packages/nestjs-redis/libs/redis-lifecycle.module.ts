import {
  Module,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { RedisConnection } from './connection';

/** A Nest-context-local transaction shared by both package entries. */
export class RedisConnections implements OnModuleInit, OnModuleDestroy {
  private readonly connections: RedisConnection[] = [];

  register(connection: RedisConnection): void {
    this.connections.push(connection);
  }

  async onModuleInit(): Promise<void> {
    try {
      for (const connection of this.connections) await connection.connect();
    } catch (error) {
      this.onModuleDestroy();
      throw error;
    }
  }

  onModuleDestroy(): void {
    for (const connection of this.connections) connection.guard.close();
  }
}

export class RedisLifecycleModule {}
Module({ providers: [RedisConnections], exports: [RedisConnections] })(
  RedisLifecycleModule,
);
