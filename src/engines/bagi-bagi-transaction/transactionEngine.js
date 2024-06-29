import axios from "axios";
import "dotenv/config";
import Logger from "../../utils/logger.js";
import { ChannelCategory } from "../../config/enums.js";
import workerpool from 'workerpool';
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TransactionEngine {
  constructor() {
    this.apiKey = process.env.XENDIT_API_KEY;
    this.accountId = process.env.XENDIT_ACCOUNT_GARAPIN;
    this.baseUrl = "https://api.xendit.co";
    this.pool = workerpool.pool(path.resolve(__dirname, 'worker.js'), { minWorkers: 'max' });
  }

  async getXenditTransaction() {
    const url = `${this.baseUrl}/transactions`;
    try {
      const response = await this.fetchTransactions(url);
      await this.processTransactions(response);
    } catch (error) {
      Logger.errorLog("Gagal mengambil transaksi", error);
    }
  }

  async fetchTransactions(url) {
    return axios.get(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(this.apiKey + ":").toString("base64")}`,
        "for-user-id": this.accountId,
      },
      params: {
        limit: 50,
        channel_categories: [ChannelCategory.VA, ChannelCategory.QR],
      },
    });
  }

  async processTransactions(response) {
    Logger.log("Checking transactions...");

    // Mengukur waktu menggunakan worker threads
    console.time("Worker Pool");
    try {
      const promises = response.data.data.map((transaction) =>
        this.pool.exec('processTransaction', [{ transaction, accountId: this.accountId, baseUrl: this.baseUrl, apiKey: this.apiKey }])
      );
      const results = await Promise.all(promises);
      Logger.log("All transactions processed:", results);
    } catch (error) {
      Logger.errorLog(`Error processing transactions: ${error.message}`);
    }
    console.timeEnd("Worker Pool");
  }

  async closePool() {
    await this.pool.terminate();
  }
}

export default TransactionEngine;
