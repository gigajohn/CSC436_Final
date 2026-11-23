import path from 'node:path';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export interface QueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface IDatabase {
  query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  isAlive(): Promise<boolean>;
}

class PGliteDatabaseAdapter implements IDatabase {
  private pglite: PGlite | null = null;
  private readonly dataDir: string;

  constructor(dataDir?: string) {
    this.dataDir = dataDir || path.resolve(process.cwd(), 'data', 'postgres');
  }

  private async ensureInitialized(): Promise<PGlite> {
    if (this.pglite) return this.pglite;

    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    this.pglite = new PGlite(this.dataDir);
    await this.pglite.waitReady;
    return this.pglite;
  }

  public async query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const db = await this.ensureInitialized();
    const result = await db.query<T>(sql, params as any[]);
    return {
      rows: result.rows,
      rowCount: result.rows.length,
    };
  }

  public async exec(sql: string): Promise<void> {
    const db = await this.ensureInitialized();
    await db.exec(sql);
  }

  public async isAlive(): Promise<boolean> {
    try {
      const db = await this.ensureInitialized();
      const res = await db.query('SELECT 1 as alive');
      return res.rows.length > 0;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    if (this.pglite) {
      await this.pglite.close();
      this.pglite = null;
    }
  }
}

class PgPoolDatabaseAdapter implements IDatabase {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      connectionTimeoutMillis: 3000,
      idleTimeoutMillis: 10000,
    });
  }

  public async query<T = any>(sql: string, params?: unknown[]): Promise<QueryResult<T>> {
    const result = await this.pool.query<any>(sql, params);
    return {
      rows: result.rows as T[],
      rowCount: result.rowCount ?? result.rows.length,
    };
  }

  public async exec(sql: string): Promise<void> {
    await this.pool.query(sql);
  }

  public async isAlive(): Promise<boolean> {
    try {
      const res = await this.pool.query('SELECT 1 as alive');
      return (res.rowCount ?? 0) > 0;
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

let activeDbInstance: IDatabase | null = null;

export function getDb(): IDatabase {
  if (activeDbInstance) return activeDbInstance;

  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl && dbUrl.startsWith('postgresql://') && !dbUrl.includes('localhost:5432/studysync_dev')) {
    activeDbInstance = new PgPoolDatabaseAdapter(dbUrl);
  } else {
    // Persistent PostgreSQL database backed by disk storage
    activeDbInstance = new PGliteDatabaseAdapter();
  }

  return activeDbInstance;
}

export async function resetDatabaseConnection(): Promise<void> {
  if (activeDbInstance) {
    await activeDbInstance.close();
    activeDbInstance = null;
  }
}

/**
 * Probes database health with latency measurement without exposing credentials.
 */
export async function checkDatabaseHealth(): Promise<{ status: 'connected' | 'disconnected'; latencyMs: number }> {
  const db = getDb();
  const start = performance.now();
  try {
    const alive = await db.isAlive();
    const latencyMs = Math.round(performance.now() - start);
    return {
      status: alive ? 'connected' : 'disconnected',
      latencyMs,
    };
  } catch {
    return {
      status: 'disconnected',
      latencyMs: Math.round(performance.now() - start),
    };
  }
}
