import workerpool from 'workerpool';
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import { splitPaymentRuleIdScheme } from "../../models/splitPaymentRuleIdModel.js";
import Logger from "../../utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";
import { Cashflow, SettlementStatus } from "../../config/enums.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = workerpool.pool(path.resolve(__dirname, 'routeWorker.js'), { minWorkers: 'max' });

const isValidReferenceId = (referenceId) => {
  return /^INV-/.test(referenceId);
};

// Implement the logic that needs to run in a separate thread
const processTransaction = async ({ transaction, accountId, baseUrl, apiKey }) => {
  if (
    isValidReferenceId(transaction.reference_id) &&
    transaction.settlement_status === SettlementStatus.SETTLED &&
    transaction.cashflow === Cashflow.MONEY_IN
  ) {
    Logger.log(
      `Processing invoice ${transaction.reference_id} with amount ${transaction.amount}`
    );
    await handleSettledTransaction(transaction, accountId, baseUrl, apiKey);
  }
  return transaction;
};

const handleSettledTransaction = async (transaction, accountId, baseUrl, apiKey) => {
  const referenceId = transaction.reference_id;
  const parts = referenceId.split("&&");
  const databasePart = parts[1];
  let storeDatabase = null;

  try {
    storeDatabase = await connectTargetDatabase(databasePart);
    const TemplateModel = storeDatabase.model(
      "Split_Payment_Rule_Id",
      splitPaymentRuleIdScheme
    );

    const template = await TemplateModel.findOne({
      invoice: transaction.reference_id,
    }).lean();

    const routePromises = template.routes.map((route) => {
      if (route.destination_account_id !== accountId) {
        // Klon data secara manual sebelum mengirimnya ke worker thread
        const routeData = JSON.parse(JSON.stringify(route));
        const transactionData = JSON.parse(JSON.stringify(transaction));
        return pool.exec('processRoute', [{ route: routeData, transaction: transactionData, accountId, baseUrl, apiKey }]);
      }
    });

    await Promise.all(routePromises);
  } catch (error) {
    Logger.errorLog("Gagal menghubungkan ke database", error);
  } finally {
    if (storeDatabase) {
      storeDatabase.close(); // Menutup koneksi database
      Logger.log("Database connection closed.");
    }
  }
};

// Process the transaction and send the result back to the main thread
workerpool.worker({
  processTransaction: processTransaction
});
