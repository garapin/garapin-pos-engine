import mongoose from "mongoose";

// Skema untuk setiap rute
const routeSchema = new mongoose.Schema({
  currency: String,
  destination_account_id: String,
  source_account_id: String,
  reference_id: String,
  percent_amount: Number,
  percent_fee_pos: Number,
  flat_amount: Number,
  target: String,
  role: String,
  fee_pos: Number,
  taxes: Boolean,
  totalFee: Number,
  fee_bank: Number,
});

// Skema untuk data utama
const splitPaymentRuleIdScheme = new mongoose.Schema({
  id_template: String,
  invoice: String,
  id: String,
  name: String,
  description: String,
  created_at: Date,
  updated_at: Date,
  routes: [routeSchema], // Menyimpan array objek rute
});

// Membuat model dari skema
const SplitPaymentRuleIdModel = mongoose.model(
  "Split_Payment_Rule_Id",
  splitPaymentRuleIdScheme
);

export { SplitPaymentRuleIdModel, splitPaymentRuleIdScheme };
