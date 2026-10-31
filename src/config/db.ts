import mongoose from 'mongoose';
import { env } from './env';
import { logger } from '../utils/logger';

mongoose.set('strictQuery', true);

export async function connectMongo(): Promise<void> {
  mongoose.connection.on('error', (err: Error) => {
    logger.error('mongo error', { message: err.message });
  });
  mongoose.connection.on('disconnected', () => logger.warn('mongo disconnected'));
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000, maxPoolSize: 10 });
  logger.info('mongo connected');
  // The old duplicate index was (jobId, textHash): it blocked the same resume from a second account.
  // Drop it once; the new (jobId, uploadedBy, textHash) index is created by the model. Missing index is fine.
  try {
    await mongoose.connection.collection('candidates').dropIndex('jobId_1_textHash_1');
    logger.info('dropped legacy candidates index jobId_1_textHash_1');
  } catch {
    /* index already gone or collection not created yet */
  }
}

export function isMongoConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function closeMongo(): Promise<void> {
  await mongoose.disconnect();
}
