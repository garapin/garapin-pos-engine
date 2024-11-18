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
import moment from "moment-timezone";
import { templateSchema } from "../../models/templateModel.js";
import { auditTrailSchema } from "../../models/auditTrailModel.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

const processStore = async ({ store, baseUrl, apiKey }) => {
  Logger.log(`Processing store ${store.db_name}`);
  try {
    db = await connectTargetDatabase(store.db_name);
    await getTransactionStoreTypeByDatabase(store.db_name, baseUrl, apiKey);
  } catch (error) {
    Logger.errorLog(
      "processStore Gagal menghubungkan ke database di store worker",
      error
    );
  }
};

const getTransactionStoreTypeByDatabase = async (
  target_database,
  baseUrl,
  apiKey
) => {
  const StoreModelInStoreDatabase = db.model("Store", storeSchema);
  const storeData = await StoreModelInStoreDatabase.find({
    merchant_role: [RouteRole.TRX],
  });

  if (storeData.length > 0) {
    for (const store of storeData) {
      // const balance = await getBalance(store, baseUrl, apiKey);
      // console.log(`Balance store ${store.store_name} Rp ${balance}`);
      await checkListTransaction(target_database, store, baseUrl, apiKey);
    }
  }

  if (target_database === "garapin_pos") {
    Logger.log("Cek ke main DB");

    var store = {
      store_name: "Garapin POS",
      account_holder: {
        id: process.env.XENDIT_ACCOUNT_QUICK_RELEASE,
      },
    };

    // console.log(`Balance store Garapin POS Rp ${balance}`);
    await checkListTransaction(target_database, store, baseUrl, apiKey);
  }
};

