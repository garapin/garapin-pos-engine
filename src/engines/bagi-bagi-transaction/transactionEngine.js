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

const parentDir = path.dirname(__dirname);
const targetDir = path.join(parentDir, "bagi-bagi-product");

class TransactionEngine {
  constructor() {
    this.apiKey = process.env.XENDIT_API_KEY;
    this.accountId = process.env.XENDIT_ACCOUNT_GARAPIN;
    this.baseUrl = "https://api.xendit.co";
    this.processedTransactions = new Set();
    this.pool = workerpool.pool(path.resolve(__dirname, "worker.js"), {
      //minWorkers: 5,
      minWorkers: 1,
      maxWorkers: 10, // Set maximum workers to 20
    });
    this.bagipool = workerpool.pool(path.resolve(targetDir, "worker.js"), {
      //minWorkers: 5,
      minWorkers: 1,
      maxWorkers: 10, // Set maximum workers to 20
    });
  }

  async getXenditTransaction(limit = 50, afterId = null) {
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
    const date24ago = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // Logger.errorLog("date24ago", date24ago);
    try {
      Logger.log("Mengambil transaksi dari Xendit fetchTransactions");
      const params = {
        limit: limit,
        channel_categories: [ChannelCategory.VA, ChannelCategory.QR],
      };
      if (afterId) {
        params.after_id = afterId;
      }
      return axios.get(url + "?created[gte]=" + date24ago, {
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
      let hasMoreTransactions = true;
      let lastTransactionId = null;
      const allTransactions = [];
      const allProcessedTransactionIds = [];

      // Ambil semua transaksi terlebih dahulu
      while (hasMoreTransactions) {
        const transactions = await this.getXenditTransaction(
          50,
          lastTransactionId
        );
        if (transactions.length === 0) {
          hasMoreTransactions = false;
          break;
        }

        Logger.log("Total transaksi yang diambil:", transactions.length);
        allTransactions.push(...transactions);
        lastTransactionId = transactions[transactions.length - 1].id;
      }

      const groupedTransactions = {};

      // Iterasi melalui setiap store
      for (const store of allStore) {
        // Filter transaksi yang memiliki db_name yang sama dengan store.db_name
        const filteredTransactions = allTransactions.filter((transaction) => {
          return transaction.reference_id.split("&&")[1] === store.db_name;
        });

        // Jika ada transaksi yang cocok, kelompokkan dalam objek berdasarkan db_name
        if (filteredTransactions.length > 0) {
          groupedTransactions[store.db_name] = filteredTransactions;
        }
      }
      // Menggunakan Promise.all() untuk menjalankan transaksi secara paralel
      const promises = Object.keys(groupedTransactions).map((dbName) => {
        var transactions = groupedTransactions[dbName];

        transactions = transactions.filter((transaction) => {
          return !transaction.reference_id.includes("&&QUICK_RELEASE");
        });
        // console.log(`Grup untuk db_name: ${dbName}`);
        // transactions.forEach((element) => {
        //   console.log("element.reference_id", element.reference_id);
        // });

        // transactions.forEach((element) => {
        //   console.log(element.reference_id);
        // });

        // Menjalankan kedua proses secara paralel
        const processPoolPromise = this.pool.exec("processTransaction", [
          {
            transactions: transactions,
            store: dbName,
            accountId: this.accountId,
            baseUrl: this.baseUrl,
            apiKey: this.apiKey,
          },
        ]);

        const processBagiPoolPromise = this.bagipool.exec(
          "processTransaction",
          [
            {
              transactions: transactions,
              store: dbName,
              accountId: this.accountId,
              baseUrl: this.baseUrl,
              apiKey: this.apiKey,
            },
          ]
        );

        // Tunggu kedua promise selesai secara paralel
        return Promise.all([processPoolPromise, processBagiPoolPromise]).then(
          ([result, resultbagi]) => {
            Logger.log(result);
            Logger.log(resultbagi);
          }
        );
      });

      // Tunggu sampai semua transaksi selesai secara paralel
      await Promise.all(promises);

      // Filter transaksi setelah semua transaksi diambil
      // const filteredTransactions = allTransactions.filter((transaction) => {
      //   if (this.processedTransactions.has(transaction.id)) {
      //     return false;
      //   }
      //   this.processedTransactions.add(transaction.id);
      //   allProcessedTransactionIds.push(transaction.id);
      //   return true;
      // });

      // Logger.errorLog(
      //   "Transaksi yang belum diproses:",
      //   filteredTransactions.length
      // );
      // Logger.errorLog("Transaksi yang sudah diproses:", allTransactions.length);

      // Proses transaksi yang sudah difilter
      // const transactionChunks = this.chunkArray(filteredTransactions, 5);

      // Using async/await inside a for...of loop
      // for (const transaction of allTransactions) {
      //   const result = await this.pool.exec("processTransaction", [
      //     {
      //       transactions: [transaction],
      //       store: storeData,
      //       accountId: this.accountId,
      //       baseUrl: this.baseUrl,
      //       apiKey: this.apiKey,
      //     },
      //   ]);
      // }

      // const promises = allTransactions.map(async (chunk) => {
      //   const chunkPromises = allStore.map(async (store) => {
      //     const storeData = JSON.parse(JSON.stringify(store));
      //     const transactionsData = JSON.parse(JSON.stringify(chunk));

      //     try {
      //       const result = await this.pool.exec("processTransaction", [
      //         {
      //           transactions: transactionsData,
      //           store: storeData,
      //           accountId: this.accountId,
      //           baseUrl: this.baseUrl,
      //           apiKey: this.apiKey,
      //         },
      //       ]);
      //       Logger.log("Transaction processed:", result);
      //       const resultbagi = await this.bagipool.exec("processTransaction", [
      //         {
      //           transactions: transactionsData,
      //           store: storeData,
      //           accountId: this.accountId,
      //           baseUrl: this.baseUrl,
      //           apiKey: this.apiKey,
      //         },
      //       ]);
      //       Logger.log("Transaction processed:", resultbagi);
      //     } catch (error) {
      //       if (error instanceof AggregateError) {
      //         error.errors.forEach((err) =>
      //           Logger.errorLog(
      //             `Error processing transaction pool: ${err.message || err}`
      //           )
      //         );
      //       } else {
      //         Logger.errorLog(
      //           `Error processing transactions: ${error.name}: ${error.message || error}`
      //         );
      //       }
      //     }
      //   });

      //   await Promise.all(chunkPromises);
      // });

      // await Promise.all(promises);
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
