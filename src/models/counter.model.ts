import { Schema, model } from 'mongoose';

/** counters: atomic $inc sequence generator. The audit chain uses _id 'auditLogs'. */
const counterSchema = new Schema({
  _id: { type: String, required: true },
  seq: { type: Number, required: true, default: 0 },
});

export const CounterModel = model('Counter', counterSchema, 'counters');
