import mongoose from 'mongoose';
import 'dotenv/config';
import Logger from '../utils/logger.js';

mongoose.set('strictQuery', false);
const MONGODB_URI = process.env.MONGODB_URI;

mongoose.connect(`${MONGODB_URI}/garapin_pos?authSource=admin`, { useNewUrlParser: true, useUnifiedTopology: true });

const mainDatabase = mongoose.connection;

mainDatabase.on('error', console.error.bind(console, 'Connection to the Main Database failed:'));

mainDatabase.once('open', () => {
  Logger.log(`Connected to the ${MONGODB_URI}/garapin_pos`);
});


export default mongoose;