import mongoose from "mongoose";
import { positionSchema } from "./positionModel.js";
import { object } from "zod";
export const STATUS_RAK = Object.freeze({
  AVAILABLE: "AVAILABLE",
  NOTAVAILABLE: "NOTAVAILABLE",
});
const rakSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    sku: {
      type: String,
      required: true,
      unique: true,
    },
    image: {
      type: String,
    },
    icon: {
      type: String,
    },
    height: {
      type: Number,
      required: false,
      default: 0,
    },
    long_size: {
      type: Number,
      required: false,
      default: 0,
    },
    discount: {
      type: Number,
      default: 0,
    },
    price_perday: {
      type: Number,
      required: true,
    },
    description: {
      type: String,
      required: false,
    },
    status: {
      type: String,
      enum: Object.values(STATUS_RAK),
      default: STATUS_RAK.AVAILABLE,
    },
    create_by: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user", // Reference to the Brand model
      required: true,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category", // Reference to the Brand model
      required: true,
    },
    type: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "rakType", // Reference to the Brand model
      required: true,
    },
    rent: {
      type: Object,
      default: null,
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

rakSchema.virtual("positions", {
  ref: "position",
  foreignField: "rak_id",
  localField: "_id",
});

const RakModel = mongoose.model("rak", rakSchema);

export { RakModel, rakSchema };
