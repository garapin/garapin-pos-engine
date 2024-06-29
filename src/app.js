import express from 'express';
import 'dotenv/config';
import setupCronJobs from './scheduler/scheduler.js';

import Logger from './utils/logger.js';
import mongoose from './config/db.js';

const app = express();
const port = process.env.PORT || 5000;
const host = process.env.HOST || "localhost";

mongoose.connect;

setupCronJobs();

// Connect to MainDatabase


app.listen(port, host, () => {
  Logger.log(`Server is running at http://${host}:${port}`);
});