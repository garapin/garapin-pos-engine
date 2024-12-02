import workerpool from "workerpool";
import { connectTargetDatabase } from "../../config/targetDatabase.js";
import Logger from "../../utils/logger.js";
import path from "path";
import { fileURLToPath } from "url";
import { storeSchema } from "../../models/storeModel.js";
import { transactionSchema } from "../../models/transactionModel.js";
import axios from "axios";
import { splitPaymentRuleIdScheme } from "../../models/splitPaymentRuleIdModel.js";
import { templateSchema } from "../../models/templateModel.js";
import { auditTrailSchema } from "../../models/auditTrailModel.js";
import nodemailer from "nodemailer";
import { withdrawSchema } from "../../models/withdrawMpdel.js";
import Bottleneck from "bottleneck";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db = null;

const garapinPosStore = {
  store_name: "Garapin POS",
  account_holder: {
    id: process.env.XENDIT_ACCOUNT_QUICK_RELEASE,
  },
};

const limiter = new Bottleneck({
  minTime: 1000, // Set minimum time between requests to 1 second
  maxConcurrent: 1, // Allow only one request at a time
});

const processStoreWithdrawl = async ({ store, baseUrl, apiKey }) => {
  Logger.log(`Processing store ${store.db_name}`);
  try {
    db = await connectTargetDatabase(store.db_name);
    await getTransactionStoreTypeByDatabase(store.db_name, baseUrl, apiKey);
  } catch (error) {
    Logger.errorLog(
      "Gagal processStoreWithdrawl menghubungkan ke database di store worker",
      error
    );
  }
};

const getTransactionStoreTypeByDatabase = async (
  target_database,
  baseUrl,
  apiKey
) => {
  await checkListTransaction(target_database, garapinPosStore, baseUrl, apiKey);
  // const StoreModelInStoreDatabase = db.model("Store", storeSchema);
  // const storeData = await StoreModelInStoreDatabase.find({});

  // if (storeData.length > 0) {
  //   for (const store of storeData) {
  //     // Logger.log(`Balance store XENDIT QUICK RELEASE Rp ${balance}`);
  //     await checkListTransaction(
  //       target_database,
  //       garapinPosStore,
  //       baseUrl,
  //       apiKey
  //     );
  //     // Logger.log(`store.db_name ${store}`);
  //   }
  // }
};

const checkListTransaction = async (
  target_database,
  store,
  baseUrl,
  apiKey
) => {
  try {
    // Check Transaction List
    const TransactionModel = db.model("Transaction", transactionSchema);
    const transactionList = await TransactionModel.find({
      settlement_status: "PENDING_WITHDRAWL",
      status: "PENDING",
    });

    Logger.log(`Transaction list length: ${transactionList.length}`);

    if (transactionList.length > 0) {
      const balance = await getBalance(garapinPosStore, baseUrl, apiKey);
      transactionList.map(async (transaction) => {
        Logger.log(
          `Balance store: ${balance} - Transaction total: ${transaction.total_with_fee}`
        );

        await processSplitTransactionCash(
          target_database,
          transaction,
          balance,
          store,
          baseUrl,
          apiKey
        );
      });
    } else {
      Logger.log(`No transaction found `);
    }
  } catch (error) {
    Logger.errorLog(
      "Gagal checkListTransaction menghubungkan ke database di store worker",
      error
    );
    return { error: error.message };
  }
};

