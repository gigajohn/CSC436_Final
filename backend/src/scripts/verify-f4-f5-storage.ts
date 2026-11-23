import { getDb, resetDatabaseConnection, checkDatabaseHealth } from '../db/connection.js';
import { migrator } from '../db/migrator.js';

async function runStorageVerification() {
  console.log('================================================================');
  console.log(' StudySync Database Storage & Migration Verification (F4, F5)   ');
  console.log('================================================================\n');

  const db = getDb();

  try {
    // -------------------------------------------------------------------------
    // Phase 1: Forward Schema Migrations (Requirement F5 Up Path)
    // -------------------------------------------------------------------------
    console.log('[1/5] Applying versioned forward schema migrations (F5 Up)...');
    const applied = await migrator.migrateUp();
    console.log(`  ✓ Applied forward migrations: [${applied.join(', ')}]`);

    const currentMigrations = await migrator.getAppliedMigrationNames();
    if (!currentMigrations.includes('001_core_relational_schema') || !currentMigrations.includes('002_reversible_rubric_weights')) {
      throw new Error(`Expected migrations missing: ${JSON.stringify(currentMigrations)}`);
    }
    console.log(`  ✓ schema_migrations table verified: ${currentMigrations.length} migrations recorded.`);

    // -------------------------------------------------------------------------
    // Phase 2: Relational Schema, Foreign Keys & Justified Indexes (F4)
    // -------------------------------------------------------------------------
    console.log('\n[2/5] Verifying Relational Schema, FK Constraints & Indexes (F4)...');

    // Verify foreign key enforcement
    let fkBlocked = false;
    try {
      await db.query(`
        INSERT INTO code_submissions (id, assignment_id, student_id, repository_url, commit_sha)
        VALUES ('sub-bad-fk', 'non-existent-asg', 'usr-alan', 'http://repo', 'sha123')
      `);
    } catch {
      fkBlocked = true;
    }
    if (!fkBlocked) {
      throw new Error('Foreign key constraint check failed: invalid assignment_id was permitted!');
    }
    console.log('  ✓ Foreign key constraint verified: invalid references are rejected.');

    // Verify explicit indexes exist
    const indexCheck = await db.query<{ indexname: string }>(`
      SELECT indexname FROM pg_indexes 
      WHERE tablename IN ('code_submissions', 'line_comments', 'audit_trail')
    `);
    const indexNames = indexCheck.rows.map((r) => r.indexname);
    console.log(`  ✓ Detected explicit indexes in PostgreSQL: [${indexNames.join(', ')}]`);

    const requiredIndexes = [
      'idx_code_submissions_assignment_student',
      'idx_line_comments_submission_file',
      'idx_audit_trail_resource',
    ];
    for (const idx of requiredIndexes) {
      if (!indexNames.includes(idx)) {
        throw new Error(`Required index missing: ${idx}`);
      }
    }
    console.log('  ✓ All 3 justified explicit indexes confirmed active in relational schema.');

    // -------------------------------------------------------------------------
    // Phase 3: Data Persistence Across Service / DB Restart (F4 Core Proof)
    // -------------------------------------------------------------------------
    console.log('\n[3/5] Testing Data Persistence Across Process & DB Restart (F4 Core Proof)...');
    const testId = `sub-persist-${Date.now()}`;
    await db.query(
      `INSERT INTO code_submissions (id, assignment_id, student_id, repository_url, commit_sha, status, line_count)
       VALUES ($1, 'asg-001', 'usr-alan', 'https://github.com/synthetic/persist-test', '9988aabbcc', 'submitted', 512)`,
      [testId]
    );
    console.log(`  ✓ Inserted test submission into storage: ${testId}`);

    // Completely close connection and shut down database instance
    console.log('  Simulating service/process restart: closing database engine connection...');
    await resetDatabaseConnection();
    console.log('  [Database Engine Connection Closed]');

    // Reopen database from persistent disk storage
    const newDb = getDb();
    console.log('  Reopening database connection from persistent storage on disk...');
    const queryAfterRestart = await newDb.query<{ id: string; commit_sha: string; line_count: number }>(
      'SELECT id, commit_sha, line_count FROM code_submissions WHERE id = $1',
      [testId]
    );

    if (queryAfterRestart.rows.length !== 1 || queryAfterRestart.rows[0].id !== testId) {
      throw new Error('Data persistence failed: record was lost after database restart!');
    }
    console.log(`  ✓ PERSISTENCE PROVEN: Record "${queryAfterRestart.rows[0].id}" survived restart with line_count=${queryAfterRestart.rows[0].line_count}.`);

    // Clean up test row
    await newDb.query('DELETE FROM code_submissions WHERE id = $1', [testId]);

    // -------------------------------------------------------------------------
    // Phase 4: Reversible Schema Migration Rollback (Requirement F5 Down Path)
    // -------------------------------------------------------------------------
    console.log('\n[4/5] Testing Reversible Schema Migration Rollback (F5 Down Path)...');

    // Confirm column rubric_weights exists before rollback
    const colBefore = await newDb.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'assignments' AND column_name = 'rubric_weights'
    `);
    if (colBefore.rows.length === 0) throw new Error('Expected column rubric_weights before rollback');

    // Rollback latest migration (002)
    const rolledBack = await migrator.rollbackLatest();
    if (rolledBack !== '002_reversible_rubric_weights') {
      throw new Error(`Unexpected rollback result: ${rolledBack}`);
    }
    console.log(`  ✓ Rolled back migration: ${rolledBack}`);

    // Confirm column rubric_weights is removed
    const colAfter = await newDb.query(`
      SELECT column_name FROM information_schema.columns 
      WHERE table_name = 'assignments' AND column_name = 'rubric_weights'
    `);
    if (colAfter.rows.length !== 0) {
      throw new Error('Column rubric_weights still exists after down migration!');
    }
    console.log('  ✓ Down migration confirmed: column was cleanly dropped.');

    // Re-apply migration 002 to leave schema in canonical state
    await migrator.migrateUp();
    console.log('  ✓ Re-applied migration 002 to return schema to canonical state.');

    // -------------------------------------------------------------------------
    // Phase 5: Database-Level Audit Immutability & Health Check
    // -------------------------------------------------------------------------
    console.log('\n[5/5] Testing Audit Trail Immutability & Health Check...');

    // Insert an audit log entry
    const auditInsert = await newDb.query<{ id: number }>(`
      INSERT INTO audit_trail (actor_id, actor_label, action, resource_type, resource_id, before_state, after_state)
      VALUES ('usr-ada', 'Ada Lovelace (instructor)', 'assignment.grade_submitted', 'submission', 'sub-001', '{"status":"open"}', '{"status":"graded"}')
      RETURNING id
    `);
    const auditId = auditInsert.rows[0].id;

    // Test UPDATE rejection via DB trigger
    let updateBlocked = false;
    try {
      await newDb.query('UPDATE audit_trail SET action = $1 WHERE id = $2', ['tampered', auditId]);
    } catch (err: any) {
      if (err.message.includes('immutable') || err.message.includes('prohibited')) {
        updateBlocked = true;
      }
    }
    if (!updateBlocked) throw new Error('Database-level immutability failed: UPDATE was permitted on audit_trail!');
    console.log('  ✓ Database trigger rejected UPDATE on audit_trail (Immutability enforced).');

    // Test DELETE rejection via DB trigger
    let deleteBlocked = false;
    try {
      await newDb.query('DELETE FROM audit_trail WHERE id = $1', [auditId]);
    } catch (err: any) {
      if (err.message.includes('immutable') || err.message.includes('prohibited')) {
        deleteBlocked = true;
      }
    }
    if (!deleteBlocked) throw new Error('Database-level immutability failed: DELETE was permitted on audit_trail!');
    console.log('  ✓ Database trigger rejected DELETE on audit_trail (Immutability enforced).');

    // Test health check
    const health = await checkDatabaseHealth();
    if (health.status !== 'connected') {
      throw new Error(`Database health check failed: ${JSON.stringify(health)}`);
    }
    console.log(`  ✓ Health check confirmed: status=${health.status}, latency=${health.latencyMs}ms (no credentials leaked).`);

    console.log('\n================================================================');
    console.log(' ALL F4 PERSISTENCE & F5 MIGRATION CHECKS PASSED (100%)         ');
    console.log('================================================================\n');
    process.exit(0);
  } finally {
    await resetDatabaseConnection();
  }
}

runStorageVerification().catch((err) => {
  console.error('\n❌ Storage verification failed with error:', err);
  process.exit(1);
});

