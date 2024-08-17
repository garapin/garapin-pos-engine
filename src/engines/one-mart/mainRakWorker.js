import { Worker } from 'worker_threads';
import path from 'path';
import Logger from '../../utils/logger.js';
import { fileURLToPath } from "url";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class MainRakWorker {
    constructor(parameters) {
        
    }

  async   runRakWorker() {
        return new Promise((resolve, reject) => {
          const worker = new Worker(path.resolve(__dirname,'rakWorker.js'));
      
          worker.on('message', (message) => {
            if (message.success) {
              Logger.log('Worker selesai dengan sukses');
              resolve();
            } else {
              Logger.error('Worker mengalami kesalahan:', message.error);
              reject(message.error);
            }
          });
      
          worker.on('error', (error) => {
            Logger.error('Worker mengalami error:', error);
            reject(error);
          });
      
          worker.on('exit', (code) => {
            if (code !== 0) {
              Logger.error(`Worker berhenti dengan kode exit: ${code}`);
              reject(new Error(`Worker berhenti dengan kode exit: ${code}`));
            }
          });
        });
      }
}

export default MainRakWorker;