const processSplitTransactionCash = async (
  target_database,
  transaction,
  balance,
  store,
  baseUrl,
  apiKey
) => {
  const db = await connectTargetDatabase("garapin_pos");
  const AuditTrail = db.model("audit_trail", auditTrailSchema);

  Logger.log(`Processing transaction ${transaction.invoice}`);
  try {
    const dbTarget = await connectTargetDatabase(target_database);
    Logger.log(`Processingxxtransaction ${transaction.invoice}`);
    const TemplateModel = dbTarget.model(
      "Split_Payment_Rule_Id",
      splitPaymentRuleIdScheme
    );

    const MyStore = dbTarget.model("Store", storeSchema);
    const myStore = await MyStore.findOne({});

    const template = await TemplateModel.findOne({
      invoice: transaction.invoice,
    });

    if (template) {
      // Calculate total without route route.destination_account_id !== store.account_holder.id
      const totalTransaction = transaction.total_with_fee;

      // Hitung total fee untuk non-garapin terlebih dahulu
      const totalNonGarapinFee = template.routes.reduce((total, route) => {
        if (route.target !== "garapin") {
          return total + route.totalFee;
        }
        return total;
      }, 0);

      Logger.log(`Total transaction: ${totalTransaction}`);
      Logger.log(
        `Balance: ${balance} - Total transaction: ${totalNonGarapinFee}`
      );

      if (balance >= totalTransaction) {
        template.routes.map(async (route) => {
          await processRouteInvoice(
            transaction,
            balance,
            store,
            route,
            baseUrl,
            apiKey,
            target_database,
            myStore,
            totalNonGarapinFee
          );
        });
      } else {
        Logger.log(
          `Store ${store.account_holder.id} has no balance for transaction ${transaction.invoice}`
        );

        const endTime = new Date();
        const startTime = new Date();
        const executionTime = endTime - startTime;

        const existingLog = await AuditTrail.findOne({
          transactionId: transaction.invoice,
          store_name: store.store_name,
          status: "FAILED",
        });

        if (!existingLog) {
          await AuditTrail.create({
            store_name: store.store_name,
            transactionId: transaction.invoice,
            source_user_id: "undefined",
            destination_user_id: "undefined",
            status: "FAILED",
            message: `Store ${store.account_holder.id} has no balance for transaction ${transaction.invoice}`,
            executionTime: executionTime,
            timestamp: endTime,
          });

          const htmlContent = htmlContentFailed(transaction, myStore, balance);

          await sendNodeMailer(
            process.env.RECEIVER_EMAIL,
            "[FAILED] - Gagal Quick Release Dana Pending",
            htmlContent
          );
        }
      }
    } else {
      Logger.log(`This store not have template ${transaction.invoice}`);
      updateTransaction(transaction, target_database, myStore);
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
  target_database,
  myStore,
  totalNonGarapinFee
) => {
  Logger.log(route.destination_account_id);
  try {
    Logger.log(
      `Routing to ${route.destination_account_id} for transaction ${transaction.invoice}`
    );

    await checkAndSplitTransaction(
      route,
      transaction,
      store.account_holder.id,
      baseUrl,
      apiKey,
      target_database,
      store,
      balance,
      myStore,
      totalNonGarapinFee
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
  balance,
  myStore,
  totalNonGarapinFee
) => {
  Logger.log("MASSUK CHECK AND SPLIT TRANSACTION");

  try {
    if (route.destination_account_id !== store.account_holder.id) {
      Logger.log("MASUK IF");
      const transactionDestination = await fetchTransactionDestination(
        route,
        transaction,
        baseUrl,
        apiKey
      );

      Logger.log("INI TRANSACTION DESTINATION");
      Logger.log(transactionDestination.data.data.length);

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
          true,
          store,
          balance,
          myStore,
          totalNonGarapinFee
        );
      } else {
        Logger.log(`Transaction ${transaction.invoice} has already been split`);
        Logger.log("Update Transaction main invoice");

        await updateTransaction(transaction, target_database, myStore);
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
        store,
        balance,
        myStore,
        totalNonGarapinFee
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
  target_database,
  store,
  balance,
  myStore,
  totalNonGarapinFee
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
                  store,
                  balance,
                  myStore,
                  0
                );

                if (route.role === "SUPP") {
                  await checkAndSplitChild(
                    route,
                    transaction,
                    baseUrl,
                    apiKey,
                    target_database,
                    store,
                    balance,
                    myStore,
                    0
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
  target_database,
  mainTrx,
  store,
  balance,
  myStore,
  totalNonGarapinFee
) => {
  // Hitung amount berdasarkan target
  let amount = route.flat_amount - route.totalFee;
  if (route.target === "garapin") {
    amount = route.flat_amount + totalNonGarapinFee;
  }
  const transferBody = {
    amount: amount,
    source_user_id: source_user_id,
    destination_user_id: route.destination_account_id,
    reference: transaction.invoice + "&&" + route.reference_id,
  };

  // Logger.errorLog("amountXX", transferBody.amount);
  // Logger.errorLog("source_user_idXXX", transferBody.source_user_id);
  // Logger.errorLog("destination_user_idXXX", transferBody.destination_user_id);
  // Logger.errorLog("referenceXXX", transferBody.reference);

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

      const htmlContent = htmlContentSuccess(
        transferBody.amount,
        transaction,
        route.target,
        balance
      );

      await sendNodeMailer(
        process.env.RECEIVER_EMAIL,
        "[SUCCESS] - Quick Release Dana Pending",
        htmlContent
      );

      Logger.log("Update Transaction main invoice");
      await updateTransaction(transaction, target_database, myStore);
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

const updateTransaction = async (transaction, target_database, store) => {
  Logger.log(
    `Update transaction ${transaction.invoice} for ${target_database}`
  );
  const db = await connectTargetDatabase(target_database);
  const TransactionModel = db.model("Transaction", transactionSchema);
  const withdrawData = db.model("Withdraw", withdrawSchema);
  try {
    const updatedTransaction = await TransactionModel.findOneAndUpdate(
      { invoice: transaction.invoice },
      { status: "SUCCEEDED", settlement_status: "SETTLED" },
      { new: true } // Mengembalikan dokumen yang diperbarui
    );

    const updatedTransactionParent = await TransactionModel.findOneAndUpdate(
      { invoice: transaction.parent_invoice },
      { status: "SUCCEEDED", settlement_status: "SETTLED" },
      { new: true } // Mengembalikan dokumen yang diperbarui
    );

    // Save to Withdraw Table
    const dataPayout = {
      reference_id: transaction.invoice,
      channel_code: "XENDIT",
      channel_properties: {
        account_holder_name: store.account_holder.name,
        account_number: store.account_holder.id.toString(),
      },
      amount: transaction.total_with_fee,
      description: "QUICK RELEASE WITHDRAW",
      currency: "IDR",
      receipt_notification: {
        email_to: [store.account_holder.email],
        email_cc: [],
      },
      business_id: store.id,
      created: new Date(),
      updated: new Date(),
      id: new Date().getTime().toString(),
    };

    await withdrawData.create(dataPayout);

    if (updatedTransaction && updatedTransactionParent) {
      Logger.log("Transaction successfully updated");
      // Logger.log(updatedTransaction);
    } else {
      Logger.log("Transaction not found or not updated");
      // Logger.log(updatedTransaction);
    }
  } catch (error) {
    Logger.errorLog("Error updating transaction", error);
  } finally {
    db.close(); // Menutup koneksi database
    Logger.log("Database connection closed in worker.");
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getBalance = async (store, baseUrl, apiKey, retryCount = 0) => {
  Logger.log(`Getting balance for store ${store.store_name}`);
  const url = `${baseUrl}/balance`;
  const maxRetries = 5; // Maksimum percobaan
  const baseDelay = 1000; // Delay dasar dalam milidetik (1 detik)

  try {
    const response = await limiter.schedule(() =>
      axios.get(url, {
        headers: {
          Authorization: `Basic ${Buffer.from(apiKey + ":").toString("base64")}`,
          "for-user-id": store.account_holder.id,
        },
      })
    );
    return response.data.balance;
  } catch (error) {
    if (error.response?.status === 429 && retryCount < maxRetries) {
      // Hitung delay dengan exponential backoff
      const delay = baseDelay * Math.pow(2, retryCount);

      Logger.log(
        `Rate limited. Retrying in ${delay}ms... (Attempt ${retryCount + 1}/${maxRetries})`
      );

      // Tunggu sesuai delay
      await sleep(delay);

      // Coba lagi dengan increment retryCount
      return getBalance(store, baseUrl, apiKey, retryCount + 1);
    }

    Logger.errorLog("Error fetching balance", error);
    // Jika sudah melebihi maksimum retry atau error lain, return default value
    return 0; // atau nilai default lain yang sesuai
  }
};

const fetchTransactionDestination = async (
  route,
  transaction,
  baseUrl,
  apiKey
) => {
  // Logger.log("MASUK FETCH TRANSACTION DESTINATION");
  // Logger.log(route.destination_account_id);
  // Logger.log(transaction.invoice + "&&" + route.reference_id);
  // Logger.log(baseUrl);
  // Logger.log(apiKey);
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

// Fungsi pembantu untuk memformat angka ke format Rupiah
const formatToRupiah = (amount) => {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
};

const htmlContentSuccess = (amount, transaction, store, balance) => {
  const total =
    transaction.total_with_fee -
    transaction.quick_release_fee -
    transaction.quick_release_vat -
    transaction.fee_bank -
    transaction.vat;
  const formattedAmount = formatToRupiah(amount);
  const formattedBalance = formatToRupiah(balance - amount);
  const formattedTotal = formatToRupiah(total);
  const htmlContent = `
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2>Dana sebesar <b style="color: green;">${formattedAmount}</b> BERHASIL TERKIRIM.</h2>
      <hr style="border: 1px solid #eee;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0;"><strong>Tanggal:</strong></td>
          <td style="padding: 8px 0;">${new Date().toLocaleString()}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Transaction ID:</strong></td>
          <td style="padding: 8px 0;">${transaction.invoice}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Dana sisa:</strong></td>
          <td style="padding: 8px 0;">${formattedBalance}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Tujuan:</strong></td>
          <td style="padding: 8px 0;">${store}</td>
        </tr>
      </table>
    </body>
    `;
  return htmlContent;
};

const htmlContentFailed = (transaction, store, balance) => {
  const total =
    transaction.total_with_fee -
    transaction.quick_release_fee -
    transaction.quick_release_vat -
    transaction.fee_bank -
    transaction.vat;
  const formattedBalance = formatToRupiah(balance);
  const formattedTotal = formatToRupiah(total);
  const formattedShortfall = formatToRupiah(Math.max(0, total - balance));

  const htmlContent = `
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <h2>Dana sebesar <b style="color: red;">${formattedTotal}</b> GAGAL TERKIRIM.</h2>
      <hr style="border: 1px solid #eee;">
      <table style="width: 100%; border-collapse: collapse;">
        <tr>
          <td style="padding: 8px 0;"><strong>Tanggal:</strong></td>
          <td style="padding: 8px 0;">${new Date().toLocaleString()}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Transaction ID:</strong></td>
          <td style="padding: 8px 0;">${transaction.invoice}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Dana sisa:</strong></td>
          <td style="padding: 8px 0;">${formattedBalance}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Dana kurang:</strong></td>
          <td style="padding: 8px 0;">${formattedShortfall}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0;"><strong>Tujuan:</strong></td>
          <td style="padding: 8px 0;">${store.store_name}</td>
        </tr>
      </table>
    </body>
    `;
  return htmlContent;
};

const sendNodeMailer = async (receiver, subject, htmlContent) => {
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });

  var mailOptions = {
    from: process.env.SMTP_USER,
    to: receiver,
    subject: subject,
    html: htmlContent,
  };

  transporter.sendMail(mailOptions, function (error, info) {
    if (error) {
      console.log(error);
    } else {
      // console.log("Email sent: " + info.response);
    }
  });
};

workerpool.worker({
  processStoreWithdrawl: processStoreWithdrawl,
});
