const express = require('express');
const router = express.Router();
const dbPool = require('../db');

// GET /api/municipalities
router.get('/municipalities', async (req, res) => {
  try {
    const [results] = await dbPool.query("SELECT * FROM municipalities ORDER BY name");
    res.json(results);
  } catch (err) {
    console.error(`Database error fetching municipalities: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve municipality data.' });
  }
});

// GET /api/barangays/:municipalityId
router.get('/barangays/:municipalityId', async (req, res) => {
  const { municipalityId } = req.params;
  try {
    const [results] = await dbPool.query("SELECT * FROM barangays WHERE municipality_id = ? ORDER BY name", [municipalityId]);
    res.json(results);
  } catch (err) {
    console.error(`Database error fetching barangays: ${err.message}`);
    res.status(500).json({ error: 'Failed to retrieve barangay data.' });
  }
});

module.exports = router;