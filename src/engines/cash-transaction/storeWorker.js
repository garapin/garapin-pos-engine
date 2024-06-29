import workerpool from "workerpool";
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import Logger from "../../utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";
import { storeSchema } from "../../models/storeModel.js";
import { transactionSchema } from "../../models/transactionModel.js";
import axios from "axios";
import { splitPaymentRuleIdScheme } from "../../models/splitPaymentRuleIdModel.js";
import { StatusStore } from "../../config/enums.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

const processStore = async ({ store, baseUrl, apiKey }) => {
  Logger.log(`Processing store ${store.db_name}`);
  try {
    db = await connectTargetDatabase(store.db_name);
    await getTransactionStoreTypeByDatabase(store.db_name, baseUrl, apiKey);
  } catch (error) {
    Logger.errorLog("Gagal menghubungkan ke database di store worker", error);
  }
};

const getTransactionStoreTypeByDatabase = async (
  target_database,
  baseUrl,
  apiKey
) => {
  const StoreModelInStoreDatabase = db.model("Store", storeSchema);
  const storeData = await StoreModelInStoreDatabase.find({
    merchant_role: "TRX",
  });

  if (storeData.length > 0) {
    for (const store of storeData) {
      const balance = await getBalance(store, baseUrl, apiKey);
      await checkListTransaction(target_database, store, balance, baseUrl, apiKey);
    }
  }
};

const checkListTransaction = async (target_database, store, balance, baseUrl, apiKey) => {
  try {
    Logger.log(`Checking transaction for store ${store.store_name}`);
    const StoreModelInStoreDatabase = db.model("Store", storeSchema);

    // Check Transaction List
    const TransactionModel = db.model("Transaction", transactionSchema);
    const transactionList = await TransactionModel.find({
      status: "PENDING_TRANSFER",
      payment_method: "CASH",
    });

    /// Cek jika jam sudah melebihi jam 11.30 PM
    const currentTime = new Date();
    const cutoffTime = new Date();
    cutoffTime.setHours(23, 30, 0); // Set waktu cutoff menjadi 11.30 PM
    if (currentTime > cutoffTime) {
      await StoreModelInStoreDatabase.findOneAndUpdate(
        { merchant_role: RouteRole.TRX },
        { $set: { store_status: StatusStore.LOCKED } }
      ).lean();

      Logger.log(
        "Waktu sudah melebihi 11.30 PM, update store status to LOCKED."
      );
    }

    if (transactionList.length === 0) {
      if (
        store.store_status === StatusStore.PENDING_ACTIVE ||
        store.store_status === StatusStore.LOCKED
      ) {
        await StoreModelInStoreDatabase.findOneAndUpdate(
          { merchant_role: RouteRole.TRX },
          { $set: { store_status: StatusStore.ACTIVE } }
        ).lean();
      }
    }

    if (transactionList.length > 0) {
      transactionList.map(async (transaction) => {
        Logger.log(
          `Balance store: ${balance} - Transaction total: ${transaction.total_with_fee}`
        );

        if (balance >= transaction.total_with_fee) {
          await processSplitTransactionCash(transaction, balance, store, baseUrl, apiKey, target_database);
        } else {
          Logger.log(
            `Store ${store.account_holder.id} has no balance for transaction ${transaction.invoice}`
          );
        }
      });
    }

    return { success: true };
  } catch (error) {
    Logger.errorLog("Gagal menghubungkan ke database di store worker", error);
    return { error: error.message };
  }
};

const processSplitTransactionCash = async (transaction, balance, store, baseUrl, apiKey, target_database) => {
  Logger.log(`Processing transaction ${transaction.invoice}`);
  try {
    const TemplateModel = db.model(
      "Split_Payment_Rule_Id",
      splitPaymentRuleIdScheme
    );

    const template = await TemplateModel.findOne({
      invoice: transaction.invoice,
    });

    if (template) {
      template.routes.map(async (route) => {
        await processRouteInvoice(transaction, balance, store, route, baseUrl, apiKey, target_database);
      });
    }
  } catch (error) {
    Logger.errorLog("Error fetching template", error);
  }
};

