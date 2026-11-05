export class RedisOperationError extends Error {
  constructor() {
    super('Redis operation failed');
    this.name = 'RedisOperationError';
  }
}

export class OperationGuard {
  private closed = false;
  private readonly pending = new Set<() => void>();

  private readonly destroy: () => void;

  constructor(destroy: () => void) {
    this.destroy = destroy;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const reject of this.pending) reject();
    this.pending.clear();
    try {
      this.destroy();
    } catch {
      /* Cleanup must never expose SDK errors. */
    }
  }

  assertOpen(): void {
    if (this.closed) throw new RedisOperationError();
  }

  async run<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> {
    this.assertOpen();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: (() => void) | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        cancel = () => reject(new RedisOperationError());
        this.pending.add(cancel);
        timer = setTimeout(() => {
          this.close();
          reject(new RedisOperationError());
        }, timeoutMs);
      });
      const result = await Promise.race([
        Promise.resolve().then(() => {
          this.assertOpen();
          return operation();
        }),
        timeout,
      ]);
      this.assertOpen();
      return result;
    } catch {
      throw new RedisOperationError();
    } finally {
      clearTimeout(timer);
      if (cancel) this.pending.delete(cancel);
    }
  }
}
