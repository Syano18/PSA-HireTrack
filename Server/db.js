const mysql = require('mysql2');
const fs = require('fs');
const path = require('path');

// This function will write errors to your log file
const logErrorToFile = (errorMessage) => {
  const timestamp = new Date().toISOString();
  const logFilePath = path.join(__dirname, 'error.log');
  const logMessage = `[${timestamp}] [DATABASE] ${errorMessage}\n`;

  fs.appendFile(logFilePath, logMessage, (err) => {
    if (err) {
      // If logging to the file fails, log the failure to the console
      console.error('Failed to write to log file:', err);
      console.error('Original error message:', errorMessage);
    }
  });
};

// This pool will be shared by all of our route files.
const dbPool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
}).promise();

dbPool.getConnection().then(connection => {
    console.log('Successfully connected to the MySQL database pool.');
    connection.release();
}).catch(err => {
    const errorMessage = `Error connecting to MySQL database: ${err.message}`;
    console.error(errorMessage);
    // Call the new function to log the error to your file
    logErrorToFile(errorMessage);
});

module.exports = dbPool;