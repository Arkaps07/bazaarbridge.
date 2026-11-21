import fs from 'fs';
import { Kafka, logLevel, type Producer, type Consumer } from 'kafkajs';
import { envConfig } from '../config/env';
import { CORE_TOPIC, FULFILMENT_TOPIC, partitionForKey, topicForEventType } from '../utils/stateMachines';

export interface OutboxRecord {
  event_id: string;
  event_type: string;
  aggregate_key: string;
  payload: Record<string, unknown>;
  created_at: string;
  published_at: string | null;
  topic?: string;
  partition?: number;
}

let kafkaInstance: Kafka | null = null;
let producerInstance: Producer | null = null;

export function createKafkaClient(): Kafka | null {
  if (!envConfig.isKafkaConfigured) return null;
  if (kafkaInstance) return kafkaInstance;

  const ssl: Record<string, unknown> = { rejectUnauthorized: true };
  if (envConfig.kafkaCaPath && fs.existsSync(envConfig.kafkaCaPath)) {
    ssl.ca = [fs.readFileSync(envConfig.kafkaCaPath, 'utf8')];
  } else {
    ssl.rejectUnauthorized = false;
  }

  if (
    envConfig.kafkaSecurityProtocol === 'SSL' &&
    envConfig.kafkaServiceCertPath &&
    envConfig.kafkaServiceKeyPath &&
    fs.existsSync(envConfig.kafkaServiceCertPath) &&
    fs.existsSync(envConfig.kafkaServiceKeyPath)
  ) {
    ssl.cert = fs.readFileSync(envConfig.kafkaServiceCertPath, 'utf8');
    ssl.key = fs.readFileSync(envConfig.kafkaServiceKeyPath, 'utf8');
  }

  const sasl =
    envConfig.kafkaSecurityProtocol === 'SASL_SSL' && envConfig.kafkaSaslUsername
      ? {
          mechanism: envConfig.kafkaSaslMechanism.toLowerCase() as 'scram-sha-256' | 'scram-sha-512' | 'plain',
          username: envConfig.kafkaSaslUsername,
          password: process.env.KAFKA_SASL_PASSWORD || '',
        }
      : undefined;

  kafkaInstance = new Kafka({
    clientId: 'bazaarbridge-backend',
    brokers: envConfig.kafkaBrokers,
    ssl,
    sasl: sasl as never,
    logLevel: logLevel.WARN,
  });

  return kafkaInstance;
}

export async function getKafkaProducer(): Promise<Producer | null> {
  const kafka = createKafkaClient();
  if (!kafka) return null;
  if (!producerInstance) {
    producerInstance = kafka.producer({ allowAutoTopicCreation: false });
    await producerInstance.connect();
  }
  return producerInstance;
}

export async function publishToAivenKafka(event: OutboxRecord): Promise<{ topic: string; partition: number }> {
  const topic = topicForEventType(event.event_type);
  const partition = partitionForKey(event.aggregate_key);
  const producer = await getKafkaProducer();
  if (!producer) {
    return { topic, partition };
  }

  await producer.send({
    topic,
    messages: [
      {
        key: event.aggregate_key,
        partition,
        value: JSON.stringify({
          event_id: event.event_id,
          event_type: event.event_type,
          aggregate_key: event.aggregate_key,
          payload: event.payload,
          created_at: event.created_at,
        }),
      },
    ],
  });

  return { topic, partition };
}

export async function startAivenKafkaConsumer(
  groupId: string,
  topics: string[],
  handler: (event: OutboxRecord) => Promise<void>
): Promise<Consumer | null> {
  const kafka = createKafkaClient();
  if (!kafka) return null;

  const consumer = kafka.consumer({ groupId });
  await consumer.connect();
  for (const topic of topics) {
    await consumer.subscribe({ topic, fromBeginning: false });
  }
  await consumer.run({
    eachMessage: async ({ message }) => {
      if (!message.value) return;
      const parsed = JSON.parse(message.value.toString('utf8')) as OutboxRecord;
      await handler(parsed);
    },
  });
  return consumer;
}

export { CORE_TOPIC, FULFILMENT_TOPIC };
