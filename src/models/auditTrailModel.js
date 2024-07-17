import mongoose from 'mongoose';

const auditTrailSchema = new mongoose.Schema({
  store_name: {
    type: String,
    required: true,
  },
  transactionId: {
    type: String,
    required: true,
  },
  source_user_id: {
    type: String,
    required: true,
  },
  destination_user_id: {
    type: String,
    required: true,
  },
  status: {
    type: String,
    enum: ['SUCCESS', 'FAILED', 'ERROR'],
    required: true,
  },
  code: {
    type: String,
    required: false,
  },
  message: {
    type: String,
    required: true,
  },
  executionTime: {
    type: Number,
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
});

const AuditTrailModel = mongoose.model('audit_trail', auditTrailSchema);

export { AuditTrailModel, auditTrailSchema };