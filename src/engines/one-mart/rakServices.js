import { DatabaseModel } from "../../models/databaseModel.js";
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import { rakTransactionSchema } from "../../models/rakTransactionModel.js";
import { RakModel, rakSchema } from "../../models/rakModel.js";
import { PositionModel, positionSchema } from "../../models/positionModel.js";
import Logger from "../../utils/logger.js";
import isExpired from "../one-mart/timetools.js";
import mongoose from '../../config/db.js';

import {STATUS_RAK} from "../../models/rakModel.js";
import { STATUS_POSITION } from "../../models/positionModel.js";
class RakServices {
  constructor(parameters) {
   
  }


  async  procesUpdateServices  ()  {
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
    Logger.log("Selesai memperbarui status transaksi RAK pada semua database target...");


    


  }


  updateRakSingleDatabase = async (targetDatabase) => {
   
    const storeDatabase = await connectTargetDatabase(targetDatabase);


    const rakTransactionModelStore = storeDatabase.model(
      "rakTransaction",
      rakTransactionSchema
    );
    const rakModelStore = storeDatabase.model("rak", rakSchema);
    const positionModelStore = storeDatabase.model("position", positionSchema);
  
  
    const pending_transactions = await rakTransactionModelStore.find({ payment_status: "PENDING" }).populate({ path: "list_rak" });
    console.log("checking database: ", targetDatabase);
    pending_transactions.forEach(element => {
      console.log(element.xendit_info.expiryDate);
      const expiryDate =element.xendit_info.expiryDate;
      if (isExpired(expiryDate)) {
        element.payment_status = "EXPIRED";
        element.save();
       element.list_rak.forEach(async (colrak) => {
          const rak = await rakModelStore.findById(colrak.rak);
          const position = await positionModelStore.findById(colrak.position);
          if (rak) {          
            rak.status = "AVAILABLE";
            rak.save();
            position.status ="AVAILABLE";
            position.save();
          }
        });
      }
  
  
  
  
  
       });


  }

}

export default RakServices;