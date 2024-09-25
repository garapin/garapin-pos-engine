import workerpool from "workerpool";
import Logger from "../../utils/logger.js"; // Pastikan jalur dan ekstensi benar
import { ChannelCategory, RouteRole } from "../../config/enums.js";
import axios from "axios";
import {
  ConfigTransactionModel,
  configTransactionSchema,
} from "../../models/configTransaction.js";
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import { auditTrailSchema } from "../../models/auditTrailModel.js";

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
    if (route.destination_account_id !== null) {
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

const calculateFee = async (transaction) => {
  const db = await connectTargetDatabase("garapin_pos");

  if (transaction.channel_category === ChannelCategory.QR) {
    const ConfigTransaction = db.model(
      "config_transaction",
      configTransactionSchema
    );
    const configTransaction = await ConfigTransaction.findOne({
      type: "QRIS",
    });

    var totalFee = 0;
    const feeBank = Math.floor(
      transaction.amount * (configTransaction.fee_percent / 100)
    );
    const vat = Math.floor(feeBank * (configTransaction.vat_percent / 100));
    totalFee = feeBank + vat;
    return totalFee;
  } else {
    const ConfigTransaction = db.model(
      "config_transaction",
      configTransactionSchema
    );
    const configTransaction = await ConfigTransaction.findOne({
      type: "VA",
    });

    const feeBank = configTransaction.fee_flat;
    const vat = Math.round(feeBank * (configTransaction.vat_percent / 100));
    totalFee = feeBank + vat;
    return totalFee;
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

  var totalFee = 0;

  if (transaction.fee.status === "PENDING") {
    totalFee = route.totalFee;
  } else {
    totalFee = transaction.fee.xendit_fee + transaction.fee.value_added_tax;
  }

  const transferBody = {
    amount: route.flat_amount - totalFee,
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
  }
};

workerpool.worker({
  processRoute: processRoute,
});
