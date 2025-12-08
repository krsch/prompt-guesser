/* eslint-disable functional/immutable-data */
/* eslint-disable functional/prefer-readonly-type */
import type { DurableObjectState, DurableObjectStorage } from "@cloudflare/workers-types";

export class FakeDurableObjectStorage {
  readonly #data = new Map<string, unknown>();
  readonly alarms: number[] = [];

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.#data.get(key);
    return value === undefined ? undefined : (structuredClone(value) as T);
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.#data.set(key, structuredClone(value));
  }

  async delete(key: string): Promise<void> {
    this.#data.delete(key);
  }

  async setAlarm(scheduledTime: number): Promise<void> {
    this.alarms.push(scheduledTime);
  }

  // Unused storage methods from the Durable Object interface
  // are omitted for brevity in tests.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [Symbol.asyncIterator](): AsyncIterator<any> {
    throw new Error("Not implemented");
  }

  list(): Promise<never> {
    throw new Error("Not implemented");
  }

  getAlarm(): Promise<never> {
    throw new Error("Not implemented");
  }

  transaction<T>(closure: (txn: DurableObjectStorage) => Promise<T>): Promise<T> {
    return closure(this as unknown as DurableObjectStorage);
  }
}

export function createFakeDurableObjectState(
  storage: FakeDurableObjectStorage = new FakeDurableObjectStorage(),
): DurableObjectState {
  return { storage: storage as unknown as DurableObjectStorage } as DurableObjectState;
}
