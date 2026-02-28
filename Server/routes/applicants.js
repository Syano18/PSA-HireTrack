const express = require('express');
const router = express.Router();
const dbPool = require('../db');
require('dotenv').config();
const verifyToken = require('../middleware/verifyToken');

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

// --- Helper: Execute Turso Sync via HTTP ---
const executeTurso = async (sql, args = []) => {
  const dbUrl = process.env.TURSO_DB_URL?.replace(/^libsql:/, 'https:');
  const authToken = process.env.TURSO_AUTH_TOKEN;
  
  if (!dbUrl || !authToken) {
    console.warn("Turso DB URL or Token is not configured. Skipping Logbook entry.");
    return null;
  }
 
  const hranaArgs = args.map(arg => {
    if (arg === null || arg === undefined) return { type: "null" };
    if (typeof arg === 'number') return { type: "float", value: arg };
    return { type: "text", value: String(arg) };
  });
 
  const body = {
    requests: [
      { type: "execute", stmt: { sql, args: hranaArgs } },
      { type: "close" }
    ]
  };
 
  try {
    const response = await fetch(`${dbUrl}/v2/pipeline`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Turso Sync Error: ${response.status} ${errorText}`);
    }
    return await response.json();
  } catch (err) {
    console.error('Turso DB Error:', err.message);
    return null;
  }
};

// --- Helper: Format Turso DB Response ---
const formatTursoResponse = (tursoResult) => {
    if (!tursoResult || !tursoResult.results || !tursoResult.results[0] || tursoResult.results[0].type !== 'ok') {
        return [];
    }
    const { cols, rows } = tursoResult.results[0].response.result;
    const columnNames = cols.map(c => c.name);
    
    return rows.map(row => {
        const obj = {};
        row.forEach((value, i) => {
            // The actual value is nested inside the value object from Turso
            obj[columnNames[i]] = value.value;
        });
        return obj;
    });
};

// --- GET /api/applicants ---
router.get('/', async (req, res) => {
  try {
    const [results] = await dbPool.query("SELECT * FROM profile_entries WHERE focal_id IS NULL ORDER BY last_name, first_name");
    res.json(results);
  } catch (err) {
    console.error(`Local DB error fetching applicants: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve applicant data from local database.' });
  }
});

