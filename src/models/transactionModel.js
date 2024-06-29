import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema(
  {
    product: {
      type: Object,
      required: false,
    },
    id_split_rule: {
      type: String,
      default: null,
    },
    invoice: {
      type: String,
      required: true
    },
    invoice_label: {
      type: String,
      required: true
    },
    status: {
      type: String,
      required: true
    },
    payment_method: {
      type: String,
      default: null
    },
    payment_date: {
      type: Date,
      default: null
    },
    webhook: {
      type: Object,
      default: null,
    },
    fee_garapin: {
      type: Number,
      default: 0,
    },
    total_with_fee: {
      type: Number,
      default: 0
    },
    fee_bank: {
      type: Number,
      default: 0
    },
    vat: {
      type: Number,
      default: 0
    }

  },
  { timestamps: true }
);

const TransactionModel = mongoose.model('Transaction', transactionSchema);

export { TransactionModel, transactionSchema };
