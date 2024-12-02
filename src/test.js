import mongoose from "./config/db.js";
import CashPaymentEngine from "./engines/cash-transaction/cashPaymentEngine.js";
import TransactionEngine from "./engines/bagi-bagi-transaction/transactionEngine.js";
import WithdrawlPaymentEngine from "./engines/withdrawl-transaction/withdrawlPaymentEngine.js";

// const rakEngine = new RakEngine();
// rakEngine.checkRakEngine();

// const transactionEngine = new TransactionEngine();
// transactionEngine.processTransactions();

const cashPaymentEngine = new CashPaymentEngine();
cashPaymentEngine.checkPaymentCash();

// const withdrawlPaymentEngine = new WithdrawlPaymentEngine();
// withdrawlPaymentEngine.checkPaymentCash();

// const productengine = new ProductEngine();
// productengine.processTransactions();
