import "dotenv/config";
import Logger from "../../utils/logger.js";
import workerpool from "workerpool";
import { DatabaseModel } from "../../models/databaseModel.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class CashPaymentEngine {
  constructor() {
    this.apiKey = process.env.XENDIT_API_KEY;
    this.baseUrl = "https://api.xendit.co";
    this.pool = workerpool.pool(path.resolve(__dirname, "storeWorker.js"), {
      minWorkers: 1,
    });
  }

  async checkPaymentCash() {
    const allStore = await this.getAllStore();

    console.time("Worker Pool Cash");
    try {
      const promises = allStore.map((store) => {
        const storeData = JSON.parse(JSON.stringify(store));
        return this.pool.exec("processStore", [
          { store: storeData, baseUrl: this.baseUrl, apiKey: this.apiKey },
        ]);
      });
      await Promise.all(promises);
    } catch (error) {
      Logger.errorLog("Error during worker pool cash", error);
    }
    console.timeEnd("Worker Pool Cash");
  }

  async getAllStore() {
    const allStore = await DatabaseModel.find();

    const garapinPosStore = {
      db_name: "garapin_pos",
    };

    allStore.push(garapinPosStore);

    console.log("Total Store: ", allStore.length);
    console.log(allStore);
    return allStore;
  }
}

export default CashPaymentEngine;
