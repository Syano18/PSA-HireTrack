const fs = require('fs');
const path = require('path');

// This central function will write errors to your log file.
const logError = (errorMessage, moduleName = 'GENERAL') => {
  const timestamp = new Date().toISOString();
  // This path goes up two directories from server/utils to find your root-level log file
  const logFilePath = path.join(path.dirname(process.execPath), 'error.log');
  const logMessage = `[${timestamp}] [${moduleName.toUpperCase()}] ${errorMessage}\n`;

  // We use appendFileSync for simplicity here to ensure the log is written
  // before the application might exit on a critical error.
  try {
    fs.appendFileSync(logFilePath, logMessage);
  } catch (err) {
    console.error('CRITICAL: Failed to write to log file:', err);
    console.error('Original error message:', errorMessage);
  }
};

module.exports = logError;