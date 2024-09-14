import mongoose from "mongoose";
import { stockHistorySchema } from "./stockHistoryModel.js";
import { connectTargetDatabase } from "../config/targetDatabase.js";

const productSchema = new mongoose.Schema(
  {
    inventory_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    supplier_id: {
      type: mongoose.Schema.Types.ObjectId,
      required: false,
    },
    rak_id: [
      {
        type: mongoose.Schema.Types.ObjectId,
        required: false,
      },
    ],
    position_id: [
      {
        type: mongoose.Schema.Types.ObjectId,
        required: false,
      },
    ],
    name: {
      type: String,
      required: true,
    },
    sku: {
      type: String,
      required: true,
    },
    image: {
      type: String,
    },
    icon: {
      type: String,
    },
    discount: {
      type: Number,
      default: 0,
    },
    price: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      default: "ACTIVE",
    },
    brand_ref: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Brand", // Reference to the Brand model
      required: true,
    },
    category_ref: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category", // Reference to the Brand model
      required: true,
    },
    unit_ref: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Unit", // Reference to the Brand model
      required: true,
    },
    expired_date: {
      type: Date,
      default: "",
    },
    stock: {
      type: Number,
      default: 0,
    },
    minimum_stock: {
      type: Number,
      default: 0,
    },
    length: {
      type: Number,
      default: 0,
    },
    width: {
      type: Number,
      default: 0,
    },
    db_user: {
      type: String,
      default: "",
    },
  },
  { timestamps: true }
);

productSchema.methods.addStock = async function (
  quantity,
  targetDatabase,
  description = ""
) {
  // Pastikan kedua nilai adalah angka
  const currentStock = Number(this.stock);
  const addedQuantity = Number(quantity);

  // Lakukan penambahan
  this.stock = currentStock + addedQuantity;

  await this.save();

  const storeModel = await connectTargetDatabase(targetDatabase);
  const StockHistoryModel = storeModel.model(
    "StockHistory",
    stockHistorySchema
  );
  // Save stock history
  await StockHistoryModel.create({
    product: this._id,
    quantity,
    changeType: "ADD",
    description: description,
  });

  return this;
};

productSchema.methods.subtractStock = async function (
  quantity,
  targetDatabase,
  description = ""
) {
  if (this.stock - quantity < this.minimum_stock) {
    console.log("Insufficient stock");
    // throw new Error("Insufficient stock");
  }
  this.stock -= quantity;
  await this.save();

  const storeModel = await connectTargetDatabase(targetDatabase);
  const StockHistoryModel = storeModel.model(
    "StockHistory",
    stockHistorySchema
  );

  // Save stock history
  await StockHistoryModel.create({
    product: this._id,
    quantity,
    changeType: "SUBTRACT",
    description: description,
  });

  return this;
};

productSchema.methods.checkStock = function () {
  return this.stock;
};

const ProductModel = mongoose.model("Product", productSchema);

export { ProductModel, productSchema };
