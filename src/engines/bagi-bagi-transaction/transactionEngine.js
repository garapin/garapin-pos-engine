import axios from "axios";
import "dotenv/config";
import Logger from "../../utils/logger.js";
import { ChannelCategory } from "../../config/enums.js";
import workerpool from "workerpool";
import path from "path";
import { fileURLToPath } from "url";
import { DatabaseModel } from "../../models/databaseModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class TransactionEngine {
  constructor() {
    this.apiKey = process.env.XENDIT_API_KEY;
    this.accountId = process.env.XENDIT_ACCOUNT_GARAPIN;
    this.baseUrl = "https://api.xendit.co";
    this.processedTransactions = new Set();
    this.pool = workerpool.pool(path.resolve(__dirname, "worker.js"), {
      minWorkers: "max",
    });
  }

  async getXenditTransaction(limit = 10) {
    const url = `${this.baseUrl}/transactions`;
    try {
      const response = await this.fetchTransactions(url, limit);
      return response.data.data;
    } catch (error) {
      Logger.errorLog("Gagal mengambil transaksi", error);
    }
  }

  async fetchTransactions(url, limit = 10) {
    try {
      Logger.log("Mengambil transaksi dari Xendit fetchTransactions");
      return axios.get(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(this.apiKey + ":").toString("base64")}`,
          "for-user-id": this.accountId,
        },
        params: {
          limit: limit,
          channel_categories: [ChannelCategory.VA, ChannelCategory.QR],
        },
      });
    } catch (error) {
      Logger.errorLog("Gagal mengambil transaksi", error);
    }
  }

  async processTransactions() {
    Logger.log("Checking transactions...");

    console.time("Worker Pool");
    try {
      const allStore = await this.getAllStore();
      let batchCount = 0;
      let hasMoreTransactions = true;

      while (batchCount < 5 && hasMoreTransactions) {
        const transactions = await this.getXenditTransaction();
        if (transactions.length === 0) {
          hasMoreTransactions = false;
          break;
        }

        Logger.log("Total transaksi:", transactions.length);

        const filteredTransactions = transactions.filter((transaction) => {
          if (this.processedTransactions.has(transaction.id)) {
            return false;
          }
          this.processedTransactions.add(transaction.id);
          return true;
        });

        const promises = allStore.map(async (store) => {
          const storeData = JSON.parse(JSON.stringify(store));
          const transactionsData = JSON.parse(JSON.stringify(filteredTransactions));

          try {
            console.log(transactionsData);

            const result = await this.pool.exec("processTransaction", [
              {
                transactions: transactionsData,
                store: storeData,
                accountId: this.accountId,
                baseUrl: this.baseUrl,
                apiKey: this.apiKey,
              },
            ]);
            Logger.log("Transaction processed:", result);
          } catch (error) {
            if (error instanceof AggregateError) {
              error.errors.forEach((err) =>
                Logger.errorLog(
                  `Error processing transaction pool: ${err.message || err}`
                )
              );
            } else {
              Logger.errorLog(
                `Error processing transactions: ${error.name}: ${error.message || error}`
              );
            }
          }
        });

        await Promise.all(promises);
        batchCount++;
      }
    } catch (error) {
      Logger.errorLog(`Error processing transactions: ${error.message}`);
      if (error.name === "MongoNetworkError") {
        Logger.errorLog(
          "Network error while connecting to the database",
          error
        );
      } else if (error.name === "MongoServerError") {
        Logger.errorLog("Server error while querying the database", error);
      } else if (error.name === "ValidationError") {
        Logger.errorLog("Validation error", error);
      } else {
        Logger.errorLog("An unexpected error occurred", error);
      }
    }
    console.timeEnd("Worker Pool");
  }

  async getAllStore() {
    try {
      const allStore = await DatabaseModel.find();
      return allStore;
    } catch (error) {
      print.error("Error fetching all store data", error);
    }
  }

  async closePool() {
    await this.pool.terminate();
  }
}

export default TransactionEngine;