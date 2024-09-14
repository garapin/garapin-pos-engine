import mongoose from "mongoose";

const stockHistorySchema = new mongoose.Schema({
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Product",
    required: true,
  },
  quantity: {
    type: Number,
    required: true,
  },
  changeType: {
    type: String,
    enum: ["ADD", "SUBTRACT"],
    required: true,
  },
  date: {
    type: Date,
    default: Date.now,
  },
  description: {
    type: String,
    required: false,
  },
});

const StockHistoryModel = mongoose.model("StockHistory", stockHistorySchema);

export { StockHistoryModel, stockHistorySchema };
