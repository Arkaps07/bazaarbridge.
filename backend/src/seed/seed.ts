import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { envConfig } from '../config/env';
import { getPool } from '../db/pool';
import { ensureIndex, upsertOfferDoc } from '../search/opensearch';
import { buildSeedDataset } from './seedData';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runSeed() {
  if (!envConfig.isPgConfigured) {
    console.error('PG_URI is not configured in .env. Set PG_URI to seed Aiven PostgreSQL.');
    process.exit(1);
  }

  const pool = getPool()!;
  const schemaPath = path.resolve(__dirname, '../db/schema.sql');
  const schemaSql = fs.readFileSync(schemaPath, 'utf8');

  console.log('Applying schema.sql to PostgreSQL...');
  await pool.query(schemaSql);

  const data = buildSeedDataset();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const u of data.users) {
      await client.query(
        `INSERT INTO users (user_id, name, email, password_hash, role)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name, role = EXCLUDED.role`,
        [u.user_id, u.name, u.email, u.password_hash, u.role]
      );
    }

    for (const c of data.categories) {
      await client.query(
        `INSERT INTO categories (category_id, category_name)
         VALUES ($1,$2) ON CONFLICT (category_id) DO NOTHING`,
        [c.category_id, c.category_name]
      );
    }

    for (const l of data.stock_locations) {
      await client.query(
        `INSERT INTO stock_locations (location_id, name, city, state, location_type, is_home, is_sellable)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (location_id) DO NOTHING`,
        [l.location_id, l.name, l.city, l.state, l.location_type, l.is_home, l.is_sellable]
      );
    }

    for (const h of data.fulfilment_hubs) {
      await client.query(
        `INSERT INTO fulfilment_hubs (hub_id, location_id, address, hours, active, order_capacity, delivery_radius_km)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (hub_id) DO NOTHING`,
        [h.hub_id, h.location_id, h.address, JSON.stringify(h.hours), h.active, h.order_capacity, h.delivery_radius_km]
      );
    }

    for (const a of data.hub_service_areas) {
      await client.query(
        `INSERT INTO hub_service_areas (area_id, hub_id, pin_code)
         VALUES ($1,$2,$3) ON CONFLICT (pin_code) DO NOTHING`,
        [a.area_id, a.hub_id, a.pin_code]
      );
    }

    for (const d of data.dealers) {
      await client.query(
        `INSERT INTO dealers (dealer_id, shop_name, city, state, contact, dealer_rating, total_reviews, verified, supplier_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (dealer_id) DO NOTHING`,
        [d.dealer_id, d.shop_name, d.city, d.state, d.contact, d.dealer_rating, d.total_reviews, d.verified, d.supplier_status]
      );
    }

    for (const p of data.products) {
      await client.query(
        `INSERT INTO products (product_id, name, description, brand, category_id, specs)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (product_id) DO NOTHING`,
        [p.product_id, p.name, p.description, p.brand, p.category_id, JSON.stringify(p.specs)]
      );
    }

    for (const o of data.dealer_offers) {
      await client.query(
        `INSERT INTO dealer_offers (offer_id, product_id, dealer_id, purchase_price, selling_price, status, bangalore_delivery_days, transfer_days_min, transfer_days_max, eligible_modes, warranty_months, warranty_note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (offer_id) DO NOTHING`,
        [
          o.offer_id,
          o.product_id,
          o.dealer_id,
          o.purchase_price,
          o.selling_price,
          o.status,
          o.bangalore_delivery_days,
          o.transfer_days_min,
          o.transfer_days_max,
          o.eligible_modes,
          o.warranty_months,
          o.warranty_note,
        ]
      );
    }

    for (const inv of data.inventory) {
      await client.query(
        `INSERT INTO inventory (offer_id, location_id, quantity, reserved_quantity)
         VALUES ($1,$2,$3,$4) ON CONFLICT (offer_id, location_id) DO NOTHING`,
        [inv.offer_id, inv.location_id, inv.quantity, inv.reserved_quantity]
      );
    }

    for (const hist of data.historical_prices) {
      await client.query(
        `INSERT INTO offer_price_history (offer_id, selling_price, valid_from, valid_to)
         VALUES ($1,$2,$3,$4)`,
        [hist.offer_id, hist.selling_price, hist.valid_from, hist.valid_to]
      );
    }

    for (const cp of data.coupons) {
      await client.query(
        `INSERT INTO coupons (coupon_id, code, kind, value, min_basket_paise, max_redemptions, redeemed_count, per_customer_limit, valid_from, valid_to, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (code) DO NOTHING`,
        [
          cp.coupon_id,
          cp.code,
          cp.kind,
          cp.value,
          cp.min_basket_paise,
          cp.max_redemptions,
          cp.redeemed_count,
          cp.per_customer_limit,
          cp.valid_from,
          cp.valid_to,
          cp.active,
        ]
      );
    }

    for (const addr of data.customer_addresses) {
      await client.query(
        `INSERT INTO customer_addresses (address_id, user_id, label, recipient_name, phone, line1, line2, landmark, city, state, pin_code, instructions, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (address_id) DO NOTHING`,
        [
          addr.address_id,
          addr.user_id,
          addr.label,
          addr.recipient_name,
          addr.phone,
          addr.line1,
          addr.line2,
          addr.landmark,
          addr.city,
          addr.state,
          addr.pin_code,
          addr.instructions,
          addr.is_default,
        ]
      );
    }

    await client.query('COMMIT');
    console.log(`Seeded ${data.products.length} products, ${data.dealers.length} dealers, ${data.dealer_offers.length} offers.`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  if (envConfig.isOpenSearchConfigured) {
    console.log('Ensuring OpenSearch index and syncing offers...');
    await ensureIndex();
    const res = await pool.query(
      `SELECT o.offer_id, o.product_id, p.name AS product_name, p.brand, c.category_name, p.specs,
              d.dealer_id, d.shop_name, d.city AS dealer_city, d.state AS dealer_state,
              o.selling_price, o.eligible_modes, o.bangalore_delivery_days, o.transfer_days_max,
              d.dealer_rating, d.total_reviews, d.verified, o.warranty_months, v.revision,
              COALESCE(SUM(CASE WHEN l.is_sellable AND (h.hub_id IS NULL OR h.active)
                THEN i.quantity - i.reserved_quantity ELSE 0 END), 0) AS available_units,
              COALESCE(SUM(CASE WHEN l.is_sellable AND l.is_home
                THEN i.quantity - i.reserved_quantity ELSE 0 END), 0) AS home_units
         FROM dealer_offers o
         JOIN products p ON p.product_id = o.product_id
         JOIN categories c ON c.category_id = p.category_id
         JOIN dealers d ON d.dealer_id = o.dealer_id
         JOIN offer_state_versions v ON v.offer_id = o.offer_id
         LEFT JOIN inventory i ON i.offer_id = o.offer_id
         LEFT JOIN stock_locations l ON l.location_id = i.location_id
         LEFT JOIN fulfilment_hubs h ON h.location_id = l.location_id
        GROUP BY o.offer_id, p.product_id, c.category_id, d.dealer_id, v.revision`
    );

    for (const row of res.rows) {
      const homeUnits = Number(row.home_units);
      const isOutside = row.dealer_city.toLowerCase() !== 'bengaluru';
      await upsertOfferDoc({
        offer_id: row.offer_id,
        product_id: row.product_id,
        product_name: row.product_name,
        brand: row.brand,
        category_name: row.category_name,
        specs: row.specs || {},
        dealer_id: row.dealer_id,
        shop_name: row.shop_name,
        dealer_city: row.dealer_city,
        dealer_state: row.dealer_state,
        origin_city: homeUnits > 0 ? 'Bengaluru' : row.dealer_city,
        origin_state: row.dealer_state,
        is_outside_bangalore: isOutside,
        fulfilment_route: homeUnits > 0 ? 'standard' : 'transfer',
        selling_price: Number(row.selling_price),
        available_units: Number(row.available_units),
        home_units: homeUnits,
        eligible_modes: row.eligible_modes || ['standard'],
        bangalore_delivery_days: row.bangalore_delivery_days,
        transfer_days_max: row.transfer_days_max,
        effective_days: homeUnits > 0 ? (row.bangalore_delivery_days ?? 2) : (row.transfer_days_max ?? 3),
        dealer_rating: Number(row.dealer_rating),
        total_reviews: Number(row.total_reviews),
        verified: Boolean(row.verified),
        warranty_months: Number(row.warranty_months),
        revision: Number(row.revision),
      });
    }
    console.log(`Synced ${res.rows.length} offers to OpenSearch.`);
  }

  await pool.end();
}

runSeed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
