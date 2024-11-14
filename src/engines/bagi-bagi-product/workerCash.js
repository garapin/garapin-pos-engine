import workerpool from "workerpool";
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import { splitPaymentRuleIdScheme } from "../../models/splitPaymentRuleIdModel.js";
import Logger from "../../utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";
import { transactionSchema } from "../../models/transactionModel.js";
import axios from "axios";
import { storeSchema } from "../../models/storeModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const XENDIT_API_KEY = process.env.XENDIT_API_KEY;
const XENDIT_URL = "https://api.xendit.co";

const pool = workerpool.pool(path.resolve(__dirname, "routeWorkerCash.js"), {
  minWorkers: "max",
});

const isValidReferenceId = (referenceId) => {
  return /^INV-/.test(referenceId);
};

// Implement the logic that needs to run in a separate thread
const processTransaction = async ({ store, baseUrl, apiKey }) => {
  let storeDatabase = null;

  try {
    const dbname = store.db_name;
    // console.log("xxzxzxzxxz" + dbname);

    storeDatabase = await connectTargetDatabase(dbname);
    const TemplateModel = storeDatabase.model(
      "Split_Payment_Rule_Id",
      splitPaymentRuleIdScheme
    );

    const transactionModel = storeDatabase.model(
      "Transaction",
      transactionSchema
    );
    const storeModel = await storeDatabase
      .model("Store", storeSchema)
      .findOne({});
    const transactions = await transactionModel
      .find({
        bp_settlement_status: "NOT_SETTLED",
        payment_method: "CASH",
        status: "SUCCEEDED",
      })
      .lean();
    // console.log(transactions.length);
    const accountId = storeModel.account_holder.id;

    const balance = await getXenditBalanceById(accountId);
    Logger.log(`Checking balance ${balance.data.balance}`);
    for (const transaction of transactions) {
      if (isValidReferenceId(transaction.invoice)) {
        var itempending = 0;
        // totalPendingAmount += pending.total_with_fee - pending.fee_garapin;
        transaction.product.items.forEach((item) => {
          const total =
            (item.product.cost_price ?? item.product.cost) * item.quantity;
          itempending += total;
        });
        if (itempending > balance.data.balance) {
          Logger.errorLog(
            `Amount is less than balance ${balance.data.balance}`
          );

          continue;
        }

        // xxx;

        try {
          var updatedTransaction = await transactionModel.findOneAndUpdate(
            { invoice: transaction.invoice },
            { bp_settlement_status: "SETTLED" },
            { new: true }
          );
        } catch (error) {
          console.error("Error updating transaction:", error);
        }

        // Logger.errorLog(
        //   "currenttrx",
        //   updatedTransaction.invoice +
        //     " " +
        //     updatedTransaction.bp_settlement_status
        // );

        let listtemplate;
        Logger.log(`transactionssss${transaction.invoice}`);

        listtemplate = await TemplateModel.find({
          name: transaction.invoice,
        }).lean();
        Logger.log(`listtemplatesss${listtemplate.length}`);

        if (listtemplate?.length) {
          Logger.log(
            `Processing invoice Bagi Product ${transaction.invoice} with amount ${transaction.total_with_fee}`
          );

          // Gunakan Promise.all() untuk menjalankan proses secara paralel untuk semua template dan routes
          const routePromises = [];

          for (const template of listtemplate) {
            for (const route of template.routes) {
              if (
                route.destination_account_id !== route.source_account_id ||
                route.destination_account_id !== null
              ) {
                // Klon data secara manual sebelum mengirimnya ke worker thread
                const routeData = JSON.parse(JSON.stringify(route));
                const transactionData = JSON.parse(JSON.stringify(transaction));

                // Tambahkan promise ke dalam array
                const processRoutePromise = pool
                  .exec("processRoute", [
                    {
                      route: routeData,
                      transaction: transactionData,
                      accountId,
                      baseUrl,
                      apiKey,
                    },
                  ])
                  .catch((error) => {
                    // Menangani error masing-masing dalam promise agar tidak mempengaruhi promise lainnya
                    Logger.errorLog(
                      `Error processing route for transaction ${transaction.invoice}: ${error.message || error}`
                    );
                  });

                routePromises.push(processRoutePromise);
              }
            }
          }

          // Tunggu sampai semua route selesai diproses secara paralel
          await Promise.all(routePromises);
        }
      }
    }
  } catch (error) {
    Logger.errorLog("Gagal menghubungkan ke database", error);
  } finally {
    // if (storeDatabase) {
    //   storeDatabase.close(); // Menutup koneksi database
    //   Logger.log("Database connection closed.");
    // }
  }
};

const getXenditBalanceById = async (id) => {
  const url = `${XENDIT_URL}/balance`;
  return axios.get(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(XENDIT_API_KEY + ":").toString(
        "base64"
      )}`,
      "for-user-id": id,
    },
  });
};
// Process the transaction and send the result back to the main thread
workerpool.worker({
  processTransaction: processTransaction,
});
