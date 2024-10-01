import workerpool from "workerpool";
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import { splitPaymentRuleIdScheme } from "../../models/splitPaymentRuleIdModel.js";
import Logger from "../../utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";
import { Cashflow, SettlementStatus } from "../../config/enums.js";
import { transactionSchema } from "../../models/transactionModel.js";
import { rakTransactionSchema } from "../../models/rakuTransactionModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = workerpool.pool(path.resolve(__dirname, "routeWorker.js"), {
  minWorkers: "max",
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
        storeDatabase = await connectTargetDatabase(store.db_name);

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
            `Processing invoice ${transaction.reference_id} with amount ${transaction.amount}`
          );
          for (const template of listtemplate) {
            for (const route of template.routes) {
              if (
                route.destination_account_id !== route.source_account_id ||
                route.destination_account_id !== null
              ) {
                // Klon data secara manual sebelum mengirimnya ke worker thread
                const routeData = JSON.parse(JSON.stringify(route));
                const transactionData = JSON.parse(JSON.stringify(transaction));
                try {
                  await pool.exec("processRoute", [
                    {
                      route: routeData,
                      transaction: transactionData,
                      accountId,
                      baseUrl,
                      apiKey,
                    },
                  ]);
                } catch (error) {
                  Logger.errorLog(
                    `Error processing route for transaction ${transaction.reference_id}: ${error.message || error}`
                  );
                }
              }
            }
          }
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

// Process the transaction and send the result back to the main thread
workerpool.worker({
  processTransaction: processTransaction,
});