const checkListTransaction = async (
  target_database,
  store,
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
      Logger.log(
        "Transaction list is empty for store " +
          store.store_name +
          "db name: " +
          target_database
      );
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
      const balance = await getBalance(store, baseUrl, apiKey);

      transactionList.map(async (transaction) => {
        // Logger.errorLog(
        //   `Balance store: ${target_database} - Transaction total: ${balance} - Transaction total: ${transaction.invoice}`
        // );

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
    Logger.errorLog(
      "checkListTransaction checkListTransactionGagal menghubungkan ke database di store worker",
      error.message + " " + target_database
    );
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

      Logger.log(
        `Total without route TRX: ${totalWithoutRouteTrx} ${transaction.invoice} ${transaction.total_with_fee} ${balance}`
      );

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

        const currentTime = moment().tz("Asia/Jakarta"); // Mengatur zona waktu ke Asia/Jakarta
        const localTime = currentTime.format("HH:mm:ss");
        console.log(`Current local time: ${localTime}`);

        const cutoffTime = moment()
          .tz("Asia/Jakarta")
          .set({ hour: 23, minute: 30, second: 0 }); // Set waktu cutoff menjadi 11.30 PM waktu lokal
        const localCutoffTime = cutoffTime.format("HH:mm:ss");
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
      // updateTransaction(transaction, target_database);
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
    const startTime = new Date();

    await checkAndSplitTransaction(
      route,
      transaction,
      store.account_holder.id,
      baseUrl,
      apiKey,
      target_database,
      store,
      startTime
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
  store,
  startTime
) => {
  try {
    if (
      route.destination_account_id !== store.account_holder.id &&
      route.destination_account_id !== route.source_account_id
    ) {
      const transactionDestination = await fetchTransactionDestination(
        route,
        transaction,
        baseUrl,
        apiKey
      );

      if (transactionDestination.data.data.length === 0) {
        Logger.log(`Sourcesxxx id ${source_user_id}`);
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
          true,
          startTime
        );
      } else {
        Logger.log(`Transaction ${transaction.invoice} has already been split`);
        updateTransaction(transaction, target_database, true);

        Logger.log("Update Transaction main invoice");
        // await updateTransaction(transaction, target_database);
      }
    }

    if (route.role === "TRX" || route.role === "SUPP") {
      console.log("ROLE TRX OR SUPP");
      await checkAndSplitChild(
        route,
        transaction,
        baseUrl,
        apiKey,
        target_database,
        startTime
      );
    }
    return { success: true };
  } catch (error) {
    Logger.errorLog(
      "checkAndSplitTransaction Gagal menghubungkan ke database di store worker",
      target_database
    );
    Logger.errorLog(
      "checkAndSplitTransaction Gagal menghubungkan ke database di store worker",
      error
    );
  }
};

const checkAndSplitChild = async (
  routeX,
  transaction,
  baseUrl,
  apiKey,
  target_database,
  startTime
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
                  false,
                  startTime
                );

                if (route.role === "SUPP") {
                  await checkAndSplitChild(
                    route,
                    transaction,
                    baseUrl,
                    apiKey,
                    target_database,
                    startTime
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
    Logger.errorLog(
      `Gagal menghubungkan ke database ${target_database} di store worker`,
      error
    );
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
  mainTrx,
  startTime
) => {
  const db = await connectTargetDatabase("garapin_pos");
  const AuditTrail = db.model("audit_trail", auditTrailSchema);
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

    const endTime = new Date();
    const executionTime = endTime - startTime;

    if (postTransfer.status === 200) {
      updateTransaction(transaction, target_database, true);

      Logger.log(`Transaction ${transaction.invoice} successfully split`);

      // Cek apakah log audit trail sudah ada
      const existingLog = await AuditTrail.findOne({
        transactionId: transaction.invoice,
        store_name: route.reference_id,
        status: "SUCCESS",
      });

      if (!existingLog) {
        // Simpan log audit trail
        await AuditTrail.create({
          store_name: route.reference_id,
          transactionId: transaction.invoice,
          source_user_id: route.source_account_id,
          destination_user_id: route.destination_account_id,
          status: "SUCCESS",
          message: `Transaction ${transaction.invoice} successfully split`,
          executionTime: executionTime,
          timestamp: endTime,
        });
      }
    } else {
      updateTransaction(transaction, target_database, false);

      Logger.log(`Failed to split transaction ${transaction.invoice}`);

      // Cek apakah log audit trail sudah ada
      const existingLog = await AuditTrail.findOne({
        transactionId: transaction.invoice,
        store_name: route.reference_id,
        status: "FAILED",
      });

      if (!existingLog) {
        // Simpan log audit trail
        await AuditTrail.create({
          store_name: route.reference_id,
          transactionId: transaction.invoice,
          source_user_id: route.source_account_id,
          destination_user_id: route.destination_account_id,
          status: "FAILED",
          message: `Failed to split transaction ${transaction.invoice}`,
          executionTime: executionTime,
          timestamp: endTime,
        });
      }
    }
  } catch (error) {
    updateTransaction(transaction, target_database, false);

    const endTime = new Date();
    const executionTime = endTime - startTime;

    const { response } = error;
    const { request, ...errorObject } = response;

    Logger.errorLog("Error during transaction split", errorObject.data.message);

    // Cek apakah log audit trail sudah ada
    const existingLog = await AuditTrail.findOne({
      transactionId: transaction.invoice,
      store_name: route.reference_id,
      status: "ERROR",
    });

    if (!existingLog) {
      // Simpan log audit trail
      await AuditTrail.create({
        store_name: route.reference_id,
        transactionId: transaction.invoice,
        source_user_id: route.source_account_id,
        destination_user_id: route.destination_account_id,
        status: "ERROR",
        code: errorObject.data.error_code,
        message: `${errorObject.data.message}`,
        executionTime: executionTime,
        timestamp: endTime,
      });
    }
  }
};

const updateTransaction = async (transaction, target_database, success) => {
  Logger.log(
    `Update transaction ${transaction.invoice} for ${target_database}`
  );
  const db = await connectTargetDatabase(target_database);
  const TransactionModel = db.model("Transaction", transactionSchema);
  try {
    const updatedTransaction = await TransactionModel.findOneAndUpdate(
      { invoice: transaction.invoice },
      {
        status: success ? "SUCCEEDED" : "PENDING_TRANSFER",
        settlement_status: success ? "SETTLED" : "NOT_SETTLED",
      },
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getBalance = async (store, baseUrl, apiKey, retryCount = 0) => {
  // Logger.log(`Getting balance for store ${store.store_name}`);
  const url = `${baseUrl}/balance`;
  const maxRetries = 3;
  const baseDelay = 1000;

  try {
    // Logger.errorLog("url balance" + url);
    // Logger.errorLog("apiKey balance" + apiKey);
    // Logger.errorLog("for-user-id balance" + store.account_holder.id);

    const response = await axios.get(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(apiKey + ":").toString("base64")}`,
        "for-user-id": store.account_holder.id,
      },
    });
    return response.data.balance;
  } catch (error) {
    if (error.response?.status === 429 && retryCount < maxRetries) {
      const delay = baseDelay * Math.pow(2, retryCount);

      Logger.log(
        `Rate limited. Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${maxRetries})`
      );

      await sleep(delay);

      return getBalance(store, baseUrl, apiKey, retryCount + 1);
    }

    Logger.errorLog("Error fetching balance", error);
    // Untuk cash transaction, lebih baik throw error karena ini critical operation
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
