import mongoose from "mongoose";

// // Define the schema for disbursement
// const withdrawSchema = new mongoose.Schema({
//   id: {
//     type: String,
//     required: true,
//     unique: true // Ensures that 'id' is unique in the collection
//   },
//   reference_id: {
//     type: String,
//     required: true
//   },
//   channel_code: {
//     type: String,
//     required: true
//   },
//   currency: {
//     type: String,
//     required: true
//   },
//   user_id: {
//     type: String,
//     required: true
//   },
//   bank_code: {
//     type: String,
//     required: true
//   },
//   account_holder_name: {
//     type: String,
//     required: true
//   },
//   amount: {
//     type: Number,
//     required: true,
//     min: 0 // Ensures the amount is not negative
//   },
//   description: {
//     type: String,
//     default: '' // Optional, but provides a default value
//   },
//   status: {
//     type: String,
//     enum: ['PENDING', 'COMPLETED', 'FAILED'], // Only allows specific status values
//     default: 'PENDING' // Default status is 'PENDING'
//   },
//   email_to: {
//     type: [String], // An array of email addresses
//     validate: {
//       validator: (v) => Array.isArray(v), // Ensures it is an array
//       message: 'email_to must be an array of email addresses'
//     }
//   },
//   email_cc: {
//     type: [String],
//     validate: {
//       validator: (v) => Array.isArray(v),
//       message: 'email_cc must be an array of email addresses'
//     }
//   },
//   email_bcc: {
//     type: [String],
//     validate: {
//       validator: (v) => Array.isArray(v),
//       message: 'email_bcc must be an array of email addresses'
//     }
//   },

//   webhook: {
//     type: Object,
//     default: null,
//   },
// }, { timestamps: true });

const withdrawSchema = new mongoose.Schema(
  {
    id: {
      type: String,
      required: true,
      unique: true, // Ensures that 'id' is unique in the collection
    },
    amount: {
      type: Number,
      required: true,
      min: 0, // Ensures the amount is not negative
    },
    fee_bank: {
      type: Number,
      required: false,
      min: 0, // Ensures the amount is not negative
    },
    channel_code: {
      type: String,
      required: true,
    },
    payment_method: {
      type: String,
      required: false,
    },
    currency: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      default: "", // Optional, but provides a default value
    },
    reference_id: {
      type: String,
      required: true,
      unique: true, // Ensures that 'reference_id' is unique
    },
    status: {
      type: String,
      enum: ["SUCCEEDED", "ACCEPTED", "FAILED", "EXPIRED", "REFUNDED"], // Restricted status options
      default: "SUCCEEDED", // Default to 'PENDING'
    },
    created: {
      type: Date,
      required: true,
    },
    updated: {
      type: Date,
      required: true,
    },
    estimated_arrival_time: {
      type: Date,
      required: false, // Optional property
    },
    business_id: {
      type: String,
      required: true,
    },
    channel_properties: {
      type: mongoose.Schema.Types.Mixed, // Allows various data types
      required: true,
    },
    receipt_notification: {
      type: mongoose.Schema.Types.Mixed, // Could be more complex
      default: null,
    },
    webhook: {
      type: Object,
      default: null,
    },
  },
  { timestamps: true }
); // Adds 'createdAt' and 'updatedAt' automatically

const WithdrawModel = mongoose.model("Disbursement", withdrawSchema);

export { WithdrawModel, withdrawSchema };
