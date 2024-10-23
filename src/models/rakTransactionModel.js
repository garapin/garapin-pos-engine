import mongoose from "mongoose";
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

// # Unpaid
// Tautan pembayaran sudah berhasil dibuat dan dapat dibayarkan oleh Pelanggan Anda sampai tanggal kedaluwarsa yang Anda tentukan

// # PAID
// Tautan pembayaran sudah berhasil dibayarkan oleh pelanggan Anda Anda juga bisa mendapatkan pemberitahuan tautan pembayaran yang sudah terbayar melalui email dengan mengaktifkan notifikasi email di Pengaturan Kustomisasi Invoice

// # Settled
// Dana sudah berhasil diteruskan ke akun Xendit Anda dan dapat ditarik melalui tab Saldo Mohon dicatat bahwa tidak semua tautan pembayaran akan mencapai status ini (contoh: BCA Switcher) dan tidak semuanya akan mencapai status ini secara bersamaan. Waktu penerusan dana bergantung pada metode pembayaran yang digunakan oleh pelanggan Anda

// # EXPIRED
// Tautan pembayaran telah kedaluwarsa sebelum pelanggan Anda berhasil melakukan pembayaran. Tautan pembayaran tidak dapat lagi dibayarkan atau direaktivasi Anda dapat menyesuaikan waktu kedaluwarsa semua tautan pembayaran Anda di Pengaturan Kustomisasi Invoice, atau atur durasi setiap tautan pembayaran pada saat pembuatan tautan pembayaran

// # ACTIVE
// Untuk pembayaran berulang dan tautan pembayaran ganda agar terus dikirimkan kepada pelanggan Anda untuk dibayarkan pada jeda dan durasi yang Anda tentukan

// # STOPPED
// Untuk pembayaran berulang dan tautan pembayaran ganda yang tidak lagi bisa dibuat ulang atau dikirimkan ke pelanggan Anda

const rakTransactionSchema = new mongoose.Schema(
  {
    db_user: {
      type: String,
    },
    list_rak: [
      {
        rak: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "rak", // Reference to the Brand model
          required: true,
        },
        position: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "position", // Reference to the Brand model
          required: true,
        },
        // number_of_days: {
        //   type: Number,
        //   required: true,
        // },
        start_date: {
          type: Date,
          required: true,
        },
        end_date: {
          type: Date,
          required: true,
        },
        // rak_detail: {
        //   rak_name: {
        //     type: String,
        //     required: true,
        //   },
        //   price_perday: {
        //     type: String,
        //     required: true,
        //   },
        //   category_name: {
        //     type: String,
        //     required: true,
        //   },
        //   type_name: {
        //     type: String,
        //     required: true,
        //   },
        // },
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

    settlement_status: {
      type: String,
      default: "NOT_SETTLED",
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
  rakTransactionSchema
);

export { RakTransactionModel, rakTransactionSchema };
