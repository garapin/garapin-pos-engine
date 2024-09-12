import { DatabaseModel } from "../../models/databaseModel.js";
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import { rakTransactionSchema } from "../../models/rakTransactionModel.js";
import { RakModel, rakSchema } from "../../models/rakModel.js";
import { PositionModel, positionSchema } from "../../models/positionModel.js";
import Logger from "../../utils/logger.js";
import timetools from "../one-mart/timetools.js";
import mongoose from "../../config/db.js";
import { configAppSchema } from "../../models/configAppModel.js";
import moment from "moment-timezone";

import { STATUS_RAK } from "../../models/rakModel.js";
import { STATUS_POSITION } from "../../models/positionModel.js";
class RakServices {
  constructor(parameters) {}

  async procesUpdateServices() {
    const alldb = await this.getAllStore();
    this.upDateRakbyDatabaseTarget(alldb);
  }

  async getAllStore() {
    console.log("Mengambil semua data store...");
    const allStore = await DatabaseModel.find();
    return allStore;
  }

  // mengupdate semua transaksi yang expired berdasarakan invoice expired pada xendit
  upDateRakbyDatabaseTarget = async (listDb) => {
    console.time("Worker Pool Rak");
    Logger.log(" Memperbarui status transaksi RAK pada database target...");
    listDb.forEach(async (db) => {
      const targetDatabase = db.db_name;
      await this.updateRakSingleDatabase(targetDatabase);
    });

    console.timeEnd("Worker Pool Rak");
    Logger.log(
      "Selesai memperbarui status transaksi RAK pada semua database target..."
    );
  };

  updateRakSingleDatabase = async (targetDatabase) => {
    Logger.log(`Update status RAK pada ${targetDatabase}`, "INFO");

    const storeDatabase = await connectTargetDatabase(targetDatabase);
    const confModel = storeDatabase.model("config_app", configAppSchema);
    const configApp = await confModel.findOne();

    const rakTransactionModelStore = storeDatabase.model(
      "rakTransaction",
      rakTransactionSchema
    );
    const rakModelStore = storeDatabase.model("rak", rakSchema);
    const positionModelStore = storeDatabase.model("position", positionSchema);

    const alltransaction = await rakTransactionModelStore
      .find()
      .populate({ path: "list_rak" });
    const today = moment().tz("GMT").format();

    alltransaction.forEach((element) => {
      if (element.payment_status === "PENDING" && element) {
        const expiryDate = element.xendit_info.expiryDate;
        if (timetools.isExpired(expiryDate)) {
          element.payment_status = "EXPIRED";
          element.save();
          element.list_rak.forEach(async (colrak) => {
            const position = await positionModelStore.findById(colrak.position);
            if (position.status === STATUS_POSITION.UNPAID) {
              if (position.end_date) {
                position.status = timetools.isIncoming(
                  position,
                  configApp.due_date
                )
                  ? STATUS_POSITION.INCOMING
                  : STATUS_POSITION.RENTED;
              }
              position.save();
            }
          });
        }
      } else {
        element.list_rak.forEach(async (colrak) => {
          const position = await positionModelStore.findById(colrak.position);
          const rak = await rakModelStore.findById(colrak.rak);

          if (timetools.isExpired(position.end_date)) {
            position.status = STATUS_POSITION.AVAILABLE;
            position.available_date = today;
            position.start_date = null;
            position.end_date = null;
          } else if (timetools.isIncoming(position, configApp.due_date)) {
            position.status = STATUS_POSITION.INCOMING;
          } else if (position.status !== STATUS_POSITION.AVAILABLE) {
            console.log("rented");

            position.status = STATUS_POSITION.RENTED;
          } else {
            console.log("AVAILABLE");
            position.status = STATUS_POSITION.AVAILABLE;
            position.available_date = today;
            position.start_date = null;
            position.end_date = null;
          }

          position.save();
        });
      }
    });
    // storeDatabase.close();
  };
}

export default RakServices;
