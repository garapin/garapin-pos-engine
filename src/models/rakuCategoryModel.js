import mongoose from 'mongoose';

const categorySchema = new mongoose.Schema({
  category: {
    type: String,
    required: true,
    unique: true,
  },
  description: String,
  status:{
    type: String,
    default: 'ACTIVE',
  },
}, { timestamps: true });

const CategoryModel = mongoose.model('Category', categorySchema);

export { CategoryModel, categorySchema };
