import RakEngine from "./engines/one-mart/rakEngine.js";
import mongoose from "./config/db.js";
import CashPaymentEngine from "./engines/cash-transaction/cashPaymentEngine.js";
import TransactionEngine from "./engines/bagi-bagi-transaction/transactionEngine.js";
import { connectTargetDatabase } from "./config/targetDatabase.js";
import { positionSchema } from "./models/positionModel.js";
import { productSchema } from "./models/productModel.js";
// const rakEngine = new RakEngine();
// rakEngine.checkRakEngine();

const transactionEngine = new TransactionEngine();
transactionEngine.processTransactions();

const cashPaymentEngine = new CashPaymentEngine();
cashPaymentEngine.checkPaymentCash();

// const productengine = new ProductEngine();
// productengine.processTransactions();
