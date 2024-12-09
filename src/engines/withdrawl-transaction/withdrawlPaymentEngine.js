import "dotenv/config";
import Logger from "../../utils/logger.js";
import workerpool from "workerpool";
import { DatabaseModel } from "../../models/databaseModel.js";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const apiKey = process.env.XENDIT_API_KEY;
const baseUrl = "https://api.xendit.co";
const pool = workerpool.pool(path.resolve(__dirname, "withdrawlWorker.js"), {
  minWorkers: "max",
});
class WithdrawlPaymentEngine {
  constructor() {}

  async checkPaymentCash() {
    const allStore = await this.getAllStore();

    console.time("Worker Pool Withdrawl");
    try {
      const promises = allStore.map((store) => {
        const storeData = JSON.parse(JSON.stringify(store));
        return pool.exec("processStoreWithdrawl", [
          { store: storeData, baseUrl: baseUrl, apiKey: apiKey },
        ]);
      });

      // Tunggu semua worker selesai
      await Promise.all(promises);
    } catch (error) {
      Logger.errorLog("Error during worker pool withdrawl", error);
    } finally {
      Logger.errorLog("SELESAI");
      // pool
      //   .terminate()
      //   .then(() => {
      //     Logger.log("Worker pool terminated.");
      //   })
      //   .catch((error) => {
      //     Logger.errorLog("Error terminating worker pool:", error);
      //   });
    }
    console.timeEnd("Worker Pool Withdrawl");
  }

  async getAllStore() {
    const allStore = await DatabaseModel.find();

    const garapinPosStore = {
      db_name: "garapin_pos",
    };

    allStore.push(garapinPosStore);

    console.log("Total Store: ", allStore.length);
    // console.log(allStore);
    return allStore;
  }
}

export default WithdrawlPaymentEngine;
