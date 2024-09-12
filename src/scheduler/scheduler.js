import cron from "node-cron";
import Logger from "../utils/logger.js";
import "dotenv/config";
import CashPaymentEngine from "../engines/cash-transaction/cashPaymentEngine.js";
import TransactionEngine from "../engines/bagi-bagi-transaction/transactionEngine.js";
import MainRakWorker from "../engines/one-mart/mainRakWorker.js";

const transactionEngine = new TransactionEngine();
const cashPaymentEngine = new CashPaymentEngine();
const mainRakWorker = new MainRakWorker();
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
    Logger.log("Menjalankan cron check RAK");
    mainRakWorker.runRakWorker();
  });
}

export default setupCronJobs;
