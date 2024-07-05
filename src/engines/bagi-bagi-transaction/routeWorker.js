import workerpool from 'workerpool';
import Logger from "../../utils/logger.js"; // Pastikan jalur dan ekstensi benar
import { ChannelCategory, RouteRole } from "../../config/enums.js";
import axios from "axios";
import { ConfigTransactionModel, configTransactionSchema } from '../../models/configTransaction.js';
import { connectTargetDatabase } from '../../config/targetDatabase.js';

const processRoute = async ({ route, transaction, accountId, baseUrl, apiKey }) => {
  if (!route || !transaction) {
    throw new Error("Route or transaction data is missing");
  }

  try {
    Logger.log(
      `Routing to ${route.destination_account_id} for transaction ${transaction.reference_id}`
    );

    // Implementasi pemrosesan route
    await checkAndSplitTransaction(route, transaction, accountId, baseUrl, apiKey);
    return { success: true };
  } catch (error) {
    return { error: error.message };
  }
};

const checkAndSplitTransaction = async (route, transaction, accountId, baseUrl, apiKey) => {
  const transactionDestination = await fetchTransactionDestination(
    route, transaction, baseUrl, apiKey
  );
  if (transactionDestination.data.data.length === 0) {
    Logger.log(
      `Transaction ${transaction.reference_id} has not been split yet`
    );
    await splitTransaction(route, transaction, accountId, baseUrl, apiKey);
  } else {
    Logger.log(
      `Transaction ${transaction.reference_id} has already been split`
    );
  }
};

const fetchTransactionDestination = async (route, transaction, baseUrl, apiKey) => {
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
    const ConfigTransaction = db.model("config_transaction", configTransactionSchema);
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
    const ConfigTransaction = db.model("config_transaction", configTransactionSchema);
    const configTransaction = await ConfigTransaction.findOne({
      type: "VA",
    });

    const feeBank = configTransaction.fee_flat;
    const vat = Math.round(feeBank * (configTransaction.vat_percent / 100));
    totalFee = feeBank + vat;
    return totalFee;
  }
}

const splitTransaction = async (route, transaction, accountId, baseUrl, apiKey) => {
  // const totalFee = transaction.fee.xendit_fee + transaction.fee.value_added_tax;
  var totalFee = 0;

  if (transaction.fee.status === "PENDING") {
    totalFee = await calculateFee(transaction);
  } else {
    totalFee = transaction.fee.xendit_fee + transaction.fee.value_added_tax;
  }

  const transferBody = {
    amount:
      route.role === RouteRole.TRX
        ? route.flat_amount - totalFee
        : route.flat_amount,
    source_user_id: accountId,
    destination_user_id: route.destination_account_id,
    reference: transaction.reference_id + "&&" + route.reference_id,
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
      Logger.log(`Transaction ${transaction.reference_id} successfully split`);
    } else {
      Logger.log(`Failed to split transaction ${transaction.reference_id}`);
    }
  } catch (error) {
    Logger.errorLog("Error during transaction split", error);
  }
};

workerpool.worker({
  processRoute: processRoute
});
