const express = require('express');
const router = express.Router();
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const AdmZip = require('adm-zip');

// --- Helper: Resolve mysqldump/mysql path safely ---
function resolveMariaDBBinary(exeName) {
    try {
        // 1️⃣ Installed portable path used by NSIS
        const installedPath = path.join(
            process.env.LOCALAPPDATA || '',
            'Programs',
            'PSAHiredServer',
            'mariadb',
            'bin',
            exeName
        );
        if (fs.existsSync(installedPath)) return `"${installedPath}"`;

        // 2️⃣ Fallback: running inside the same folder as server.exe
        const exeDir = path.dirname(process.execPath);
        const localPath = path.join(exeDir, 'mariadb', 'bin', exeName);
        if (fs.existsSync(localPath)) return `"${localPath}"`;

        // 3️⃣ Last resort: global PATH
        return exeName;
    } catch (err) {
        console.error('Error resolving MariaDB binary:', err);
        return exeName;
    }
}

// POST /api/database/backup
router.post('/backup', (req, res) => {
    const password = process.env.BACKUP_ENCRYPTION_KEY;
    if (!password) {
        console.error('BACKUP FAILED: BACKUP_ENCRYPTION_KEY is not defined.');
        return res.status(500).json({ message: 'Server configuration error: Backup key is not set.' });
    }

    const dbUser = process.env.DB_USER;
    const dbPassword = process.env.DB_PASSWORD;
    const dbName = process.env.DB_DATABASE;
    const dbHost = process.env.DB_HOST || 'localhost';

    // 🔧 FIX: Use resolved path to mariadb-dump.exe or mysqldump.exe
    let dumpBinary = resolveMariaDBBinary('mariadb-dump.exe');
    if (!fs.existsSync(dumpBinary.replace(/"/g, ''))) {
        dumpBinary = resolveMariaDBBinary('mysqldump.exe');
    }

    const command = `${dumpBinary} --host=${dbHost} --user=${dbUser} --password=${dbPassword} ${dbName}`;

    try {
        const mysqldumpProcess = exec(command, { encoding: 'utf8' });
        const archive = archiver('zip', { zlib: { level: 9 } });

        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename=backup-${Date.now()}.zip`);

        archive.pipe(res);

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

    const exeDir = path.dirname(process.execPath);
    const tempDir = path.join(exeDir, 'temp_restore');
    if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
    }

    const tempZipPath = path.join(tempDir, `restore-${Date.now()}.zip`);
    const writeStream = fs.createWriteStream(tempZipPath);

    req.pipe(writeStream);

    writeStream.on('finish', () => {
        let tempSqlPath = '';
        try {
            const zip = new AdmZip(tempZipPath);
            const zipEntries = zip.getEntries();
            if (zipEntries.length === 0) throw new Error('ZIP file is empty.');

            const sqlEntry = zipEntries[0];
            tempSqlPath = path.join(tempDir, sqlEntry.entryName);

            zip.extractEntryTo(sqlEntry, tempDir, false, true, password);

            // 🔧 FIX: Use resolved path to mariadb.exe or mysql.exe
            let mysqlBinary = resolveMariaDBBinary('mariadb.exe');
            if (!fs.existsSync(mysqlBinary.replace(/"/g, ''))) {
                mysqlBinary = resolveMariaDBBinary('mysql.exe');
            }

            const command = `${mysqlBinary} --host=${dbHost} --user=${dbUser} --password=${dbPassword} ${dbName}`;
            const mysqlProcess = exec(command, (error, stdout, stderr) => {
                fs.unlinkSync(tempZipPath);
                fs.unlinkSync(tempSqlPath);

                if (error) {
                    console.error('RESTORE FAILED:', stderr);
                    return res.status(500).json({ message: 'Database restore failed.', details: stderr });
                }
                res.status(200).json({ message: 'Database restored successfully!' });
            });

            const readStream = fs.createReadStream(tempSqlPath);
            readStream.pipe(mysqlProcess.stdin);
        } catch (err) {
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
        res.status(500).json({ message: 'Failed to save uploaded backup file.' });
    });
});

module.exports = router;