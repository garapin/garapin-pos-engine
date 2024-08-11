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
import { ConfigAppModel } from "../../models/configAppModel.js";
const ObjectId = mongoose.Types.ObjectId;
const timezones = Intl.DateTimeFormat().resolvedOptions().timeZone;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class RakuEngine {
  constructor() {
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
      const configApp = await ConfigAppModel.findOne();
      const due_date = configApp.due_date;
      const today = moment().tz(timezones).toDate();

      // Helper function to check if invoice has expired
      const isInvoiceExpired = (expiryDate) => {
        const expiry = moment.tz(expiryDate, timezones).startOf("day");
        // Memeriksa apakah tanggal hari ini lebih besar dari tanggal kadaluarsa
        return moment(today).isSameOrAfter(expiry);
      };

      // Process each rak and its positions
      const updatedRaks = await Promise.all(
        allRaks.map(async (rak) => {
          await Promise.all(
            rak.positions.map(async (position) => {
              const start_date = moment.tz(position.start_date, timezones);
              const end_date = moment.tz(position.end_date, timezones);
              const available_date = moment.tz(
                position.available_date,
                timezones
              );
              const total_rent = moment
                .tz(end_date, timezones)
                .diff(moment.tz(start_date, timezones), "days");

              if (position.status === "RENT") {
                if (total_rent < 3) {
                  if (available_date.toDate() < today) {
                    position.status = "AVAILABLE";
                    position.available_date = today;
                  }
                } else {
                  const twoDaysBeforeEndDate = moment
                    .tz(available_date, timezones)
                    .subtract(due_date, "days")
                    .toDate();

                  // Konversi tanggal ke objek moment dengan zona waktu yang sesuai
                  const twoDaysBeforeEnd = moment.tz(
                    twoDaysBeforeEndDate,
                    timezones
                  );

                  if (
                    twoDaysBeforeEnd.isBetween(
                      available_date,
                      end_date,
                      null,
                      "[]"
                    )
                  ) {
                    position.status = "IN_COMING";
                  } else if (available_date.toDate() < today) {
                    position.status = "AVAILABLE";
                    position.available_date = today;
                  }
                }
              } else if (position.status === "IN_COMING") {
                // console.debug(
                //   "====================================",
                //   moment(start_date).format("DD-MM-YYYY|HH:mm:ss"),
                //   moment(end_date).format("DD-MM-YYYY|HH:mm:ss"),
                //   moment(available_date).format("DD-MM-YYYY|HH:mm:ss"),
                //   position,
                //   total_rent,
                //   "kurang dari 3",
                //   "===================================="
                // );
                if (available_date.toDate() < today) {
                  position.status = "AVAILABLE";
                  position.available_date = today;
                } else if (end_date.toDate() < today) {
                  position.status = "AVAILABLE";
                  position.available_date = today;
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
          console.log(
            moment(position.available_date).format("DD-MM-YYYY|HH:mm:ss"),
            position
          );
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
