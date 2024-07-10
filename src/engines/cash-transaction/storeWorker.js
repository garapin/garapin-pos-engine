import workerpool from "workerpool";
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import Logger from "../../utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";
import { storeSchema } from "../../models/storeModel.js";
import { transactionSchema } from "../../models/transactionModel.js";
import axios from "axios";
import { splitPaymentRuleIdScheme } from "../../models/splitPaymentRuleIdModel.js";
import { RouteRole, StatusStore } from "../../config/enums.js";
import moment from 'moment-timezone';
import { templateSchema } from "../../models/templateModel.js";

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
    merchant_role: [RouteRole.TRX, RouteRole.NOT_MERCHANT],
  });

  if (storeData.length > 0) {
    for (const store of storeData) {
      const balance = await getBalance(store, baseUrl, apiKey);
      console.log(`Balance store ${store.store_name} Rp ${balance}`);
      await checkListTransaction(
        target_database,
        store,
        balance,
        baseUrl,
        apiKey
      );
    }
  }
};

const checkListTransaction = async (
  target_database,
  store,
  balance,
  baseUrl,
  apiKey
) => {
  try {
    Logger.log(`Checking transaction for store ${store.store_name}`);
    const StoreModelInStoreDatabase = db.model("Store", storeSchema);
    // Check Transaction List
    const TransactionModel = db.model("Transaction", transactionSchema);
    const transactionList = await TransactionModel.find({
      status: "PENDING_TRANSFER",
      payment_method: "CASH",
    });

    if (transactionList.length === 0) {
      Logger.log("Transaction list is empty");
      if (
        store.store_status === StatusStore.PENDING_ACTIVE ||
        store.store_status === StatusStore.LOCKED
      ) {
        Logger.log("Update store status to ACTIVE");
        await StoreModelInStoreDatabase.findOneAndUpdate(
          { merchant_role: [RouteRole.TRX, RouteRole.NOT_MERCHANT] },
          { $set: { store_status: StatusStore.ACTIVE } }
        ).lean();
      }
    }

    if (transactionList.length > 0) {
      transactionList.map(async (transaction) => {
        Logger.log(
          `Balance store: ${balance} - Transaction total: ${transaction.total_with_fee}`
        );

        await processSplitTransactionCash(
          transaction,
          balance,
          store,
          baseUrl,
          apiKey,
          target_database
        );
      });
    }
  } catch (error) {
    Logger.errorLog("Gagal menghubungkan ke database di store worker", error);
    return { error: error.message };
  }
};

const processSplitTransactionCash = async (
  transaction,
  balance,
  store,
  baseUrl,
  apiKey,
  target_database
) => {
  Logger.log(`Processing transaction ${transaction.invoice}`);
  try {
    const StoreModelInStoreDatabase = db.model("Store", storeSchema);

    const TemplateModel = db.model(
      "Split_Payment_Rule_Id",
      splitPaymentRuleIdScheme
    );

    const template = await TemplateModel.findOne({
      invoice: transaction.invoice,
    });

    if (template) {
      // Calculate total without route route.destination_account_id !== store.account_holder.id
      const totalWithoutRouteTrx =
        transaction.total_with_fee -
        template.routes.reduce((acc, route) => {
          if (route.destination_account_id === route.source_account_id) {
            return acc + route.flat_amount;
          }
          return acc;
        }, 0);

      Logger.log(`Total without route TRX: ${totalWithoutRouteTrx}`);
      Logger.log(`Balance: ${balance}`);

      if (balance >= totalWithoutRouteTrx) {
        template.routes.map(async (route) => {
          await processRouteInvoice(
            transaction,
            balance,
            store,
            route,
            baseUrl,
            apiKey,
            target_database
          );
        });
      } else {
        Logger.log(
          `Store ${store.account_holder.id} has no balance for transaction ${transaction.invoice}`
        );

        const currentTime = moment().tz('Asia/Jakarta'); // Mengatur zona waktu ke Asia/Jakarta
        const localTime = currentTime.format('HH:mm:ss');
        console.log(`Current local time: ${localTime}`);
  
        const cutoffTime = moment().tz('Asia/Jakarta').set({ hour: 23, minute: 30, second: 0 }); // Set waktu cutoff menjadi 11.30 PM waktu lokal
        const localCutoffTime = cutoffTime.format('HH:mm:ss');
        console.log(`Cutoff local time: ${localCutoffTime}`);
        if (
          currentTime.isAfter(cutoffTime) &&
          store.store_status === StatusStore.ACTIVE
        ) {
          Logger.log(
            "Waktu sudah melebihi 11.30 PM, update store status to LOCKED."
          );
          await StoreModelInStoreDatabase.findOneAndUpdate(
            { merchant_role: [RouteRole.TRX, RouteRole.NOT_MERCHANT] },
            { $set: { store_status: StatusStore.LOCKED } }
          ).lean();
        }
      }
    } else {
      Logger.log(`This store not have template ${transaction.invoice}`);
      updateTransaction(transaction, target_database);
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
      target_database,
      store
    );
    return { success: true };
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
  target_database,
  store
) => {
  try {
    if (route.destination_account_id !== store.account_holder.id) {
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
          target_database,
          true
        );
      } else {
        Logger.log(`Transaction ${transaction.invoice} has already been split`);
        Logger.log("Update Transaction main invoice");
        await updateTransaction(transaction, target_database);
      }
    }

    if (route.role === "TRX" || route.role === "SUPP") {
      console.log("ROLE TRX OR SUPP");
      await checkAndSplitChild(
        route,
        transaction,
        baseUrl,
        apiKey,
        target_database
      );
    }
    return { success: true };
  } catch (error) {
    Logger.errorLog("Gagal menghubungkan ke database di store worker", error);
  }
};

