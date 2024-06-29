import mongoose from 'mongoose';
import 'dotenv/config';


const MONGODB_URI = process.env.MONGODB_URI;

const checkDatabaseExists = async (databaseName) => {
  const adminConnection = mongoose.createConnection(`${MONGODB_URI}/admin`, {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  // Tunggu sampai koneksi benar-benar terbentuk
  await new Promise(resolve => adminConnection.once('connected', resolve));

  const adminDb = adminConnection.db;
  const databases = await adminDb.admin().listDatabases();
  const exists = databases.databases.some(db => db.name === databaseName);
  await adminConnection.close();
  return exists;
};

const connectTargetDatabase = async (databaseName) => {
  try {
    if (!databaseName) {
      throw new Error('Database name is required');
    }

    const exists = await checkDatabaseExists(databaseName);
    if (!exists) {
      return null;
    }

    const connection = mongoose.createConnection(`${MONGODB_URI}/${databaseName}?authSource=admin`, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    connection.on('error', console.error.bind(console, 'Connection to the Database failed:'));
    connection.once('open', () => {
      console.log(`Connected to the Database: ${databaseName}`);
    });

    await new Promise((resolve) => connection.once('open', resolve));
    return connection;
  } catch (error) {
    console.error(`Failed to connect to the Database: ${databaseName}`, error);
  }
};

const closeConnection = (connection) => {
  connection.close();
  console.log('Connection to the Database closed');
};

export { connectTargetDatabase, closeConnection };
