import "dotenv/config";
import Logger from "../../utils/logger.js";
import workerpool from "workerpool";
import { DatabaseModel } from "../../models/databaseModel.js";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "../../config/db.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class RakEngine {
  constructor() {
    console.log("====================================");
    console.log(path.resolve(__dirname, "rak.js"));
    console.log("====================================");
    this.pool = workerpool.pool(path.resolve(__dirname, "rak.js"), {
      minWorkers: 5,
      maxWorkers: 10, // Set
    });
    // this.checkRakEngine();
  }

  async checkRakEngine() {
    Logger.log("Checking checkRakEngine...");
    console.time("Worker Pool checkRakEngine");

    const allStore = await this.getAllStore();

    try {
      const promises = allStore.map((store) => {
        const storeData = JSON.parse(JSON.stringify(store));
        // console.log("====================================");
        // console.log(storeData);
        // console.log("====================================");

        return this.pool.exec("updateRak", [{ store: storeData }], {
          minWorkers: "max",
          maxWorkers: "max",
        });
      });
      await Promise.all(promises);
    } catch (error) {
      // console.log("====================================");
      // console.log(error);
      // console.log("====================================");
      Logger.errorLog("Error during worker pool ", error);
    }
    console.timeEnd("Worker Pool checkRakEngine");
  }

  async getAllStore() {
    try {
      const allStore = await DatabaseModel.find();
      return allStore;
    } catch (error) {
      Logger.errorLog("Error fetching all store data", error);
    }
  }
}

export default RakEngine;
