const express = require('express');
const router = express.Router();
const dbPool = require('../db');

const getUserWithRole = async (userId) => {
    const [rows] = await dbPool.query('SELECT hiretrack_role AS role FROM users WHERE id = ?', [userId]);
    return rows[0];
};

// This parseDate function is a utility and does not need changes.
const parseDate = (dateInput) => {
    if (!dateInput || String(dateInput).trim() === '') return null;
    const dateStr = String(dateInput).trim();
    if (/^\d{5}$/.test(dateStr)) {
        const serial = parseInt(dateStr, 10);
        const date = new Date(Math.round((serial - 25569) * 86400 * 1000));
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        if (year > 1900 && year < 2100) return `${year}-${month}-${day}`;
    }
    const parts = dateStr.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/) || dateStr.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
    if (parts) {
        let year, month, day;
        if (parts[1].length === 4) {
            year = parseInt(parts[1], 10); month = parseInt(parts[2], 10); day = parseInt(parts[3], 10);
        } else {
            month = parseInt(parts[1], 10); day = parseInt(parts[2], 10); year = parseInt(parts[3], 10);
        }
        if (year > 1900 && year < 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
    }
    return null;
};

// --- Helper: Levenshtein Distance for Fuzzy Matching ---
const levenshtein = (a, b) => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1));
            }
        }
    }
    return matrix[b.length][a.length];
};

