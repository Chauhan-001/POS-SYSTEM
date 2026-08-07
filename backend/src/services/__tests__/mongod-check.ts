import { MongoMemoryServer } from 'mongodb-memory-server';

const mongod = await MongoMemoryServer.create();
console.log('URI:', mongod.getUri());
await mongod.stop();
