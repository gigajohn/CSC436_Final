import { IDatabase, getDb } from './connection.js';

export interface Migration {
  id: string;
  name: string;
  up: (db: IDatabase) => Promise<void>;
  down: (db: IDatabase) => Promise<void>;
}

export const migration001: Migration = {
  id: '001',
  name: '001_core_relational_schema',
  up: async (db: IDatabase) => {
    // 1. Users Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK (role IN ('student', 'reviewer', 'instructor', 'admin')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 2. Assignments Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS assignments (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        course_code TEXT NOT NULL,
        description TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('draft', 'open', 'closed', 'archived')),
        due_date TIMESTAMPTZ NOT NULL,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 3. Code Submissions Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS code_submissions (
        id TEXT PRIMARY KEY,
        assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
        student_id TEXT NOT NULL REFERENCES users(id),
        repository_url TEXT NOT NULL,
        commit_sha TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'under_review', 'reviewed')),
        line_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 4. Line Comments Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS line_comments (
        id TEXT PRIMARY KEY,
        submission_id TEXT NOT NULL REFERENCES code_submissions(id) ON DELETE CASCADE,
        author_id TEXT NOT NULL REFERENCES users(id),
        file_path TEXT NOT NULL,
        line_number INT NOT NULL CHECK (line_number > 0),
        comment_text TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'suggestion' CHECK (severity IN ('suggestion', 'issue', 'blocker', 'praise')),
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // 5. Append-Only Audit Trail Table
    await db.query(`
      CREATE TABLE IF NOT EXISTS audit_trail (
        id SERIAL PRIMARY KEY,
        actor_id TEXT NOT NULL,
        actor_label TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        before_state JSONB,
        after_state JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // --- Explicit Indexes with Justifications (Requirement F4) ---

    // Index 1 Justification: Optimizes student submission existence lookups and assignment dashboard aggregation without sequential full-table scans.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_code_submissions_assignment_student 
      ON code_submissions (assignment_id, student_id);
    `);

    // Index 2 Justification: Rapidly clusters code review comments per source file when rendering submission diffs.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_line_comments_submission_file 
      ON line_comments (submission_id, file_path);
    `);

    // Index 3 Justification: Accelerates forensic history queries reconstructing chronological changes for a specific resource.
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_audit_trail_resource 
      ON audit_trail (resource_type, resource_id, created_at DESC);
    `);

    // --- Database-Level Immutability Enforcement (Requirement F6) ---
    await db.exec(`
      CREATE OR REPLACE FUNCTION prevent_audit_tampering() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'Audit trail records are immutable: UPDATE and DELETE operations are strictly prohibited.';
      END;
      $$ LANGUAGE plpgsql;

      DROP TRIGGER IF EXISTS trg_audit_trail_immutable ON audit_trail;
      CREATE TRIGGER trg_audit_trail_immutable
      BEFORE UPDATE OR DELETE ON audit_trail
      FOR EACH ROW
      EXECUTE FUNCTION prevent_audit_tampering();
    `);

    // --- Synthetic Seed Data (Hard Gate 5: No real personal data) ---
    await db.query(`
      INSERT INTO users (id, email, full_name, role) VALUES
        ('usr-ada', 'ada.lovelace@synthetic.studysync.edu', 'Ada Lovelace', 'instructor'),
        ('usr-grace', 'grace.hopper@synthetic.studysync.edu', 'Grace Hopper', 'reviewer'),
        ('usr-alan', 'alan.turing@synthetic.studysync.edu', 'Alan Turing', 'student')
      ON CONFLICT (id) DO NOTHING;
    `);

    await db.query(`
      INSERT INTO assignments (id, title, course_code, description, status, due_date, created_by) VALUES
        ('asg-001', 'Distributed Key-Value Store', 'CSC436', 'Build a replicated KV store with quorum read/write.', 'open', '2026-12-05T23:59:59Z', 'usr-ada'),
        ('asg-002', 'Raft Consensus Protocol Implementation', 'CSC436', 'Implement leader election and log replication.', 'open', '2026-12-15T23:59:59Z', 'usr-ada')
      ON CONFLICT (id) DO NOTHING;
    `);

    await db.query(`
      INSERT INTO code_submissions (id, assignment_id, student_id, repository_url, commit_sha, status, line_count) VALUES
        ('sub-001', 'asg-001', 'usr-alan', 'https://github.com/synthetic/kvstore', 'a1b2c3d4e5f6', 'under_review', 420)
      ON CONFLICT (id) DO NOTHING;
    `);
  },

  down: async (db: IDatabase) => {
    await db.exec(`
      DROP TRIGGER IF EXISTS trg_audit_trail_immutable ON audit_trail;
      DROP FUNCTION IF EXISTS prevent_audit_tampering();
      DROP INDEX IF EXISTS idx_audit_trail_resource;
      DROP INDEX IF EXISTS idx_line_comments_submission_file;
      DROP INDEX IF EXISTS idx_code_submissions_assignment_student;
      DROP TABLE IF EXISTS line_comments CASCADE;
      DROP TABLE IF EXISTS code_submissions CASCADE;
      DROP TABLE IF EXISTS assignments CASCADE;
      DROP TABLE IF EXISTS users CASCADE;
      DROP TABLE IF EXISTS audit_trail CASCADE;
    `);
  },
};

