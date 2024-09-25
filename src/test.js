import RakEngine from "./engines/one-mart/rakEngine.js";
import mongoose from "./config/db.js";
import CashPaymentEngine from "./engines/cash-transaction/cashPaymentEngine.js";
import TransactionEngine from "./engines/bagi-bagi-transaction/transactionEngine.js";
import { connectTargetDatabase } from "./config/targetDatabase.js";
import { positionSchema } from "./models/positionModel.js";
import { productSchema } from "./models/productModel.js";
// const rakEngine = new RakEngine();
// rakEngine.checkRakEngine();

// const transactionEngine = new TransactionEngine();
// transactionEngine.processTransactions();

// const cashPaymentEngine = new CashPaymentEngine();
// cashPaymentEngine.checkPaymentCash();

// const storeDatabase = await connectTargetDatabase(
//   "mr-raku-onemart-puri_f59e85d5-1b4"
// );
// const positionModelStore = storeDatabase.model("position", positionSchema);
// const allPos = await positionModelStore.find();

// allPos.forEach((position) => {
//   console.log(position._id);
// });
// const positionModelStore = storeDatabase.model("position", positionSchema);

// const productModelStore = storeDatabase.model("product", productSchema);

// try {
//   const result = await productModelStore.findOne({
//     position_id: {
//       $in: [new mongoose.Types.ObjectId("66ed35eabb588f2a1e1a9656")],
//     },
//   });

//   if (!result) {
//     console.log("No product found with the given position_id");
//   } else {
//     console.log("Product found:", result);
//   }
// } catch (error) {
//   console.error("Error occurred during query execution:", error);
// }
