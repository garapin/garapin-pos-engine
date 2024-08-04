import cron from "node-cron";
import Logger from "../utils/logger.js";
import "dotenv/config";
import CashPaymentEngine from "../engines/cash-transaction/cashPaymentEngine.js";
import TransactionEngine from "../engines/bagi-bagi-transaction/transactionEngine.js";
import RakuEngine from "../engines/raku/rakuEngine.js";

const transactionEngine = new TransactionEngine();
const cashPaymentEngine = new CashPaymentEngine();
const rakuEngine = new RakuEngine();

function setupCronJobs() {
    const schedule = process.env.CRON_SCHEDULE || '0 * * * *';
    cron.schedule(schedule, () => {
        Logger.log('Menjalankan cron job VA and QRIS checked Transaction');
        transactionEngine.processTransactions();
    });

    cron.schedule(schedule, () => {
        Logger.log('Menjalankan cron check payment CASH');
        cashPaymentEngine.checkPaymentCash();
    });

    // Jadwal untuk raku status
  const scheduleRaku = "*/1 * * * *"; //"*/1 * * * *";
  cron.schedule(scheduleRaku, () => {
    Logger.log("Menjalankan cron check raku status");
    rakuEngine.checkprocessStatus();
  });

  setInterval(() => {
    Logger.log("Menjalankan cron check raku status setiap 10 detik");
    rakuEngine.checkprocessStatus();
  }, 60000); // 60000 ms = 1 minute
}

export default setupCronJobs;