import { connectTargetDatabase } from "../../config/targetDatabase.js";
import { rakTransactionSchema } from "../../models/rakTransactionModel.js";
import { RakModel, rakSchema } from "../../models/rakModel.js";
import { PositionModel, positionSchema } from "../../models/positionModel.js";
import Logger from "../../utils/logger.js";
import timetools from "../one-mart/timetools.js";
import { configAppSchema } from "../../models/configAppModel.js";
import moment from "moment-timezone";
import workerpool from "workerpool";

import { STATUS_POSITION } from "../../models/positionModel.js";
import { productSchema } from "../../models/productModel.js";

const updateRak = async ({ store }) => {
  Logger.log(`Attempting to update status RAK on ${store.db_name}`, "INFO");

  try {
    const storeDatabase = await connectTargetDatabase(store.db_name);

    const confModel = storeDatabase.model("config_app", configAppSchema);
    const configApp = await confModel.findOne();

    const productModelStore = storeDatabase.model("product", productSchema);
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
    console.log(alltransaction);

    alltransaction.forEach((element) => {
      element.list_rak.forEach(async (colrak) => {
        const position = await positionModelStore.findById(colrak.position);
        Logger.log("end_datex" + position.end_date);

        if (timetools.isExpired(position.end_date)) {
          if (position.end_date) {
            await productModelStore.updateMany(
              { position_id: position._id },
              { $set: { status: "DELETED" } }
            );

            position.status = STATUS_POSITION.AVAILABLE;
            position.available_date = today;
            position.start_date = null;
            position.end_date = null;
          }
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
    });
  } catch (error) {
    Logger.error(`Failed to connect or update ${store}:`, error);
  }

  Logger.log(`Finished updating RAK status on ${store}`, "INFO");
};
workerpool.worker({
  updateRak: updateRak,
});