// GET /api/employees (No changes needed)
router.get('/', async (req, res) => {
  try {
    const [results] = await dbPool.query("SELECT * FROM employees ORDER BY last_name, first_name");
    res.json(results);
  } catch (err) {
    console.error(`Database error fetching employees: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve employee data.' });
  }
});

// GET /api/employees/users-for-interview
router.get('/users-for-interview', async (req, res) => {
    try {
        const [users] = await dbPool.query(
            "SELECT id, first_name, middle_initial, last_name, suffix FROM users ORDER BY last_name, first_name"
        );
        const usersWithFullName = users.map(u => ({
            id: u.id,
            full_name: [u.first_name, u.middle_initial, u.last_name, u.suffix].filter(Boolean).join(' ')
        }));
        res.json(usersWithFullName);
    } catch (err) {
        console.error(`Database error fetching users for interview: ${err.message}`);
        res.status(500).json({ error: 'Failed to retrieve user data.' });
    }
});

// POST /api/employees
router.post('/', async (req, res) => {
    const { actingUserId, ...employeeData } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission to add employees.' });
        }

        const requiredFields = ['first_name', 'middle_initial', 'last_name', 'date_of_birth', 'sex', 'barangay', 'city', 'highest_grade_completed'];
        const missingFields = requiredFields.filter(field => !employeeData[field]);
        if (missingFields.length > 0) {
            return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });
        }

        const { first_name, middle_initial, last_name, date_of_birth } = employeeData;

        // Check 1: Full Record Match (Most Specific)
        const [fullRecordMatch] = await dbPool.query(
            'SELECT id FROM employees WHERE first_name = ? AND middle_initial = ? AND last_name = ? AND date_of_birth = ? ',
            [first_name, middle_initial, last_name, date_of_birth]
        );
        if (fullRecordMatch.length > 0) {
            return res.status(409).json({ error: 'An employee with the exact same details already exists.' });
        }
        const [fristlastMatch] = await dbPool.query(
            'SELECT id FROM employees WHERE first_name = ? AND last_name = ?',
            [first_name, last_name]
        );
        if (fristlastMatch.length > 0){
            return  res.status(409).json({error: 'An employee with the same first name and last name already exists.'})
        }
        // Check 2: First Name + Date of Birth + Sex
        const [firstNameDobMatch] = await dbPool.query(
            'SELECT id FROM employees WHERE first_name = ? AND date_of_birth = ? ',
            [first_name, date_of_birth]
        );
        if (firstNameDobMatch.length > 0) {
            return res.status(409).json({ error: 'An employee with the same first name and date of birth already exists.' });
        }
        
        // Check 3: Last Name + Date of Birth + Sex
        const [lastNameDobMatch] = await dbPool.query(
            'SELECT id FROM employees WHERE last_name = ? AND date_of_birth = ? ',
            [last_name, date_of_birth]
        );
        if (lastNameDobMatch.length > 0) {
            return res.status(409).json({ error: 'An employee with the same last name and date of birth already exists.' });
        }
        // --- ID Generation Logic ---
        const idPrefix = 'PSAKLG';
        const currentYear = new Date().getFullYear().toString().slice(-2);
        const [latestEmployee] = await dbPool.query("SELECT employee_id FROM employees WHERE employee_id LIKE ? ORDER BY id DESC LIMIT 1", [`${idPrefix}-%`]);
        let newSequenceNumber = 1;
        if (latestEmployee.length > 0) {
            const lastIdParts = latestEmployee[0].employee_id.split('-');
            const lastSequence = parseInt(lastIdParts[lastIdParts.length - 1], 10);
            newSequenceNumber = lastSequence + 1;
        }
        const newEmployeeId = `${idPrefix}-${currentYear}-${String(newSequenceNumber).padStart(4, '0')}`;
        employeeData.employee_id = newEmployeeId;

        // --- Insert and Audit Logic ---
        const columns = ['employee_id', 'first_name', 'middle_initial', 'last_name', 'suffix', 'email', 'phone_number', 'date_of_birth', 'sex', 'tin_no', 'barangay', 'city', 'highest_grade_completed'];
        const values = columns.map(col => employeeData[col] || null);
        const sqlQuery = `INSERT INTO employees (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`;
        const [result] = await dbPool.query(sqlQuery, values);

        res.status(201).json({ message: 'Employee created successfully', employeeId: result.insertId });

    } catch (dbErr) {
        console.error(`Database error during employee creation: ${dbErr.message}`);
        // MODIFIED: Updated the generic duplicate error message from the database
        if (dbErr.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'This employee already exists due to a unique constraint violation.' });
        }
        return res.status(500).json({ error: 'Database error.' });
    }
});

// PUT /api/employees/:id
router.put('/:id', async (req, res) => {
    const { id } = req.params;
    const { actingUserId, ...employeeData } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission to edit employees.' });
        }
        
        const requiredFields = ['employee_id', 'first_name', 'middle_initial', 'last_name', 'date_of_birth', 'sex', 'barangay', 'city', 'highest_grade_completed'];
        const missingFields = requiredFields.filter(field => !employeeData[field]);
        if (missingFields.length > 0) return res.status(400).json({ error: `Missing required fields: ${missingFields.join(', ')}` });

        const { first_name, middle_initial, last_name, date_of_birth } = employeeData;

        // Check 1: Full Record Match (Most Specific)
        const [fullRecordMatch] = await dbPool.query(
            'SELECT id FROM employees WHERE first_name = ? AND middle_initial = ? AND last_name = ? AND date_of_birth = ? AND id !=? ',
            [first_name, middle_initial, last_name, date_of_birth, id]
        );
        if (fullRecordMatch.length > 0) {
            return res.status(409).json({ error: 'An employee with the exact same details already exists.' });
        }
        const [fristlastMatch] = await dbPool.query(
            'SELECT id FROM employees WHERE first_name = ? AND last_name = ? AND id !=?',
            [first_name, last_name, id]
        );
        if (fristlastMatch.length > 0){
            return  res.status(409).json({error: 'An employee with the same first name and last name already exists.'})
        }
        // Check 2: First Name + Date of Birth + Sex
        const [firstNameDobMatch] = await dbPool.query(
            'SELECT id FROM employees WHERE first_name = ? AND date_of_birth = ? AND id !=? ',
            [first_name, date_of_birth,id]
        );
        if (firstNameDobMatch.length > 0) {
            return res.status(409).json({ error: 'An employee with the same first name and date of birth already exists.' });
        }
        
        // Check 3: Last Name + Date of Birth + Sex
        const [lastNameDobMatch] = await dbPool.query(
            'SELECT id FROM employees WHERE last_name = ? AND date_of_birth = ? AND id !=? ',
            [last_name, date_of_birth, id]
        );
        if (lastNameDobMatch.length > 0) {
            return res.status(409).json({ error: 'An employee with the same last name and date of birth already exists.' });
        }

        // --- Fetch for Audit, Update, and Log ---
        const [oldRecordResult] = await dbPool.query('SELECT * FROM employees WHERE id = ?', [id]);
        if (oldRecordResult.length === 0) {
            return res.status(404).json({ error: 'Employee not found.' });
        }
        const oldRecord = oldRecordResult[0];

        const columns = ['employee_id', 'first_name', 'middle_initial', 'last_name', 'suffix', 'email', 'phone_number', 'date_of_birth', 'sex', 'tin_no', 'barangay', 'city', 'highest_grade_completed'];
        const values = columns.map(col => employeeData[col] || null);
        const sqlQuery = `UPDATE employees SET ${columns.map(col => `${col} = ?`).join(', ')} WHERE id = ?`;
        await dbPool.query(sqlQuery, [...values, id]);

        res.json({ message: 'Employee updated successfully' });

    } catch (err) {
        console.error(`Database error during employee update: ${err.message}`);
        // MODIFIED: Updated the generic duplicate error message from the database
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'This employee already exists due to a unique constraint violation.' });
        }
        return res.status(500).json({ error: 'Database error.' });
    }
});

// DELETE /api/employees/:id
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    const { actingUserId } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });
    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) return res.status(403).json({ error: 'You do not have permission to delete employees.' });
        
        // --- 5. Fetch record BEFORE deleting for audit trail ---
        const [oldRecordResult] = await dbPool.query('SELECT * FROM employees WHERE id = ?', [id]);
        if (oldRecordResult.length === 0) return res.status(404).json({ error: 'Employee not found.' });
        const oldRecord = oldRecordResult[0];

        await dbPool.query('DELETE FROM employees WHERE id = ?', [id]);
        
        res.json({ message: 'Employee deleted successfully' });
    } catch (err) {
        console.error(`Database error during employee deletion: ${err.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// POST /api/employees/import
router.post('/import', async (req, res) => {
    const { actingUserId, employees, ignoreWarnings } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });
    if (!Array.isArray(employees) || employees.length === 0) return res.status(400).json({ error: 'No employee data provided.' });
    
    const connection = await dbPool.getConnection();
    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            connection.release();
            return res.status(403).json({ error: 'You do not have permission to import employees.' });
        }
        
        // --- Location data setup (no changes here) ---
        const [municipalities] = await connection.query("SELECT id, name FROM municipalities");
        const [barangays] = await connection.query("SELECT name, municipality_id FROM barangays");
        const locationMap = new Map();
        municipalities.forEach(mun => { locationMap.set(mun.name.toLowerCase(), { id: mun.id, barangays: new Set() }); });
        barangays.forEach(bgy => {
            const mun = municipalities.find(m => m.id === bgy.municipality_id);
            if (mun) locationMap.get(mun.name.toLowerCase())?.barangays.add(bgy.name.toLowerCase());
        });

        // --- ✅ STEP 1: PRE-FETCH EXISTING EMPLOYEES FOR DUPLICATE CHECK ---
        const [dbEmployees] = await connection.query("SELECT id, employee_id, first_name, last_name, DATE_FORMAT(date_of_birth, '%Y-%m-%d') as dob FROM employees");
        const existingEmployeeMap = new Map();
        dbEmployees.forEach(emp => {
            const key = `${(emp.first_name || '').trim().toLowerCase()}-${(emp.last_name || '').trim().toLowerCase()}-${emp.dob}`;
            existingEmployeeMap.set(key, emp);
        });
        
        // Prepare DB names for fuzzy matching
        const dbNames = dbEmployees.map(emp => ({
            first: (emp.first_name || '').trim().toLowerCase(),
            last: (emp.last_name || '').trim().toLowerCase(),
            fullName: `${emp.first_name} ${emp.last_name}`,
            employee_id: emp.employee_id
        }));
        
        const errors = [];
        const warnings = [];
        const duplicatesList = []; // To track skipped duplicates
        const rowsToInsert = [];   // To track valid rows for insertion
        const seenInCsvKeys = new Set(); // To track duplicates within the same import file
        for (let i = 0; i < employees.length; i++) {
            const employeeData = employees[i];
            const rowNum = i + 2;
            const requiredFields = ['first_name', 'middle_initial', 'last_name', 'date_of_birth', 'sex', 'barangay', 'city', 'highest_grade_completed'];
            
            const missingFields = requiredFields.filter(field => !employeeData[field] || String(employeeData[field]).trim() === '');
            if (missingFields.length > 0) {
                errors.push(`Row ${rowNum}: Missing required fields: ${missingFields.join(', ')}.`);
            }

            // --- ✅ STEP 2: CHECK FOR DUPLICATES USING THE PRE-FETCHED DATA ---
            const parsedDob = parseDate(employeeData.date_of_birth);
            let isExactDuplicate = false;

            if (!parsedDob) {
                errors.push(`Row ${rowNum}: Invalid or missing date_of_birth.`);
            } else {
                 const uniqueKey = `${(employeeData.first_name || '').trim().toLowerCase()}-${(employeeData.last_name || '').trim().toLowerCase()}-${parsedDob}`;
                if (existingEmployeeMap.has(uniqueKey)) {
                    // ✅ Exact duplicate found in DB: Skip insertion, add to duplicates list
                    const existing = existingEmployeeMap.get(uniqueKey);
                    duplicatesList.push({
                        employee_id: existing.employee_id,
                        full_name: `${existing.first_name} ${existing.last_name}`,
                        status: 'Existing Record (Skipped)'
                    });
                    isExactDuplicate = true;
                } else if (seenInCsvKeys.has(uniqueKey)) {
                    // ✅ Duplicate within the CSV file: Skip insertion
                    errors.push(`Row ${rowNum}: This is a duplicate record from earlier in the same file. Skipped.`);
                    isExactDuplicate = true;
                } else {
                    seenInCsvKeys.add(uniqueKey);
                }
            }

            // --- ✅ STEP 3: FUZZY MATCHING (If not an exact duplicate) ---
            if (!isExactDuplicate && employeeData.first_name && employeeData.last_name) {
                const currentFirst = employeeData.first_name.trim().toLowerCase();
                const currentLast = employeeData.last_name.trim().toLowerCase();

                for (const dbEmp of dbNames) {
                    // Optimization: Skip if length difference is too big
                    if (Math.abs(currentFirst.length - dbEmp.first.length) > 2 || Math.abs(currentLast.length - dbEmp.last.length) > 2) continue;

                    const distFirst = levenshtein(currentFirst, dbEmp.first);
                    const distLast = levenshtein(currentLast, dbEmp.last);

                    // Threshold: Distance of 1 allowed for names > 3 chars. 
                    // If names are very short (<=3), require exact match (dist 0).
                    const threshold = (currentFirst.length > 3 && currentLast.length > 3) ? 1 : 0;

                    if (distFirst <= threshold && distLast <= threshold) {
                        // If distance is 0, it's an exact name match but different DOB (since exact check passed)
                        // If distance > 0, it's a fuzzy match
                        warnings.push({
                            index: i,
                            row: rowNum,
                            message: `Row ${rowNum}: Input "${employeeData.first_name} ${employeeData.last_name}" is a possible duplicate of "${dbEmp.fullName}" (similar name found in database).`,
                            existingEmployeeId: dbEmp.employee_id
                        });
                        break; // Stop checking DB for this row once a match is found
                    }
                }
            }

            // --- Location validation (no changes here) ---
            if (employeeData.city) {
                const cityLower = employeeData.city.toLowerCase();
                const validCity = locationMap.get(cityLower);
                if (!validCity) errors.push(`Row ${rowNum}: City/Municipality "${employeeData.city}" not found.`);
                else if (employeeData.barangay && !validCity.barangays.has(employeeData.barangay.toLowerCase())) {
                    errors.push(`Row ${rowNum}: Barangay "${employeeData.barangay}" not found in ${employeeData.city}.`);
                }
            }

            if (!isExactDuplicate) {
                rowsToInsert.push(employeeData);
            }
        }
        
        if (errors.length > 0) {
            connection.release();
            return res.status(400).json({ message: 'Import failed. Please fix the errors in your file.', errors });
        }

        // If there are warnings and the user hasn't confirmed to ignore them
        if (warnings.length > 0 && !ignoreWarnings) {
            connection.release();
            return res.status(200).json({ status: 'warning', message: 'Potential duplicates detected. Please review.', warnings });
        }
        
        // If validation passes, proceed with insertion
        await connection.beginTransaction();
        const idPrefix = 'PSAKLG';
        const currentYear = new Date().getFullYear().toString().slice(-2);
        const [latestEmployee] = await connection.query("SELECT employee_id FROM employees WHERE employee_id LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE", [`${idPrefix}-%`]);
        let nextSequenceNumber = 1;
        if (latestEmployee.length > 0) {
            const lastIdParts = latestEmployee[0].employee_id.split('-');
            const lastSequence = parseInt(lastIdParts[lastIdParts.length - 1], 10);
            nextSequenceNumber = lastSequence + 1;
        }

        const newlyImported = [];
        const valuesToInsert = []; // Prepare array for batch insert

        for (const employeeData of rowsToInsert) {
            employeeData.date_of_birth = parseDate(employeeData.date_of_birth); // Ensure date is parsed again before insert
            const newEmployeeId = `${idPrefix}-${currentYear}-${String(nextSequenceNumber).padStart(4, '0')}`;
            employeeData.employee_id = newEmployeeId;
            nextSequenceNumber++;
            
            const columns = ['employee_id', 'first_name', 'middle_initial', 'last_name', 'suffix', 'email', 'phone_number', 'date_of_birth', 'sex', 'tin_no', 'barangay', 'city', 'highest_grade_completed'];
            const values = columns.map(col => employeeData[col] || null);
            
            valuesToInsert.push(values); // Add to batch array instead of inserting immediately

            newlyImported.push({
                employee_id: newEmployeeId,
                full_name: [employeeData.first_name, employeeData.middle_initial, employeeData.last_name, employeeData.suffix].filter(Boolean).join(' '),
                status: 'New Record'
            });
        }

        // ✅ Perform Single Batch Insert
        if (valuesToInsert.length > 0) {
            const columns = ['employee_id', 'first_name', 'middle_initial', 'last_name', 'suffix', 'email', 'phone_number', 'date_of_birth', 'sex', 'tin_no', 'barangay', 'city', 'highest_grade_completed'];
            const sql = `INSERT INTO employees (${columns.join(', ')}) VALUES ?`;
            await connection.query(sql, [valuesToInsert]);
        }

        await connection.commit();

        // Combine newly imported with skipped duplicates for the final report
        const finalReport = [...newlyImported, ...duplicatesList];

        res.status(201).json({ 
            message: `Import complete. Added ${newlyImported.length} new records. Skipped ${duplicatesList.length} duplicates.`,
            newlyImported: finalReport 
        });

    } catch (dbErr) {
        await connection.rollback();
        console.error(`Database error during bulk import: ${dbErr.message}`);
        if (dbErr.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Import failed. One record contains a duplicate Email or TIN No.' });
        return res.status(500).json({ error: 'Database transaction failed.' });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;