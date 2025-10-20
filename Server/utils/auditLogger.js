const dbPool = require('../db'); // adjust path if needed

/**
 * Log an audit event
 * @param {number} userId - User performing the action
 * @param {string} action - Action type (CREATE, UPDATE, DELETE, IMPORT, etc.)
 * @param {string} entity - Entity name (training, training_title, user, etc.)
 * @param {number|null} entityId - The ID of the affected entity row
 * @param {object|null} oldData - Previous state (if any)
 * @param {object|null} newData - New state (if any)
 */
async function logAudit(userId, action, entity, entityId = null, oldData = null, newData = null) {
  try {
    await dbPool.query(
      `INSERT INTO audit_logs (user_id, action, entity, entity_id, old_data, new_data)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        userId,
        action,
        entity,
        entityId,
        oldData ? JSON.stringify(oldData) : null,
        newData ? JSON.stringify(newData) : null
      ]
    );
  } catch (err) {
    console.error('❌ Failed to write audit log:', err.message);
  }
}

module.exports = { logAudit };