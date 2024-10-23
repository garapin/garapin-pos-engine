import cron from "node-cron";
import Logger from "../utils/logger.js";
import "dotenv/config";
import CashPaymentEngine from "../engines/cash-transaction/cashPaymentEngine.js";
import TransactionEngine from "../engines/bagi-bagi-transaction/transactionEngine.js";
import RakEngine from "../engines/one-mart/rakEngine.js";
import ProductEngine from "../engines/bagi-bagi-product/productEngine.js";
import WithdrawlPaymentEngine from "../engines/withdrawl-transaction/withdrawlPaymentEngine.js";

const transactionEngine = new TransactionEngine();
const cashPaymentEngine = new CashPaymentEngine();
const withdrawlPaymentEngine = new WithdrawlPaymentEngine();
const rakEngine = new RakEngine();
const productEngine = new ProductEngine();
function setupCronJobs() {
  const schedule = process.env.CRON_SCHEDULE || "0 * * * *";
  cron.schedule(schedule, () => {
    Logger.log("Menjalankan cron job VA and QRIS checked Transaction");
    transactionEngine.processTransactions();
  });

  cron.schedule(schedule, () => {
    Logger.log("Menjalankan cron check payment CASH");
    cashPaymentEngine.checkPaymentCash();
  });

  cron.schedule(schedule, () => {
    Logger.log("Menjalankan checkRakEngine");
    rakEngine.checkRakEngine();
  });
  cron.schedule(schedule, () => {
    Logger.log("Menjalankan cron check payment WITHDRAWL");
    withdrawlPaymentEngine.checkPaymentCash();
  });
}

export default setupCronJobs;
