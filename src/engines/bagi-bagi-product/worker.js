import workerpool from "workerpool";
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import { splitPaymentRuleIdScheme } from "../../models/splitPaymentRuleIdModel.js";
import Logger from "../../utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";
import { Cashflow, SettlementStatus } from "../../config/enums.js";
import { transactionSchema } from "../../models/transactionModel.js";
import { rakTransactionSchema } from "../../models/rakuTransactionModel.js";
import axios from "axios";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const XENDIT_API_KEY = process.env.XENDIT_API_KEY;
const XENDIT_URL = "https://api.xendit.co";

const pool = workerpool.pool(path.resolve(__dirname, "routeWorker.js"), {
  minWorkers: 1,
});

const isValidReferenceId = (referenceId) => {
  return /^INV-/.test(referenceId);
};

// Implement the logic that needs to run in a separate thread
const processTransaction = async ({
  transactions,
  store,
  accountId,
  baseUrl,
  apiKey,
}) => {
  let storeDatabase = null;
  try {
    for (const transaction of transactions) {
      if (
        isValidReferenceId(transaction.reference_id) &&
        transaction.settlement_status === SettlementStatus.SETTLED &&
        transaction.cashflow === Cashflow.MONEY_IN
      ) {
        const dbname = transaction.reference_id.split("&&")[1];
        storeDatabase = await connectTargetDatabase(dbname);

        const RaktransactionModel = storeDatabase.model(
          "rakTransaction",
          rakTransactionSchema
        );
        await RaktransactionModel.updateOne(
          { invoice: transaction.reference_id },
          { settlement_status: "SETTLED" }
        );

        const TemplateModel = storeDatabase.model(
          "Split_Payment_Rule_Id",
          splitPaymentRuleIdScheme
        );

        const transactionModel = storeDatabase.model(
          "Transaction",
          transactionSchema
        );

        var currenttrx = await transactionModel
          .findOne({
            invoice: transaction.reference_id,
            settlement_status: "SETTLED",
            bp_settlement_status: "NOT_SETTLED",
          })
          .lean();

        if (currenttrx === null) {
          // Logger.errorLog("Transaction not found");
          continue;
        }

        const balance = await getXenditBalanceById(accountId);
        if (currenttrx.total_with_fee > balance.data.balance) {
          Logger.errorLog(
            `Amount is less than balance ${balance.data.balance}`
          );

          continue;
        }

        try {
          var updatedTransaction = await transactionModel.findOneAndUpdate(
            { invoice: transaction.reference_id },
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
        Logger.log(`transactionssss${transaction.reference_id}`);

        if (transaction.reference_id.endsWith("&&RAK")) {
          listtemplate = await TemplateModel.find({
            invoice: transaction.reference_id,
          }).lean();
        } else {
          listtemplate = await TemplateModel.find({
            name: transaction.reference_id,
          }).lean();
        }

        Logger.log(`listtemplatesss${listtemplate.length}`);

        if (listtemplate?.length) {
          Logger.log(
            `Processing invoice Bagi Product ${transaction.reference_id} with amount ${transaction.amount}`
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
                      `Error processing route for transaction ${transaction.reference_id}: ${error.message || error}`
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
