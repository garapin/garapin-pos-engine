import mongoose from 'mongoose';

const databaseScheme = new mongoose.Schema({
  db_name: {
    type: String,
    required: false, 
  },
  db_parent: {
    type: String,
    required: false,
  },
  email_owner: String,
}, { timestamps: true, autoIndex: false }, { _id: true });

const DatabaseModel = mongoose.model('Database', databaseScheme);

export { DatabaseModel, databaseScheme };