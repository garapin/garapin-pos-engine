import RakServices from "./engines/one-mart/rakServices.js";
import TransactionEngine from "./engines/bagi-bagi-transaction/transactionEngine.js";

// const rakService = new RakServices();

// rakService.procesUpdateServices();
const transactionEngine = new TransactionEngine();

transactionEngine.processTransactions();