export const migration002: Migration = {
  id: '002',
  name: '002_reversible_rubric_weights',
  up: async (db: IDatabase) => {
    // Adds configurable rubric weights and max reviewer limit
    await db.query(`
      ALTER TABLE assignments 
      ADD COLUMN IF NOT EXISTS rubric_weights JSONB DEFAULT '{"correctness": 60, "testing": 20, "style": 20}'::jsonb;
    `);
    await db.query(`
      ALTER TABLE assignments 
      ADD COLUMN IF NOT EXISTS max_reviewers INT DEFAULT 3;
    `);
  },

  down: async (db: IDatabase) => {
    // Clean reversible down migration (Requirement F5)
    await db.query(`ALTER TABLE assignments DROP COLUMN IF EXISTS rubric_weights;`);
    await db.query(`ALTER TABLE assignments DROP COLUMN IF EXISTS max_reviewers;`);
  },
};

export const ALL_MIGRATIONS: Migration[] = [migration001, migration002];

export class Migrator {
  private customDb?: IDatabase;

  constructor(db?: IDatabase) {
    this.customDb = db;
  }

  private getDb(): IDatabase {
    return this.customDb || getDb();
  }

  public async ensureMigrationsTable(): Promise<void> {
    await this.getDb().query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  public async getAppliedMigrationNames(): Promise<string[]> {
    await this.ensureMigrationsTable();
    const result = await this.getDb().query<{ name: string }>(
      'SELECT name FROM schema_migrations ORDER BY id ASC'
    );
    return result.rows.map((r) => r.name);
  }

  /**
   * Applies all pending forward migrations.
   */
  public async migrateUp(): Promise<string[]> {
    await this.ensureMigrationsTable();
    const applied = await this.getAppliedMigrationNames();
    const newlyApplied: string[] = [];

    for (const migration of ALL_MIGRATIONS) {
      if (!applied.includes(migration.name)) {
        console.log(`[Migrator] Applying UP: ${migration.name}...`);
        await migration.up(this.getDb());
        await this.getDb().query(
          'INSERT INTO schema_migrations (name) VALUES ($1)',
          [migration.name]
        );
        newlyApplied.push(migration.name);
        console.log(`[Migrator] ✓ Applied: ${migration.name}`);
      }
    }

    return newlyApplied;
  }

  /**
   * Reverts the most recently applied migration (Requirement F5).
   */
  public async rollbackLatest(): Promise<string | null> {
    await this.ensureMigrationsTable();
    const applied = await this.getAppliedMigrationNames();
    if (applied.length === 0) {
      console.log('[Migrator] No migrations to revert.');
      return null;
    }

    const latestName = applied[applied.length - 1];
    const migration = ALL_MIGRATIONS.find((m) => m.name === latestName);

    if (!migration) {
      throw new Error(`Cannot rollback unknown migration: ${latestName}`);
    }

    console.log(`[Migrator] Rolling back DOWN: ${migration.name}...`);
    await migration.down(this.getDb());
    await this.getDb().query(
      'DELETE FROM schema_migrations WHERE name = $1',
      [migration.name]
    );
    console.log(`[Migrator] ✓ Rolled back: ${migration.name}`);

    return migration.name;
  }
}

export const migrator = new Migrator();
