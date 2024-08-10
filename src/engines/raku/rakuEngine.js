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
import moment from "moment-timezone";
import { rakuTransactionSchema } from "../../models/rakuTransactionModel.js";
const ObjectId = mongoose.Types.ObjectId;

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
  async getAllTransaction(stores) {
    try {
      let allTransactions = [];

      for (const store of stores) {
        const storeDatabase = await connectTargetDatabase(store.db_name);

        const rakuTransactionModelStore = storeDatabase.model(
          "rakTransaction",
          rakuTransactionSchema
        );

        const rakTransactions = await rakuTransactionModelStore.find();
        if (rakTransactions.length > 0) {
          const p = rakTransactions.filter(
            (x) => x.payment_status === "PENDING"
          );
          allTransactions.push(...p);
        }
      }

      return allTransactions;
    } catch (error) {
      console.error("Error fetching raks:", error);
      throw error; // Opsional, agar error bisa diteruskan ke pemanggil fungsi
    }
  }

  async checkprocessStatus() {
    try {
      const [allStore] = await Promise.all([this.getAllStore()]);

      const allStoresWithRaks = await this.getAllRak(allStore);
      const allTransactions = await this.getAllTransaction(allStore);
      const filterAllRaks = allStoresWithRaks.filter(
        (x) => x.allRaks.length > 0
      );

      for (const raks of filterAllRaks) {
        const resultStatusPosition = await this.updateStatusPosition(
          raks.allRaks,
          raks.positionModelStore,
          allTransactions
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

  async updateStatusPosition(allRaks, positionModelStore, allTransactions) {
    try {
      const jakartaTimezone = "Asia/Jakarta";
      const dueDateInDays = 2;
      const payDuration = 1200 * 60 * 1000; // 1200 minutes in milliseconds

      // Helper function to check if invoice has expired
      const isInvoiceExpired = (expiryDate) => {
        // Mendapatkan tanggal saat ini dalam zona waktu Jakarta
        const today = moment().tz(jakartaTimezone).startOf("day");
        // Mendapatkan tanggal kadaluarsa dalam zona waktu Jakarta
        const expiry = moment.tz(expiryDate, jakartaTimezone).startOf("day");
        // Memeriksa apakah tanggal hari ini lebih besar dari tanggal kadaluarsa
        return today.isSameOrAfter(expiry);
      };

      // Process each rak and its positions
      const updatedRaks = await Promise.all(
        allRaks.map(async (rak) => {
          await Promise.all(
            rak.positions.map(async (position) => {
              const today = moment().tz(jakartaTimezone).toDate();
              const endDate = moment
                .tz(position.end_date, jakartaTimezone)
                .toDate();
              // End date with due date added in Jakarta time zone
              const endDateWithDueDate = moment(endDate)
                .add(dueDateInDays, "days")
                .toDate();

              const availableDate = moment(endDate).add(1, "second").toDate();
              if (position.status === "RENT") {
                // Tanggal akhir dan awal dalam format Jakarta timezone
                const endDateR = moment
                  .tz(position.end_date, jakartaTimezone)
                  .startOf("day")
                  .toDate();
                const startDateR = moment
                  .tz(position.start_date, jakartaTimezone)
                  .startOf("day")
                  .toDate();

                const daysDifference = moment
                  .duration(moment(endDateR).diff(moment(startDateR)))
                  .asDays();

                if (daysDifference < 3) {
                  if (availableDate.getTime() > today.getTime()) {
                    position.status = "IN_COMING";
                    position.available_date = availableDate;
                  } else {
                    position.status = "AVAILABLE";
                    position.available_date = today;
                  }
                } else {
                  // Mencari dua hari sebelum endDate
                  const twoDaysBeforeEndDate = moment(endDate)
                    .subtract(2, "days")
                    .toDate();

                  if (today.getTime() < twoDaysBeforeEndDate.getTime()) {
                    // Jika today kurang dari twoDaysBeforeEndDate
                    position.status = "RENT";
                    position.available_date = availableDate;
                  } else if (
                    today.getTime() >= twoDaysBeforeEndDate.getTime() &&
                    today.getTime() <= endDate.getTime()
                  ) {
                    // Jika today berada antara twoDaysBeforeEndDate dan endDate
                    position.status = "IN_COMING";
                    position.available_date = availableDate;
                  } else if (today.getTime() > availableDate.getTime()) {
                    // Jika today lebih dari availableDate
                    position.status = "AVAILABLE";
                    position.available_date = today;
                  } else {
                    position.status = "MUNGKINKAH";
                    position.available_date = availableDate;
                  }
                }
              } else if (position.status === "IN_COMING") {
                if (today.getTime() > availableDate.getTime()) {
                  // Jika today lebih dari availableDate
                  position.status = "AVAILABLE";
                  position.available_date = today;
                } else if (today.getTime() > endDateWithDueDate.getTime()) {
                  position.status = "AVAILABLE";
                  position.available_date = today;
                } else {
                  position.available_date = endDateWithDueDate;
                }
              } else if (position.status === "UNPAID") {
                // Find the transaction that includes this position
                const transaction = allTransactions.find((transaction) =>
                  transaction.list_rak.some(
                    (r) => r.position.toString() === position._id.toString()
                  )
                );

                if (transaction) {
                  if (isInvoiceExpired(transaction?.xendit_info?.expiryDate)) {
                    position.status = "AVAILABLE";
                    position.available_date = today;
                    console.log("isInvoiceExpired");
                  }
                }
              } else if (
                position.status === "EXPIRED" ||
                position.status === "AVAILABLE"
              ) {
                position.status = "AVAILABLE";
                position.available_date = today;
              }

              // Return updated position details
              return {
                _id: position._id,
                status: position.status,
                available_date: position.available_date,
              };
            })
          );
          return rak;
        })
      );

      // Update the database with the new status and availability date
      for (const rak of updatedRaks) {
        for (const position of rak.positions) {
          // console.debug(
          //   moment(position.available_date).format("MMMM Do YYYY, h:mm:ss a")
          // );
          try {
            await positionModelStore.updateOne(
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
