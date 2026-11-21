import fs from 'fs';
import pg from 'pg';
import { envConfig } from '../config/env';

const { Pool } = pg;

let poolInstance: pg.Pool | null = null;

export function getPool(): pg.Pool | null {
  if (!envConfig.isPgConfigured) return null;
  if (!poolInstance) {
    const sslConfig: pg.PoolConfig['ssl'] = envConfig.kafkaCaPath && fs.existsSync(envConfig.kafkaCaPath)
      ? { rejectUnauthorized: true, ca: fs.readFileSync(envConfig.kafkaCaPath, 'utf8') }
      : { rejectUnauthorized: false };

    poolInstance = new Pool({
      connectionString: envConfig.pgUri,
      ssl: envConfig.pgUri.includes('localhost') || envConfig.pgUri.includes('127.0.0.1') ? false : sslConfig,
      max: 15,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return poolInstance;
}

/**
 * Executes a transaction with v7.2 PostgreSQL deadlock (40P01) retry up to 3 times with jitter.
 */
export async function withPgTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
  maxRetries = 3
): Promise<T> {
  const pool = getPool();
  if (!pool) {
    throw new Error('PG_NOT_CONFIGURED');
  }

  let attempt = 0;
  while (true) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err: unknown) {
      await client.query('ROLLBACK').catch(() => {});
      const pgErr = err as { code?: string };
      if (pgErr?.code === '40P01' && attempt < maxRetries) {
        attempt += 1;
        const jitterMs = 25 + Math.floor(Math.random() * 75) * attempt;
        await new Promise((r) => setTimeout(r, jitterMs));
        continue;
      }
      throw err;
    } finally {
      client.release();
    }
  }
}

/**
 * Shared atomic PostgreSQL stock movement helpers (v7.2 locked contract).
 * Every statement checks rowCount === 1; restockUnits uses INSERT ... ON CONFLICT DO UPDATE upsert.
 */
export async function holdUnitsPg(
  client: pg.PoolClient,
  offerId: string,
  locationId: string,
  qty: number
): Promise<void> {
  const res = await client.query(
    `UPDATE inventory i
        SET reserved_quantity = i.reserved_quantity + $3
       FROM stock_locations l
      WHERE i.offer_id = $1
        AND i.location_id = $2
        AND l.location_id = i.location_id
        AND l.is_sellable = true
        AND (i.quantity - i.reserved_quantity) >= $3
     RETURNING i.inventory_id`,
    [offerId, locationId, qty]
  );
  if (res.rowCount !== 1) {
    const err = new Error('OUT_OF_STOCK');
    (err as Error & { code?: string }).code = 'OUT_OF_STOCK';
    throw err;
  }
}

export async function releaseHoldPg(
  client: pg.PoolClient,
  offerId: string,
  locationId: string,
  qty: number
): Promise<void> {
  const res = await client.query(
    `UPDATE inventory
        SET reserved_quantity = reserved_quantity - $3
      WHERE offer_id = $1
        AND location_id = $2
        AND reserved_quantity >= $3
     RETURNING inventory_id`,
    [offerId, locationId, qty]
  );
  if (res.rowCount !== 1) {
    const err = new Error('STOCK_RELEASE_FAILED');
    (err as Error & { code?: string }).code = 'STOCK_RELEASE_FAILED';
    throw err;
  }
}

export async function deductUnitsPg(
  client: pg.PoolClient,
  offerId: string,
  locationId: string,
  qty: number
): Promise<void> {
  const res = await client.query(
    `UPDATE inventory
        SET quantity = quantity - $3,
            reserved_quantity = reserved_quantity - $3
      WHERE offer_id = $1
        AND location_id = $2
        AND quantity >= $3
        AND reserved_quantity >= $3
     RETURNING inventory_id`,
    [offerId, locationId, qty]
  );
  if (res.rowCount !== 1) {
    const err = new Error('INVENTORY_DEDUCTION_FAILED');
    (err as Error & { code?: string }).code = 'INVENTORY_DEDUCTION_FAILED';
    throw err;
  }
}

export async function restockUnitsPg(
  client: pg.PoolClient,
  offerId: string,
  locationId: string,
  qty: number
): Promise<number> {
  const res = await client.query(
    `INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (offer_id, location_id)
     DO UPDATE SET quantity = inventory.quantity + EXCLUDED.quantity
     RETURNING quantity`,
    [offerId, locationId, qty]
  );
  return Number(res.rows[0].quantity);
}
