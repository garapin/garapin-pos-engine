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
      //minWorkers: 5,
	  minWorkers: max,
      maxWorkers: 20, // Set maximum workers to 20
    });
  }

  async getXenditTransaction(limit = 10, afterId = null) {
    const url = `${this.baseUrl}/transactions`;
    try {
      const response = await this.fetchTransactions(url, limit, afterId);
      return response.data.data;
    } catch (error) {
      if (error.response && error.response.status === 429) {
        console.log(limit);
        console.log(afterId);
        Logger.errorLog("Rate limit exceeded, waiting before retrying...");
        await this.sleep(5000); // Wait for 5 seconds before retrying
        return this.getXenditTransaction(limit, afterId);
      } else {
        Logger.errorLog("Gagal mengambil transaksi", error);
        throw error;
      }
    }
  }

  async fetchTransactions(url, limit = 10, afterId = null) {
    try {
      Logger.log("Mengambil transaksi dari Xendit fetchTransactions");
      const params = {
        limit: limit,
        channel_categories: [ChannelCategory.VA, ChannelCategory.QR],
      };
      if (afterId) {
        params.after_id = afterId;
      }
      return axios.get(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(this.apiKey + ":").toString("base64")}`,
          "for-user-id": this.accountId,
        },
        params: params,
      });
    } catch (error) {
      Logger.errorLog("Gagal mengambil transaksi", error);
      throw error;
    }
  }

  async processTransactions() {
    Logger.log("Checking transactions...");

    console.time("Worker Pool");
    try {
      const allStore = await this.getAllStore();
      let batchCount = 0;
      let hasMoreTransactions = true;
      let lastTransactionId = null;
      const allProcessedTransactionIds = [];

      while (batchCount < 10 && hasMoreTransactions) {
        const transactions = await this.getXenditTransaction(
          10,
          lastTransactionId
        );
        if (transactions.length === 0) {
          hasMoreTransactions = false;
          break;
        }

        Logger.log("Total transaksi:", transactions.length);

        const filteredTransactions = transactions.filter((transaction) => {
          // if (this.processedTransactions.has(transaction.id)) {
          //   return false;
          // }
          this.processedTransactions.add(transaction.id);
          allProcessedTransactionIds.push(transaction.id);
          return true;
        });

        const transactionChunks = this.chunkArray(filteredTransactions, 5);

        const promises = transactionChunks.map(async (chunk) => {
          const chunkPromises = allStore.map(async (store) => {
            const storeData = JSON.parse(JSON.stringify(store));
            const transactionsData = JSON.parse(JSON.stringify(chunk));

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

          await Promise.all(chunkPromises);
        });

        await Promise.all(promises);
        batchCount++;
        lastTransactionId = transactions[transactions.length - 1].id;
      }

      Logger.log("All processed transaction IDs:", allProcessedTransactionIds);
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

  chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
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

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export default TransactionEngine;
