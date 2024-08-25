import workerpool from 'workerpool';
import RakServices from './rakServices.js'; // Pastikan path ini sesuai

// Buat instance dari RakServices
const rakService = new RakServices();

async function runTask() {
  try {
    await rakService.procesUpdateServices();
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
}

// Mendaftarkan fungsi ke workerpool
workerpool.worker({
  runTask: runTask
});
