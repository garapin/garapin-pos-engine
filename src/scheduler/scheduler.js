import cron from "node-cron";
import Logger from "../utils/logger.js";
import "dotenv/config";
import CashPaymentEngine from "../engines/cash-transaction/cashPaymentEngine.js";
import TransactionEngine from "../engines/bagi-bagi-transaction/transactionEngine.js";
import RakEngine from "../engines/one-mart/rakEngine.js";

const transactionEngine = new TransactionEngine();
const cashPaymentEngine = new CashPaymentEngine();
const rakEngine = new RakEngine();
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
}

export default setupCronJobs;
