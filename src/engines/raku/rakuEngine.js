import axios from "axios";
import "dotenv/config";
import Logger from "../../utils/logger.js";
import { ChannelCategory } from "../../config/enums.js";
import workerpool from "workerpool";
import path from "path";
import { fileURLToPath } from "url";
import { DatabaseModel } from "../../models/databaseModel.js";
import { rakSchema } from "../../models/rakuRakModel.js";
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import { categorySchema } from "../../models/rakuCategoryModel.js";
import { rakTypeSchema } from "../../models/rakuRakTypeModel.js";
import { positionSchema } from "../../models/rakuPositionModel.js";
import mongoose from "mongoose";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class RakuEngine {
  constructor() {
    this.apiKey = process.env.XENDIT_API_KEY;
    this.accountId = process.env.XENDIT_ACCOUNT_GARAPIN;
    this.baseUrl = "https://api.xendit.co";
    this.processedTransactions = new Set();
    this.pool = workerpool.pool(path.resolve(__dirname, "worker.js"), {
      minWorkers: "max",
    });
  }

  async getAllRak(stores) {
    try {
      const allStoresRaks = [];
      for (const store of stores) {
        const storeDatabase = await connectTargetDatabase(store.db_name);

        const rakModelStore = storeDatabase.model("rak", rakSchema);
        storeDatabase.model("Category", categorySchema);
        storeDatabase.model("rakType", rakTypeSchema);
        const positionModelStore = storeDatabase.model(
          "position",
          positionSchema
        );

        const allRaks = await rakModelStore
          .find()
          .populate([
            { path: "category" },
            { path: "type" },
            {
              path: "positions",
              populate: { path: "filter", model: "Category" },
            },
          ])
          .sort({ createdAt: -1 })
          .lean({ virtuals: true });

        allStoresRaks.push({
          store,
          allRaks,
          rakModelStore,
          positionModelStore,
        });
      }

      return allStoresRaks;
    } catch (error) {
      console.error("Error fetching raks:", error);
      throw error; // Opsional, agar error bisa diteruskan ke pemanggil fungsi
    }
  }

  async getXenditTransaction() {
    const url = `${this.baseUrl}/transactions`;
    try {
      const response = await this.fetchTransactions(url);
      return response.data.data;
    } catch (error) {
      Logger.errorLog("Gagal mengambil transaksi", error);
    }
  }

  async fetchTransactions(url) {
    try {
      return axios.get(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(this.apiKey + ":").toString("base64")}`,
          "for-user-id": this.accountId,
        },
        params: {
          limit: 15,
          channel_categories: [ChannelCategory.VA, ChannelCategory.QR],
        },
      });
    } catch (error) {
      Logger.errorLog("Gagal mengambil transaksi", error);
    }
  }

  async checkprocessStatus() {
    try {
      const [transactions, allStore] = await Promise.all([
        this.getXenditTransaction(),
        this.getAllStore(),
      ]);

      // Proses filter raku store
      const rakuStore = allStore;
      // .filter(
      //   (store) =>
      //     // store.db_name.startsWith("om")
      // );

      const allStoresWithRaks = await this.getAllRak(rakuStore);

      const allRakuStore = allStoresWithRaks.filter(
        (x) => x.allRaks.length > 0
      );

      for (const raks of allStoresWithRaks.filter(
        (x) => x.allRaks.length > 0
      )) {
        const resultStatusPosition = await this.updateStatusPosition(
          raks.allRaks,
          raks.positionModelStore
        );

        if (resultStatusPosition) {
          const resultStatusRak = await this.updateStatusRak(
            raks.allRaks,
            raks.rakModelStore
          );
        }
      }
    } catch (error) {
      Logger.errorLog(`Error processing transactions: ${error.message}`);
    }
  }

  async updateStatusPosition(allRaks, positionModelStore) {
    try {
      const updatedRaks = await Promise.all(
        allRaks.map(async (rak) => {
          await Promise.all(
            rak.positions.map(async (position) => {
              const today = new Date();

              const endDate = new Date(position.end_date);
              const startDate = new Date(position.start_date);
              startDate.setHours(0, 0, 0, 0);
              const dueDateInDays = 2;
              const payDuration = 1240 * 60 * 1000;
              const endDateWithDueDate = new Date(endDate);
              endDateWithDueDate.setDate(endDate.getDate() + dueDateInDays);

              if (position.status === "RENT") {
                today.setHours(0, 0, 0, 0);
                endDate.setHours(0, 0, 0, 0);
                endDateWithDueDate.setHours(0, 0, 0, 0);

                if (
                  today.getTime() > endDate.getTime() &&
                  today.getTime() <= endDateWithDueDate.getTime()
                ) {
                  position.status = "IN_COMING";
                  position.available_date = endDateWithDueDate;
                } else if (today.getTime() > endDateWithDueDate.getTime()) {
                  position.status = "AVAILABLE";
                  position.available_date = today;
                }
              } else if (position.status === "IN_COMING") {
                const todayMidNight = today.getTime();
                const endMidNight = endDateWithDueDate.getTime();
                today.setHours(0, 0, 0, 0);

                if (todayMidNight > endMidNight) {
                  position.status = "AVAILABLE";
                  position.available_date = today;
                }
              } else if (position.status === "UNPAID") {
                const nowNPayDuration = new Date(today.getTime() + payDuration);
                if (startDate.getTime() < nowNPayDuration.getTime()) {
                  position.status = "AVAILABLE";
                  position.available_date = today;
                }
              } else if (position.status === "EXPIRED") {
                position.status = "AVAILABLE";
                position.available_date = today;
              } else if (position.status === "AVAILABLE") {
                position.status = "AVAILABLE";
                position.available_date = today;
              }

              return {
                _id: position._id,
                status: position.available_date,
                available_date: position.available_date,
              };
            })
          );
          return rak;
        })
      );

      // Setelah mendapatkan semua update, lakukan operasi update ke database
      for (const rak of updatedRaks) {
        for (const position of rak.positions) {
          try {
            const update = await positionModelStore.updateOne(
              { _id: position._id },
              {
                status: position.status,
                available_date: position.available_date,
                ...(position.status === "AVAILABLE" && {
                  $unset: { end_date: "", start_date: "" },
                }),
              }
            );
          } catch (error) {
            console.error(`Failed to update position ${position._id}: `, error);
          }
        }
      }
      return updatedRaks;
    } catch (error) {
      console.error("An error occurred during the update process: ", error);
      throw error;
    }
  }

  async updateStatusRak(allRaks, rakModelStore) {
    try {
      const updatedRaks = await Promise.all(allRaks);

      // Setelah mendapatkan semua update, lakukan operasi update ke database
      for (const rak of updatedRaks) {
        const findPosition = rak.positions.filter(
          (x) => x.status === "AVAILABLE"
        );

        if (findPosition.length > 0) {
          rak.status = "AVAILABLE";
        } else if (findPosition.length <= 0) {
          rak.status = "NOTAVAILABLE";
        }

        try {
          const update = await rakModelStore.updateOne(
            { _id: rak._id },
            { status: rak.status }
          );
        } catch (error) {
          console.error(`Failed to update rak ${rak._id}: `, error);
        }
      }

      return updatedRaks;
    } catch (error) {
      console.error("An error occurred during the update process: ", error);
      throw error;
    }
  }

  async getAllStore() {
    const allStore = await DatabaseModel.find();
    const existingDatabases = await this.getExistingDatabases();

    const connections = [];

    for (const store of allStore) {
      // Check if the database exists
      if (existingDatabases.includes(store.db_name)) {
        connections.push(store);
      }
    }

    return connections;
  }

  async getExistingDatabases() {
    try {
      // Connect to the admin database to list all databases
      const adminDb = mongoose.connection.db.admin();
      const dbs = await adminDb.listDatabases();
      return dbs.databases.map((db) => db.name);
    } catch (error) {
      console.error("Error fetching existing databases:", error);
      return [];
    }
  }

  async closePool() {
    await this.pool.terminate();
  }
}

export default RakuEngine;
