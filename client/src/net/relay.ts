import mqtt from 'mqtt';
import type { Relay } from '../host/host.ts';

/**
 * The public message relay players' browsers meet on (a free MQTT broker).
 * It only passes messages along; it runs none of the game and keeps no accounts.
 */
const BROKER_URL = 'wss://broker.hivemq.com:8884/mqtt';

export interface LiveRelay extends Relay {
  end(): void;
}

export function createRelay(handlers: { onMessage: (topic: string, payload: string) => void; onStatus: (online: boolean) => void }): LiveRelay {
  const filters = new Set<string>();
  const client = mqtt.connect(BROKER_URL, {
    clientId: 'll_' + Math.random().toString(16).slice(2, 14),
    clean: true,
    keepalive: 30,
    reconnectPeriod: 4000,
    connectTimeout: 10_000,
  });

  client.on('connect', () => {
    for (const f of filters) client.subscribe(f);
    handlers.onStatus(true);
  });
  client.on('close', () => handlers.onStatus(false));
  client.on('error', () => {
    // mqtt.js retries by itself; the status banner already says we are offline.
  });
  client.on('message', (topic, payload) => handlers.onMessage(topic, payload.toString()));

  return {
    publish(topic, payload, retain) {
      if (client.connected) client.publish(topic, payload, { qos: 0, retain: !!retain });
    },
    subscribe(filter) {
      filters.add(filter);
      if (client.connected) client.subscribe(filter);
    },
    unsubscribe(filter) {
      filters.delete(filter);
      if (client.connected) client.unsubscribe(filter);
    },
    end() {
      client.end(true);
    },
  };
}
