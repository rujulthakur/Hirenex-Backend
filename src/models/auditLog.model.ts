import { Schema, model, Types, InferSchemaType, CallbackWithoutResultAndOptionalError } from 'mongoose';
import { ROLES } from '../types/enums';

/**
 * auditLogs: append-only, hash-chained. hash = SHA-256(prevHash + canonicalJSON(entry without hash)).
 * Update/delete operations are rejected at the model level (hooks below). This is tamper-EVIDENT, not
 * tamper-proof: someone with raw database access can still edit rows, but verifyChain will report the seq.
 * Query patterns: list by job newest first, filter by actor/action, full ascending scan for verify and export.
 */
const auditLogSchema = new Schema(
  {
    seq: { type: Number, required: true, unique: true },
    ts: { type: Date, required: true, default: () => new Date() },
    actor: {
      type: new Schema(
        {
          id: { type: String, required: true },
          role: { type: String, enum: [...ROLES, 'system', 'candidate'], required: true },
          name: { type: String, required: true },
        },
        { _id: false },
      ),
      required: true,
    },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, required: true },
    jobId: { type: Schema.Types.ObjectId, ref: 'Job' },
    oldValue: { type: Schema.Types.Mixed },
    newValue: { type: Schema.Types.Mixed },
    payload: { type: Schema.Types.Mixed },
    prevHash: { type: String, required: true },
    hash: { type: String, required: true },
  },
  { timestamps: false, minimize: false },
);
auditLogSchema.index({ jobId: 1, seq: -1 });
auditLogSchema.index({ 'actor.id': 1, seq: -1 });
auditLogSchema.index({ action: 1, seq: -1 });
auditLogSchema.index({ ts: -1 });

const BLOCKED_QUERY_OPS = [
  'updateOne',
  'updateMany',
  'replaceOne',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
] as const;

function reject(next: CallbackWithoutResultAndOptionalError): void {
  next(new Error('auditLogs is append-only: update and delete are not allowed'));
}

auditLogSchema.pre([...BLOCKED_QUERY_OPS], function (next) {
  reject(next);
});
auditLogSchema.pre('deleteOne', { document: true, query: false }, function (next) {
  reject(next);
});
auditLogSchema.pre('save', function (next) {
  if (!this.isNew) return reject(next);
  next();
});

export type AuditLogDoc = InferSchemaType<typeof auditLogSchema> & { _id: Types.ObjectId };
export const AuditLogModel = model('AuditLog', auditLogSchema, 'auditLogs');
