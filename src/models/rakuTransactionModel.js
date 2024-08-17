import mongoose from "mongoose";
import { object } from "zod";

export const STATUS_RAK = Object.freeze({
  READY: "READY",
  DISPOSED: "DISPOSED",
});

export const PAYMENT_STATUS_RAK = Object.freeze({
  UNPAID: "UNPAID",
  PENDING: "PENDING",
  PAID: "PAID",
  SETTLED: "SETTLED",
  EXPIRED: "EXPIRED",
  ACTIVE: "ACTIVE",
  STOPPED: "STOPPED",
});

const rakuTransactionSchema = new mongoose.Schema(
  {
    db_user: {
      type: String,
    },
    list_rak: [
      {
        rak: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "rak",
          required: true,
        },
        position: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "position",
          required: true,
        },
        start_date: {
          type: Date,
          required: true,
        },
        end_date: {
          type: Date,
          required: true,
        },
      },
    ],
    total_harga: {
      type: Number,
      required: true,
      default: 0,
    },
    id_split_rule: {
      type: String,
      default: null,
    },
    invoice: {
      type: String,
      required: false,
    },
    invoice_label: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      enum: Object.values(STATUS_RAK),
      default: STATUS_RAK.READY,
    },
    payment_status: {
      type: String,
      enum: Object.values(PAYMENT_STATUS_RAK),
      default: PAYMENT_STATUS_RAK.UNPAID,
    },
    payment_method: {
      type: String,
      default: "",
    },
    payment_channel: {
      type: String,
      default: "",
    },
    payment_date: {
      type: Date,
      default: "",
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
      default: 0,
    },
    fee_bank: {
      type: Number,
      default: 0,
    },
    vat: {
      type: Number,
      default: 0,
    },
    xendit_info: {
      invoiceUrl: {
        type: String,
        default: "",
      },
      expiryDate: {
        type: String,
        default: "",
      },
    },
  },
  {
    toJSON: {
      virtuals: true,
    },
    toObject: {
      virtuals: true,
    },
    timestamps: true,
    id: true,
  }
);

const RakTransactionModel = mongoose.model(
  "rakTransaction",
  rakuTransactionSchema
);

export { RakTransactionModel, rakuTransactionSchema };