// --- GET /api/applicants/assigned-to-me ---
router.get('/assigned-to-me', verifyToken, async (req, res) => {
  const actingUserId = req.user?.id;
  if (!actingUserId) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  try {
    // 1. Get the full name of the logged-in user
    const [userRows] = await dbPool.query(
      "SELECT first_name, middle_initial, last_name, suffix FROM users WHERE id = ?",
      [actingUserId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Interviewer profile not found.' });
    }

    const u = userRows[0];
    const interviewerName = [u.first_name, u.middle_initial, u.last_name, u.suffix].filter(Boolean).join(' ');

    // 2. Fetch applicants assigned to this interviewer (exclude finished ones)
    const [applicants] = await dbPool.query(
      "SELECT * FROM profile_entries WHERE interviewer = ? AND (interview_status IS NULL OR interview_status != 'Returned to PACD') ORDER BY last_name, first_name",
      [interviewerName]
    );

    res.json(applicants);
  } catch (err) {
    console.error(`Local DB error fetching assigned applicants: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve assigned applicant data.' });
  }
});

// --- POST /api/applicants/sync ---
router.post('/sync', async (req, res) => {
  try {
    const tursoResult = await executeTurso("SELECT * FROM profile_entries ORDER BY rowid ASC");
    
    // Filter out hiring_end_date, keep position and other fields
    const applicants = formatTursoResponse(tursoResult).map(app => {
        const { hiring_end_date, ...rest } = app;
        return rest;
    });

    if (!applicants || applicants.length === 0) {
      return res.json({ message: 'No new applicants found.' });
    }

    // 2. Deduplicate Turso Data (Keep most recent entry from Turso)
    const uniqueTursoApplicants = [];

    applicants.forEach(app => {
      const name1 = [app.first_name, app.middle_initial, app.last_name, app.suffix]
        .filter(Boolean).join(' ').toLowerCase().trim();
      const dob1 = app.date_of_birth;
      //const focal1 = (app.focal_name || '').trim().toLowerCase();

      let matchIndex = -1;

      for (let i = 0; i < uniqueTursoApplicants.length; i++) {
        const existing = uniqueTursoApplicants[i];
        const name2 = [existing.first_name, existing.middle_initial, existing.last_name, existing.suffix]
          .filter(Boolean).join(' ').toLowerCase().trim();
        const dob2 = existing.date_of_birth;
        const focal2 = (existing.focal_name || '').trim().toLowerCase();

        if (dob1 && dob2 && dob1 !== dob2) continue;
        //if (focal1 !== focal2) continue;

        if (Math.abs(name1.length - name2.length) > 3) continue;
        const dist = levenshtein(name1, name2);
        const threshold = name1.length > 4 ? 2 : 0;

        if (dist <= threshold) {
          matchIndex = i;
          break;
        }
      }

      if (matchIndex !== -1) {
        uniqueTursoApplicants[matchIndex] = app; // Replace with newer version
      } else {
        uniqueTursoApplicants.push(app);
      }
    });

    const connection = await dbPool.getConnection();
    try {
      await connection.beginTransaction();

      // 3. Fetch Local Data for Comparison
      const [localApplicants] = await connection.query("SELECT * FROM profile_entries");

      const toInsert = [];
      const toUpdate = [];

      // 4. Compare Turso vs Local
      for (const tApp of uniqueTursoApplicants) {
        const name1 = [tApp.first_name, tApp.middle_initial, tApp.last_name, tApp.suffix]
            .filter(Boolean).join(' ').toLowerCase().trim();
        const dob1 = tApp.date_of_birth; // String from Turso
        //const focal1 = (tApp.focal_name || '').trim().toLowerCase();

        let localMatch = null;

        for (const lApp of localApplicants) {
            const name2 = [lApp.first_name, lApp.middle_initial, lApp.last_name, lApp.suffix]
                .filter(Boolean).join(' ').toLowerCase().trim();
            
            // Normalize Local Date (Date object) to String YYYY-MM-DD
            let dob2 = lApp.date_of_birth;
            if (dob2 && dob2 instanceof Date) {
                // Use local time components to avoid UTC shift causing wrong date
                const year = dob2.getFullYear();
                const month = String(dob2.getMonth() + 1).padStart(2, '0');
                const day = String(dob2.getDate()).padStart(2, '0');
                dob2 = `${year}-${month}-${day}`;
            }
            
            const focal2 = (lApp.focal_name || '').trim().toLowerCase();

            // Strict checks
            if (dob1 && dob2 && dob1 !== dob2) continue;
            // Only enforce strict focal match if Turso has a value. 
            // If Turso is empty/null, allow match with Local (which might be assigned).
            //if (focal1 && focal1 !== focal2) continue;

            // Fuzzy Name check
            if (Math.abs(name1.length - name2.length) > 3) continue;
            const dist = levenshtein(name1, name2);
            const threshold = name1.length > 4 ? 2 : 0;

            if (dist <= threshold) {
                localMatch = lApp;
                break;
            }
        }

        if (localMatch) {
            // Found in local DB -> Update it using the local ID
            // Preserve local focal_name if Turso's is empty (don't overwrite assignment with null)
            const mergedApp = { ...tApp, id: localMatch.id };
            if (!tApp.focal_name && localMatch.focal_name) {
                mergedApp.focal_name = localMatch.focal_name;
            }
            toUpdate.push(mergedApp);
        } else {
            // Not found -> Insert
            toInsert.push(tApp);
        }
      }
      
      // 5. Execute Batch Operations

      // Batch Insert
      if (toInsert.length > 0) {
          const sample = toInsert[0];
          const columns = Object.keys(sample).filter(key => key !== 'id' && key !== 'rowid');
          if (columns.length > 0) {
            const sql = `INSERT INTO profile_entries (${columns.join(', ')}) VALUES ?`;
            const values = toInsert.map(app => columns.map(col => app[col]));
            await connection.query(sql, [values]);
          }
      }

      // Batch Update (using INSERT ... ON DUPLICATE KEY UPDATE with ID)
      if (toUpdate.length > 0) {
          const sample = toUpdate[0];
          // Ensure 'id' is the first column for clarity
          const columns = ['id', ...Object.keys(sample).filter(key => key !== 'id' && key !== 'rowid')];
          
          // Generate update clause: col=VALUES(col) for all columns EXCEPT id
          const updateClause = columns
            .filter(col => col !== 'id')
            .map(col => `${col}=VALUES(${col})`)
            .join(', ');

          const sql = `INSERT INTO profile_entries (${columns.join(', ')}) VALUES ? ON DUPLICATE KEY UPDATE ${updateClause}`;
          const values = toUpdate.map(app => columns.map(col => app[col]));
          
          await connection.query(sql, [values]);
      }

      await connection.commit();

      // 6. Delete synced records from Turso (clear the online queue)
      const syncedApps = [...toInsert, ...toUpdate];
      if (syncedApps.length > 0) {
        for (const app of syncedApps) {
          try {
            const deleteSql = `
              DELETE FROM profile_entries
              WHERE (first_name = ? OR (first_name IS NULL AND ? IS NULL))
                AND (last_name = ? OR (last_name IS NULL AND ? IS NULL))
                AND (date_of_birth = ? OR (date_of_birth IS NULL AND ? IS NULL))
            `;
            const dob = app.date_of_birth instanceof Date
              ? `${app.date_of_birth.getFullYear()}-${String(app.date_of_birth.getMonth()+1).padStart(2,'0')}-${String(app.date_of_birth.getDate()).padStart(2,'0')}`
              : app.date_of_birth;
            await executeTurso(deleteSql, [
              app.first_name, app.first_name,
              app.last_name, app.last_name,
              dob, dob,
            ]);
          } catch (tursoErr) {
            console.warn(`Could not delete synced record from Turso: ${tursoErr.message}`);
          }
        }
      }

      res.json({ 
          message: `Sync complete. Added: ${toInsert.length}, Updated: ${toUpdate.length}.`,
          stats: { added: toInsert.length, updated: toUpdate.length }
      });
    } catch (dbErr) {
      await connection.rollback();
      throw dbErr;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error(`Sync error: ${err.message}`);
    res.status(500).json({ error: 'Failed to sync data.' });
  }
});

// --- PUT /api/applicants/:id/assign ---
router.put('/:id/assign', async (req, res) => {
  const { id } = req.params;
  const { interviewer_id } = req.body;

  if (!interviewer_id) {
    return res.status(400).json({ error: 'Interviewer ID is required.' });
  }

  try {
    // 1. Get Interviewer Name from Users table
    const [userRows] = await dbPool.query(
      "SELECT first_name, middle_initial, last_name, suffix FROM users WHERE id = ?",
      [interviewer_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'Interviewer not found.' });
    }

    const u = userRows[0];
    const interviewerName = [u.first_name, u.middle_initial, u.last_name, u.suffix].filter(Boolean).join(' ');

    // 2. Update profile_entries locally
    await dbPool.query("UPDATE profile_entries SET interviewer = ?, interview_status = 'For Interview' WHERE id = ?", [interviewerName, id]);

    res.json({ message: 'Interviewer assigned successfully.', interviewer: interviewerName });
  } catch (err) {
    console.error(`Error assigning interviewer: ${err.message}`);
    res.status(500).json({ error: 'Failed to assign interviewer.' });
  }
});

// --- GET /api/applicants/transmit-options ---
// Fetch distinct surveys from profile_entries that have completed interviews, joined with focal person info
router.get('/transmit-options', verifyToken, async (req, res) => {
  try {
      const query = `
          SELECT DISTINCT pe.survey_name, s.focal_person_id, CONCAT(u.first_name, ' ', u.last_name) as focal_person_name
          FROM profile_entries pe
          LEFT JOIN surveys s ON pe.survey_name = s.name
          LEFT JOIN users u ON s.focal_person_id = u.id
          WHERE pe.interview_status = 'Returned to PACD' 
            AND pe.focal_id IS NULL
            AND pe.survey_name IS NOT NULL 
            AND pe.survey_name != ''
          ORDER BY pe.survey_name
      `;
      const [rows] = await dbPool.query(query);
      res.json(rows);
  } catch (err) {
      console.error(`Error fetching transmit options: ${err.message}`);
      res.status(500).json({ error: 'Failed to fetch survey options.' });
  }
});

// --- POST /api/applicants/transmit ---
// Transmit applicants of a specific survey to a focal person
router.post('/transmit', verifyToken, async (req, res) => {
  const { survey_name, focal_id } = req.body;
  if (!survey_name || !focal_id) return res.status(400).json({ error: 'Missing survey or focal person information.' });

  try {
      // Check for applicants missing a pre-assessment score
      const [unscored] = await dbPool.query(
          "SELECT first_name, last_name FROM profile_entries WHERE survey_name = ? AND interview_status = 'Returned to PACD' AND focal_id IS NULL AND (pre_assessment IS NULL OR pre_assessment = 'null')",
          [survey_name]
      );
      if (unscored.length > 0) {
          const names = unscored.map(r => `${r.first_name} ${r.last_name}`).join(', ');
          return res.status(400).json({ error: `Cannot transmit — the following applicants have not been pre-assessed: ${names}` });
      }

      const [result] = await dbPool.query(
          "UPDATE profile_entries SET focal_id = ?, interview_status = 'Transmitted to Focal Person' WHERE survey_name = ? AND interview_status = 'Returned to PACD' AND focal_id IS NULL",
          [focal_id, survey_name]
      );
      res.json({ message: `Successfully transmitted ${result.affectedRows} applicant(s).` });
  } catch (err) {
      console.error(`Error transmitting applicants: ${err.message}`);
      res.status(500).json({ error: 'Failed to transmit applicants.' });
  }
});

// --- PUT /api/applicants/:id/interview-status ---
// Update only the interview_status field
router.put('/:id/interview-status', verifyToken, async (req, res) => {
  const { id } = req.params;
  const { interview_status } = req.body;
  if (!interview_status) return res.status(400).json({ error: 'interview_status is required.' });
  try {
    await dbPool.query("UPDATE profile_entries SET interview_status = ? WHERE id = ?", [interview_status, id]);
    res.json({ message: 'Status updated successfully.' });
  } catch (err) {
    console.error(`Error updating interview status: ${err.message}`);
    res.status(500).json({ error: 'Failed to update interview status.' });
  }
});

// --- PUT /api/applicants/:id/interview-result ---
// Save interview assessment: criteria -> interview_rating JSON, average -> pre_assessment JSON
router.put('/:id/interview-result', verifyToken, async (req, res) => {
  const { id } = req.params;
  const {
    professionalism, interpersonal, organization,
    written_communication, oral_communication, digital_literacy,
    average_score, remarks, interview_status
  } = req.body;

  try {
    // Build interview_rating JSON (all criteria scores + remarks, no average)
    const interviewRating = JSON.stringify({
      professionalism,
      interpersonal,
      organization,
      written_communication,
      oral_communication,
      digital_literacy,
      remarks: remarks || ''
    });

    // Merge interview_average into the existing pre_assessment JSON
    const [rows] = await dbPool.query("SELECT pre_assessment FROM profile_entries WHERE id = ?", [id]);
    const existingPA = rows.length > 0 && rows[0].pre_assessment
      ? (typeof rows[0].pre_assessment === 'string' ? JSON.parse(rows[0].pre_assessment) : rows[0].pre_assessment)
      : {};
    existingPA.interview_average = (average_score !== undefined && average_score !== null)
      ? parseFloat(average_score)
      : null;
    const updatedPA = JSON.stringify(existingPA);

    await dbPool.query(
      "UPDATE profile_entries SET interview_rating = ?, pre_assessment = ?, interview_status = ? WHERE id = ?",
      [interviewRating, updatedPA, interview_status, id]
    );
    res.json({ message: 'Interview results saved successfully.' });
  } catch (err) {
    console.error(`Error saving interview results: ${err.message}`);
    res.status(500).json({ error: 'Failed to save interview results.' });
  }
});

// --- PUT /api/applicants/:id ---
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const updates = req.body;

  try {
    // 1. Fetch current local record to identify it in Turso (before update)
    const [rows] = await dbPool.query("SELECT * FROM profile_entries WHERE id = ?", [id]);
    if (rows.length === 0) {
        return res.status(404).json({ error: 'Applicant not found.' });
    }
    const currentRecord = rows[0];

    // 2. Update Local DB
    const columns = Object.keys(updates).filter(k => k !== 'id' && k !== 'actingUserId');
    if (columns.length > 0) {
        const setClause = columns.map(col => `${col} = ?`).join(', ');
        const values = columns.map(col => updates[col]);
        values.push(id);
        await dbPool.query(`UPDATE profile_entries SET ${setClause} WHERE id = ?`, values);
    }

    // 3. Update Turso (Best Effort Match)
    const matchFields = ['first_name', 'last_name', 'middle_initial', 'date_of_birth'];
    const whereConditions = [];
    const whereArgs = [];
    
    matchFields.forEach(field => {
        if (currentRecord[field]) {
            whereConditions.push(`${field} = ?`);
            let val = currentRecord[field];
            if (field === 'date_of_birth' && val instanceof Date) val = val.toISOString().split('T')[0];
            whereArgs.push(val);
        } else {
            whereConditions.push(`${field} IS NULL`);
        }
    });

    // Only attempt Turso update if we have conditions to match
    if (whereConditions.length > 0 && columns.length > 0) {
        const setClauseTurso = columns.map(col => `${col} = ?`).join(', ');
        const setArgsTurso = columns.map(col => updates[col]);
        const sql = `UPDATE profile_entries SET ${setClauseTurso} WHERE ${whereConditions.join(' AND ')}`;
        await executeTurso(sql, [...setArgsTurso, ...whereArgs]);
    }

    res.json({ message: 'Applicant updated successfully.' });
  } catch (err) {
    console.error(`Error updating applicant: ${err.message}`);
    res.status(500).json({ error: 'Failed to update applicant.' });
  }
});

// --- DELETE /api/applicants/:id ---
// Deletes from local DB only
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    await dbPool.query("DELETE FROM profile_entries WHERE id = ?", [id]);
    res.json({ message: 'Applicant deleted from local database.' });
  } catch (err) {
    console.error(`Error deleting applicant: ${err.message}`);
    res.status(500).json({ error: 'Failed to delete applicant.' });
  }
});

// --- PUT /api/applicants/:id/pre-assessment ---
router.put('/:id/pre-assessment', async (req, res) => {
  const { id } = req.params;
  const { educational_attainment, relevant_training, relevant_work_experience, written_examination } = req.body;

  try {
    const assessment = {
      educational_attainment: educational_attainment ?? null,
      relevant_training: relevant_training ?? null,
      relevant_work_experience: relevant_work_experience ?? null,
      written_examination: written_examination ?? null,
    };
    await dbPool.query(
      "UPDATE profile_entries SET pre_assessment = ? WHERE id = ?",
      [JSON.stringify(assessment), id]
    );
    res.json({ message: 'Pre-assessment saved.' });
  } catch (err) {
    console.error('Pre-assessment save error:', err.message);
    res.status(500).json({ error: 'Failed to save pre-assessment.' });
  }
});

module.exports = router;