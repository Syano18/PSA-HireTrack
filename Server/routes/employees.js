const express = require('express');
const router = express.Router();
const dbPool = require('../db');
// --- 1. Import the audit logger ---
const { logAudit } = require('../utils/auditLogger');

const getUserWithRole = async (userId) => {
    const [rows] = await dbPool.query('SELECT role FROM users WHERE id = ?', [userId]);
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

// POST /api/employees
router.post('/', async (req, res) => {
    const { actingUserId, ...employeeData } = req.body;
    if (!actingUserId) return res.status(403).json({ error: 'Permission denied.' });

    try {
        const actingUser = await getUserWithRole(actingUserId);
        if (!['Super_Admin', 'Admin', 'PACD'].includes(actingUser.role)) {
            return res.status(403).json({ error: 'You do not have permission to add employees.' });
        }

        const requiredFields = ['first_name', 'middle_initial', 'last_name', 'phone_number', 'date_of_birth', 'sex', 'barangay', 'city', 'highest_grade_completed'];
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
        const [latestEmployee] = await dbPool.query("SELECT employee_id FROM employees WHERE employee_id LIKE ? ORDER BY id DESC LIMIT 1", [`${idPrefix}-${currentYear}-%`]);
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

        await logAudit(actingUserId, 'CREATE', 'employee', result.insertId, null, employeeData);

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
        
        const requiredFields = ['employee_id', 'first_name', 'middle_initial', 'last_name', 'phone_number', 'date_of_birth', 'sex', 'barangay', 'city', 'highest_grade_completed'];
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

        await logAudit(actingUserId, 'UPDATE', 'employee', id, oldRecord, employeeData);

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
        
        // --- 6. Add Audit Log for DELETE ---
        await logAudit(actingUserId, 'DELETE', 'employee', id, oldRecord, null);

        res.json({ message: 'Employee deleted successfully' });
    } catch (err) {
        console.error(`Database error during employee deletion: ${err.message}`);
        return res.status(500).json({ error: 'Database error.' });
    }
});

// POST /api/employees/import
router.post('/import', async (req, res) => {
    const { actingUserId, employees } = req.body;
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
        const [dbEmployees] = await connection.query("SELECT first_name, last_name, DATE_FORMAT(date_of_birth, '%Y-%m-%d') as dob FROM employees");
        const existingEmployeeKeys = new Set(
            dbEmployees.map(emp => 
                `${(emp.first_name || '').trim().toLowerCase()}-${(emp.last_name || '').trim().toLowerCase()}-${emp.dob}`
            )
        );
        
        const errors = [];
        for (let i = 0; i < employees.length; i++) {
            const employeeData = employees[i];
            const rowNum = i + 2;
            const requiredFields = ['first_name', 'middle_initial', 'last_name', 'phone_number', 'date_of_birth', 'sex', 'barangay', 'city', 'highest_grade_completed'];
            
            const missingFields = requiredFields.filter(field => !employeeData[field] || String(employeeData[field]).trim() === '');
            if (missingFields.length > 0) {
                errors.push(`Row ${rowNum}: Missing required fields: ${missingFields.join(', ')}.`);
            }

            // --- ✅ STEP 2: CHECK FOR DUPLICATES USING THE PRE-FETCHED DATA ---
            const parsedDob = parseDate(employeeData.date_of_birth);
            if (!parsedDob) {
                errors.push(`Row ${rowNum}: Invalid or missing date_of_birth.`);
            } else {
                 const uniqueKey = `${(employeeData.first_name || '').trim().toLowerCase()}-${(employeeData.last_name || '').trim().toLowerCase()}-${parsedDob}`;
                if (existingEmployeeKeys.has(uniqueKey)) {
                    errors.push(`Row ${rowNum}: An employee with the same first name, last name, and date of birth already exists.`);
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
        }
        
        if (errors.length > 0) {
            connection.release();
            return res.status(400).json({ message: 'Import failed. Please fix the errors in your file.', errors });
        }
        
        // If validation passes, proceed with insertion
        await connection.beginTransaction();
        const idPrefix = 'PSAKLG';
        const currentYear = new Date().getFullYear().toString().slice(-2);
        const [latestEmployee] = await connection.query("SELECT employee_id FROM employees WHERE employee_id LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE", [`${idPrefix}-${currentYear}-%`]);
        let nextSequenceNumber = 1;
        if (latestEmployee.length > 0) {
            const lastSequence = parseInt(latestEmployee[0].employee_id.split('-')[2], 10);
            nextSequenceNumber = lastSequence + 1;
        }

        const newlyImported = [];
        for (const employeeData of employees) {
            employeeData.date_of_birth = parseDate(employeeData.date_of_birth); // Ensure date is parsed again before insert
            const newEmployeeId = `${idPrefix}-${currentYear}-${String(nextSequenceNumber).padStart(4, '0')}`;
            employeeData.employee_id = newEmployeeId;
            nextSequenceNumber++;
            const columns = ['employee_id', 'first_name', 'middle_initial', 'last_name', 'suffix', 'email', 'phone_number', 'date_of_birth', 'sex', 'tin_no', 'barangay', 'city', 'highest_grade_completed'];
            const values = columns.map(col => employeeData[col] || null);
            await connection.query(`INSERT INTO employees (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`, values);
            newlyImported.push({
                employee_id: newEmployeeId,
                full_name: [employeeData.first_name, employeeData.middle_initial, employeeData.last_name, employeeData.suffix].filter(Boolean).join(' ')
            });
        }
        await connection.commit();

        await logAudit(actingUserId, 'IMPORT', 'employee', null, null, { importedCount: newlyImported.length });

        res.status(201).json({ 
            message: `Successfully imported ${newlyImported.length} employees.`,
            newlyImported: newlyImported 
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