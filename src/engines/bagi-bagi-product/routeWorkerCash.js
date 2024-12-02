import workerpool from "workerpool";
import Logger from "../../utils/logger.js"; // Pastikan jalur dan ekstensi benar
import axios from "axios";
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import { auditTrailSchema } from "../../models/auditTrailModel.js";
import { transactionSchema } from "../../models/transactionModel.js";

const processRoute = async ({
  route,
  transaction,
  accountId,
  baseUrl,
  apiKey,
}) => {
  if (!route || !transaction) {
    throw new Error("Route or transaction data is missing");
  }

  const startTime = new Date();

  try {
    if (
      route.destination_account_id !== null &&
      route.source_account_id !== route.destination_account_id
    ) {
      Logger.log(
        `Routing to ${route.destination_account_id} for transaction ${transaction.invoice}`
      );

      // Implementasi pemrosesan route
      await checkAndSplitTransaction(
        route,
        transaction,
        accountId,
        baseUrl,
        apiKey,
        startTime // Tambahkan startTime sebagai parameter
      );
    }
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
};

const checkAndSplitTransaction = async (
  route,
  transaction,
  accountId,
  baseUrl,
  apiKey,
  startTime
) => {
  const transactionDestination = await fetchTransactionDestination(
    route,
    transaction,
    baseUrl,
    apiKey
  );
  if (transactionDestination.data.data.length === 0) {
    Logger.log(`Transaction ${transaction.invoice} has not been split yet`);

    await splitTransaction(
      route,
      transaction,
      accountId,
      baseUrl,
      apiKey,
      startTime
    );
  } else {
    updatedTransaction(transaction, "SETTLED");

    Logger.log(`Transaction ${transaction.invoice} has been split`);
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

const splitTransaction = async (
  route,
  transaction,
  accountId,
  baseUrl,
  apiKey,
  startTime
) => {
  const db = await connectTargetDatabase("garapin_pos");
  const AuditTrail = db.model("audit_trail", auditTrailSchema);

  // var totalFee = 0;

  // if (transaction.fee.status === "PENDING") {
  //   totalFee = route.totalFee;
  // } else {
  //   totalFee = transaction.fee.xendit_fee + transaction.fee.value_added_tax;
  // }

  const transferBody = {
    amount: route.flat_amount - route.fee - route.totalFee, // tidak perlu dikurang fee karna flat_amount sudah dikurangi fee
    source_user_id: route.source_account_id,
    destination_user_id: route.destination_account_id,
    reference: transaction.invoice + "&&" + route.reference_id,
  };

  Logger.log(`Transfer body: ${JSON.stringify(transferBody, null, 2)}`);

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
      updatedTransaction(transaction, "SETTLED");

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
      updatedTransaction(transaction, "NOT_SETTLED");

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
    updatedTransaction(transaction, "NOT_SETTLED");
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
  } finally {
    db.close();
  }
};

const updatedTransaction = async (transaction, status) => {
  let storeDatabase;
  try {
    const dbname = transaction.invoice.split("&&")[1];
    storeDatabase = await connectTargetDatabase(dbname);

    const transactionModel = storeDatabase.model(
      "Transaction",
      transactionSchema
    );
    var updatedTsransaction = await transactionModel.findOneAndUpdate(
      { invoice: transaction.invoice },
      { bp_settlement_status: status },
      { new: true }
    );
    const parenttrx = await transactionModel.findOneAndUpdate(
      { parent_invoice: transaction.invoice },
      { bp_settlement_status: status }
    );
  } catch (error) {
    console.error("Error updating transaction:", error);
  } finally {
    await storeDatabase.close();
    // workerpool.terminate();
  }
};
workerpool.worker({
  processRoute: processRoute,
});
