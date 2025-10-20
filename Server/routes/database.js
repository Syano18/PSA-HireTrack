const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const AdmZip = require('adm-zip');

// Make sure dotenv is configured in your main server file (e.g., server.js)
// Example: require('dotenv').config();

// POST /api/database/backup
router.post('/backup', (req, res) => {
    // Get the dedicated backup password securely from the server's .env file
    const password = process.env.BACKUP_ENCRYPTION_KEY;

    if (!password) {
        console.error('BACKUP FAILED: BACKUP_ENCRYPTION_KEY is not defined in the .env file.');
        return res.status(500).json({ message: 'Server configuration error: Backup key is not set.' });
    }

    const dbUser = process.env.DB_USER;
    const dbPassword = process.env.DB_PASSWORD;
    const dbName = process.env.DB_DATABASE;
    const dbHost = process.env.DB_HOST || 'localhost';

    const command = `mysqldump --host=${dbHost} --user=${dbUser} --password=${dbPassword} ${dbName}`;

    try {
        const mysqldumpProcess = exec(command, { encoding: 'utf8' });
        const archive = archiver('zip', { zlib: { level: 9 } });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=backup-${Date.now()}.zip`);

        archive.pipe(res);

        // Add the SQL dump stream to the archive with encryption
        archive.append(mysqldumpProcess.stdout, { 
            name: 'backup.sql',
            encryption: 'aes256',
            password: password
        });

        mysqldumpProcess.stderr.on('data', (data) => {
            console.error(`mysqldump stderr: ${data}`);
        });
        
        mysqldumpProcess.on('error', (err) => {
             throw err;
        });

        archive.finalize();

    } catch (err) {
        console.error('BACKUP FAILED:', err);
        res.status(500).json({ message: 'Server failed to create backup.', details: err.message });
    }
});

// POST /api/database/restore
router.post('/restore', (req, res) => {
    const password = process.env.BACKUP_ENCRYPTION_KEY;
    if (!password) {
        return res.status(500).json({ message: 'Server configuration error: Backup key is not set.' });
    }

    const dbUser = process.env.DB_USER;
    const dbPassword = process.env.DB_PASSWORD;
    const dbName = process.env.DB_DATABASE;
    const dbHost = process.env.DB_HOST || 'localhost';

    // 1. Get the directory where the .exe is running on the hard drive
    const exeDir = path.dirname(process.execPath);
    // 2. Create a path for a 'temp' folder in that same directory
    const tempDir = path.join(exeDir, 'temp_restore');
    // 3. Safely create this folder on the actual hard drive
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempZipPath = path.join(tempDir, `restore-${Date.now()}.zip`);
    const writeStream = fs.createWriteStream(tempZipPath);
    
    req.pipe(writeStream);

    writeStream.on('finish', () => {
        let tempSqlPath = ''; // Keep track of the temp SQL file path for cleanup
        try {
            const zip = new AdmZip(tempZipPath);
            const zipEntries = zip.getEntries();
            if (zipEntries.length === 0) throw new Error("ZIP file is empty.");
            
            const sqlEntry = zipEntries[0];
            tempSqlPath = path.join(tempDir, sqlEntry.entryName);

            // ✅ THE FIX: Extract the entry to a temporary file using the password
            zip.extractEntryTo(sqlEntry, tempDir, false, true, password);

            const command = `mysql --host=${dbHost} --user=${dbUser} --password=${dbPassword} ${dbName}`;
            const mysqlProcess = exec(command, (error, stdout, stderr) => {
                // Clean up both temporary files
                fs.unlinkSync(tempZipPath);
                fs.unlinkSync(tempSqlPath);
                
                if (error) {
                    console.error('RESTORE FAILED:', stderr);
                    return res.status(500).json({ message: 'Database restore failed.', details: stderr });
                }
                res.status(200).json({ message: 'Database restored successfully!' });
            });
            
            // Stream the decrypted, temporary SQL file to the mysql command
            const readStream = fs.createReadStream(tempSqlPath);
            readStream.pipe(mysqlProcess.stdin);

        } catch (err) {
            // Clean up temp files on error
            if (fs.existsSync(tempZipPath)) fs.unlinkSync(tempZipPath);
            if (fs.existsSync(tempSqlPath)) fs.unlinkSync(tempSqlPath);

            console.error('RESTORE PROCESS FAILED:', err);
            if (err.message && err.message.toLowerCase().includes('password')) {
                 return res.status(400).json({ message: 'Restore failed: Invalid password.' });
            }
            res.status(500).json({ message: 'Failed to extract backup file.', details: err.message });
        }
    });

    writeStream.on('error', (err) => {
        console.error('Failed to write temp zip file:', err);
        res.status(500).json({ message: 'Failed to save uploaded backup file.'});
    });
});

module.exports = router;