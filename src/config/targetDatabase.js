import mongoose from 'mongoose';
import 'dotenv/config';

const MONGODB_URI = process.env.MONGODB_URI;
const connectionCache = {};
const connectionTimeouts = {};
const CONNECTION_TIMEOUT = 1 * 60 * 1000; // 1 minutes

const checkDatabaseExists = async (databaseName) => {
  const adminConnection = await mongoose.createConnection(`${MONGODB_URI}/admin`, {
    useNewUrlParser: true,
    connectTimeoutMS: 30000, 
    useUnifiedTopology: true,
  }).asPromise(); // Short-lived connection, no pool size set

  const adminDb = adminConnection.db;
  const databases = await adminDb.admin().listDatabases();
  const exists = databases.databases.some(db => db.name === databaseName);
  await adminConnection.close();
  return exists;
};

const connectTargetDatabase = async (databaseName) => {
  if (!databaseName) {
    throw new Error('Database name is required');
  }

  if (connectionCache[databaseName]) {
    // console.log(`Reusing connection for the Database: ${databaseName}`);
    resetConnectionTimeout(databaseName);
    return connectionCache[databaseName];
  }

  try {
    const exists = await checkDatabaseExists(databaseName);
    if (!exists) {
      console.log(`Database: ${databaseName} does not exist.`);
      return null;
    }

    const connection = await mongoose.createConnection(`${MONGODB_URI}/${databaseName}?authSource=admin`, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      connectTimeoutMS: 30000, 
      minPoolSize: 5,
      maxPoolSize: 50
    }).asPromise(); // Long-lived connection, pool size set

    console.log(`Connected to the Database: ${databaseName}`);

    connectionCache[databaseName] = connection;
    setConnectionTimeout(databaseName);

    return connection;
  } catch (error) {
    console.error(`Failed to connect to the Database: ${databaseName}`, error);
    throw error;
  }
};

const setConnectionTimeout = (databaseName) => {
  if (connectionTimeouts[databaseName]) {
    clearTimeout(connectionTimeouts[databaseName]);
  }

  connectionTimeouts[databaseName] = setTimeout(() => {
    closeConnection(databaseName);
  }, CONNECTION_TIMEOUT);
};

const resetConnectionTimeout = (databaseName) => {
  setConnectionTimeout(databaseName);
};

const closeConnection = (databaseName) => {
  const connection = connectionCache[databaseName];
  if (connection) {
    connection.close();
    delete connectionCache[databaseName];
    delete connectionTimeouts[databaseName];
    console.log(`Connection to the Database: ${databaseName} closed`);
  }
};

export { connectTargetDatabase, closeConnection };
