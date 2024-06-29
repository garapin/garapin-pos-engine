import mongoose from 'mongoose';

const configTransactionSchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
    },
    fee_flat: {
      type: Number,
      default: null
    },
    fee_percent: {
      type: Number,
      default: null
    },
    vat_percent: {
      type: Number,
      default: null
    },
});

const ConfigTransactionModel = mongoose.model('config_transaction', configTransactionSchema);

export { ConfigTransactionModel, configTransactionSchema };