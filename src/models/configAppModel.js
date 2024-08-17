import mongoose from "mongoose";

const configAppSchema = new mongoose.Schema({
  payment_duration: {
    type: Number,
    required: true,
  },
  minimum_rent_date: {
    type: Number,
    required: true,
  },
  rent_due_date: {
    type: Number,
    required: true,
  },
  due_date: {
    type: Number,
    required: false,
  },
});

const ConfigAppModel = mongoose.model("config_app", configAppSchema);

export { ConfigAppModel, configAppSchema };