const checkAndSplitChild = async (
  routeX,
  transaction,
  baseUrl,
  apiKey,
  target_database
) => {
  let db = null;
  try {
    console.log("Ini Reference untuk child");
    console.log(routeX.reference_id);
    db = await connectTargetDatabase(routeX.reference_id);

    const Template = db.model("Template", templateSchema);
    const template = await Template.findOne({});

    if (template !== null && template.status_template === "ACTIVE") {
      for (const route of template.routes) {
        if (route.type === "SUPP") {
          const dbSplit = await connectTargetDatabase(route.reference_id);
          const SplitModel = dbSplit.model(
            "Split_Payment_Rule_Id",
            splitPaymentRuleIdScheme
          );
          const splitData = await SplitModel.findOne({
            invoice: transaction.invoice,
          });

          if (splitData) {
            Logger.log(
              `Routing to SUPP ${route.destination_account_id} for transaction ${transaction.invoice}`
            );
            for (const route of splitData.routes) {
              if (route.role === "SUPP" || route.role === "FEE") {
                Logger.log(route);
                Logger.log(
                  `Routing to Child SUPP ${route.destination_account_id} for transaction ${transaction.invoice}`
                );
                console.log(route.source_account_id);
                await splitTransaction(
                  route,
                  transaction,
                  route.source_account_id,
                  baseUrl,
                  apiKey,
                  target_database,
                  false
                );

                if (route.role === "SUPP") {
                  await checkAndSplitChild(
                    route,
                    transaction,
                    baseUrl,
                    apiKey,
                    target_database
                  );
                }
              }
            }
          }
        }
      }
    }
    return { success: true };
  } catch (error) {
    Logger.errorLog("Gagal menghubungkan ke database di store worker", error);
  } finally {
    // if (db) {
    //   db.close(); // Menutup koneksi database
    //   Logger.log("Database connection closed in worker.");
    // }
  }
};

const splitTransaction = async (
  route,
  transaction,
  source_user_id,
  baseUrl,
  apiKey,
  target_database,
  mainTrx
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
      
      Logger.log("Update Transaction main invoice");
      await updateTransaction(transaction, target_database);
    } else {
      Logger.log(
        `Failed to split transaction ${transaction.invoice + "&&" + route.reference_id}`
      );
    }
    return { success: true };
  } catch (error) {
    Logger.errorLog("Error during transaction split", error);
  }
};

const updateTransaction = async (transaction, target_database) => {
  Logger.log(`Update transaction ${transaction.invoice} for ${target_database}`);
  const db = await connectTargetDatabase(target_database);
  const TransactionModel = db.model("Transaction", transactionSchema);
  try {
    const updatedTransaction = await TransactionModel.findOneAndUpdate(
      { invoice: transaction.invoice },
      { status: "SUCCEEDED" },
      { new: true } // Mengembalikan dokumen yang diperbarui
    );
    if (updatedTransaction) {
      Logger.log("Transaction successfully updated");
      Logger.log(updatedTransaction);
    } else {
      Logger.log("Transaction not found or not updated");
      Logger.log(updatedTransaction);
    }
  } catch (error) {
    Logger.errorLog("Error updating transaction", error);
  }
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
  processStore: processStore,
});
