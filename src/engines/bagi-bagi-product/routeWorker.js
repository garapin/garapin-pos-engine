import workerpool from "workerpool";
import Logger from "../../utils/logger.js"; // Pastikan jalur dan ekstensi benar
import axios from "axios";
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import { auditTrailSchema } from "../../models/auditTrailModel.js";
import { transactionSchema } from "../../models/transactionModel.js";
import { Invoice } from "xendit-node";
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
        `Routing to ${route.destination_account_id} for transaction ${transaction.reference_id}`
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
    Logger.log(
      `Transaction ${transaction.reference_id} has not been split yet`
    );

    await splitTransaction(
      route,
      transaction,
      accountId,
      baseUrl,
      apiKey,
      startTime
    );
  } else {
    updatedparentTransaction(transaction, "SETTLED");
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
      reference_id: transaction.reference_id + "&&" + route.reference_id,
    },
  });
};
const updatedparentTransaction = async (transaction, status) => {
  const dbname = transaction.reference_id.split("&&")[1];
  const storeDatabase = await connectTargetDatabase(dbname);
  const transactionModel = storeDatabase.model(
    "Transaction",
    transactionSchema
  );
  try {
    const updatedTransaction = await transactionModel.findOneAndUpdate(
      { invoice: transaction.reference_id },
      { bp_settlement_status: status }
    );
    var updatedParentTransaction = await transactionModel.findOneAndUpdate(
      {
        parent_invoice: transaction.reference_id,
        invoice: /^INV/,
      }, // Query to find the document
      { bp_settlement_status: status }, // Update operation
      { returnDocument: "after" } // Return the updated document
    );
  } catch (error) {
    console.error("Error updating transaction:", error);
  }
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
    reference: transaction.reference_id + "&&" + route.reference_id,
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
      Logger.log(`Transaction ${transaction.reference_id} successfully split`);

      // Cek apakah log audit trail sudah ada
      const existingLog = await AuditTrail.findOne({
        transactionId: transaction.reference_id,
        store_name: route.reference_id,
        status: "SUCCESS",
      });

      if (!existingLog) {
        // Simpan log audit trail
        await AuditTrail.create({
          store_name: route.reference_id,
          transactionId: transaction.reference_id,
          source_user_id: route.source_account_id,
          destination_user_id: route.destination_account_id,
          status: "SUCCESS",
          message: `Transaction ${transaction.reference_id} successfully split`,
          executionTime: executionTime,
          timestamp: endTime,
        });
      }
    } else {
      Logger.log(`Failed to split transaction ${transaction.reference_id}`);

      updatedparentTransaction(transaction, "NOT_SETTLED");

      // Cek apakah log audit trail sudah ada
      const existingLog = await AuditTrail.findOne({
        transactionId: transaction.reference_id,
        store_name: route.reference_id,
        status: "FAILED",
      });

      if (!existingLog) {
        // Simpan log audit trail
        await AuditTrail.create({
          store_name: route.reference_id,
          transactionId: transaction.reference_id,
          source_user_id: route.source_account_id,
          destination_user_id: route.destination_account_id,
          status: "FAILED",
          message: `Failed to split transaction ${transaction.reference_id}`,
          executionTime: executionTime,
          timestamp: endTime,
        });
      }
    }
  } catch (error) {
    updatedparentTransaction(transaction, "NOT_SETTLED");

    const endTime = new Date();
    const executionTime = endTime - startTime;

    const { response } = error;
    const { request, ...errorObject } = response;

    Logger.errorLog("Error during transaction split", errorObject.data.message);

    // Cek apakah log audit trail sudah ada
    const existingLog = await AuditTrail.findOne({
      transactionId: transaction.reference_id,
      store_name: route.reference_id,
      status: "ERROR",
    });

    if (!existingLog) {
      // Simpan log audit trail
      await AuditTrail.create({
        store_name: route.reference_id,
        transactionId: transaction.reference_id,
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
  }
};

workerpool.worker({
  processRoute: processRoute,
});
