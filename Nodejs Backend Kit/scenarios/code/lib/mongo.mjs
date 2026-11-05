// Runs fn(db) against a throwaway mongod (mongodb-memory-server), then always stops it.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongoClient } from 'mongodb';

export async function withMongo(fn) {
  const server = await MongoMemoryServer.create({ binary: { version: '8.2.6' } });
  const client = await MongoClient.connect(server.getUri());
  try {
    return await fn(client.db('lab'));
  } finally {
    await client.close();
    await server.stop();
  }
}
