export interface MessageBus {
  publish(channel: string, event: object): Promise<void>;
}
