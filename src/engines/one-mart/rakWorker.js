// rakWorker.js
import { parentPort } from 'worker_threads';
import RakServices from './rakServices.js'; // Pastikan path ini sesuai

// Buat instance dari RakServices
const rakService = new RakServices();

async function runTask() {
  try {
    await rakService.procesUpdateServices();
    parentPort.postMessage({ success: true });
  } catch (error) {
    parentPort.postMessage({ success: false, error });
  }
}

// Jalankan tugas ketika worker diinisialisasi
runTask();
