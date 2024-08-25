import workerpool from 'workerpool';
import path from 'path';
import Logger from '../../utils/logger.js';
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MainRakWorker {
    constructor(parameters) {
        // Simpan parameters jika diperlukan
        this.parameters = parameters;
    }

   async runRakWorker() {
       const pool = workerpool.pool(path.resolve(__dirname, 'rakWorker.js'));

       try {
           const result = await pool.exec('runTask', [this.parameters]);
           Logger.log('Worker selesai dengan sukses:', result);
           return result;
       } catch (error) {
           Logger.error('Worker mengalami kesalahan:', error);
           throw error;
       } finally {
           pool.terminate(); // Tutup pool setelah selesai
       }
   }
}

export default MainRakWorker;