const processRouteInvoice = async (
  transaction,
  balance,
  store,
  route,
  baseUrl,
  apiKey,
  target_database
) => {
  Logger.log(route.destination_account_id);
  try {
    if (route.destination_account_id !== store.account_holder.id) {
      Logger.log(
        `Routing to ${route.destination_account_id} for transaction ${transaction.invoice}`
      );
      Logger.log(
        `Store ${store.account_holder.id} has enough balance Rp ${balance} for transaction ${transaction.invoice} Rp ${transaction.total_with_fee}`
      );

      await checkAndSplitTransaction(
        route,
        transaction,
        store.account_holder.id,
        baseUrl,
        apiKey,
        target_database
      );
      return { success: true };
    }
  } catch (error) {
    Logger.errorLog("Error during transaction split", error);
    return { success: false };
  }
};

const checkAndSplitTransaction = async (
  route,
  transaction,
  source_user_id,
  baseUrl,
  apiKey,
  target_database
) => {
  try {
    const transactionDestination = await fetchTransactionDestination(
      route,
      transaction,
      baseUrl,
      apiKey
    );

    if (transactionDestination.data.data.length === 0) {
      Logger.log(`Sources id ${source_user_id}`);
      Logger.log(
        `Transaction ${transaction.invoice + "&&" + route.reference_id} has not been split yet`
      );
      await splitTransaction(
        route,
        transaction,
        source_user_id,
        baseUrl,
        apiKey,
        target_database
      );
    } else {
      Logger.log(`Transaction ${transaction.invoice} has already been split`);
    }
  } catch (error) {
    Logger.errorLog("Gagal menghubungkan ke database di store worker", error);
  } finally {
    if (db) {
      db.close(); // Menutup koneksi database
      Logger.log("Database connection closed in worker.");
    }
  }
};

const splitTransaction = async (
  route,
  transaction,
  source_user_id,
  baseUrl,
  apiKey,
  target_database
) => {
  const transferBody = {
    amount: route.flat_amount,
    source_user_id: source_user_id,
    destination_user_id: route.destination_account_id,
    reference: transaction.invoice + "&&" + route.reference_id,
  };

  try {
    const postTransfer = await axios.post(
      `${baseUrl}/transfers`,
      transferBody,
      {
        headers: {
          Authorization: `Basic ${Buffer.from(apiKey + ":").toString("base64")}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (postTransfer.status === 200) {
      Logger.log(
        `Transaction ${transaction.invoice + "&&" + route.reference_id} successfully split`
      );
      updateTransaction(transaction, target_database);
    } else {
      Logger.log(
        `Failed to split transaction ${transaction.invoice + "&&" + route.reference_id}`
      );
    }
  } catch (error) {
    Logger.errorLog("Error during transaction split", error);
  } finally {
    if (db) {
      db.close(); // Menutup koneksi database
      Logger.log("Database connection closed in worker.");
    }
  }
};

const updateTransaction = async (transaction) => {
  const TransactionModel = db.model("Transaction", transactionSchema);
  await TransactionModel.updateOne(
    { invoice: transaction.invoice },
    { status: "SUCCEEDED" }
  ).lean();
};

const getBalance = async (store, baseUrl, apiKey) => {
  const url = `${baseUrl}/balance`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(apiKey + ":").toString("base64")}`,
        "for-user-id": store.account_holder.id,
      },
    });
    return response.data.balance; // Hanya kirim data yang diperlukan
  } catch (error) {
    Logger.errorLog("Error fetching balance", error);
    throw error;
  }
};

const fetchTransactionDestination = async (
  route,
  transaction,
  baseUrl,
  apiKey
) => {
  const url = `${baseUrl}/transactions`;
  return axios.get(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(apiKey + ":").toString("base64")}`,
      "for-user-id": route.destination_account_id,
    },
    params: {
      reference_id: transaction.invoice + "&&" + route.reference_id,
    },
  });
};

workerpool.worker({
  processStore: processStore
});