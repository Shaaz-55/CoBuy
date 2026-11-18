// ============================================================================
// File: prisma/seed.js
// Owner: Shaaz (Dev 2 — Aggregation Engine)
// Task: Day 15 — Canonical Demo Seed Data from PROJECT_CONTEXT.md
// Run with: node prisma/seed.js
// ============================================================================

const crypto = require('crypto');
const prisma = require('../src/db/prisma');
const { hashPassword } = require('../src/auth/authUtils');
const { formatPointWKT } = require('../src/utils/geoUtils');

/**
 * Viva Note on Database Seeding:
 * Seeding populates the database with initial, predictable records required for development,
 * testing, and demonstrations. 
 * 
 * Idempotency Principle (Safe to run multiple times):
 * Before inserting each row, this script checks whether the record already exists using unique 
 * business identifiers (e.g. email, company contact email, product name). If found, it skips 
 * insertion and retains the existing primary key. This prevents duplicate key constraint violations 
 * without resorting to dangerous DROP or TRUNCATE operations.
 */

async function seed() {
  console.log('🌱 [CoBuy Seed] Starting database seeding...\n');

  // Common password for all demo accounts
  const COMMON_PASSWORD = 'password123';
  const passwordHash = await hashPassword(COMMON_PASSWORD);

  // Dictionaries to track primary keys for relational linking
  const userMap = {};       // username -> user_id
  const supplierMap = {};   // company_name -> supplier_id
  const restaurantMap = {}; // business_name -> restaurant_id
  const productMap = {};    // product_name -> product_id
  const catalogueMap = {};  // 'supplierName:productName' -> catalogue_id

  // --------------------------------------------------------------------------
  // 1. SEED USERS & USER_ROLES
  // Viva Note: prisma.$transaction guarantees that user creation and role mapping
  // succeed or fail together as a single atomic unit of work (ACID Atomicity).
  // --------------------------------------------------------------------------
  console.log('--- 1. Seeding Users & Roles ---');
  const usersToSeed = [
    { username: 'fresh_foods', email: 'fresh_foods@cobuy.test', role: 'supplier' },
    { username: 'green_basket', email: 'green_basket@cobuy.test', role: 'supplier' },
    { username: 'kitchen_a', email: 'kitchen_a@cobuy.test', role: 'restaurant_owner' },
    { username: 'kitchen_b', email: 'kitchen_b@cobuy.test', role: 'restaurant_owner' },
    { username: 'kitchen_c', email: 'kitchen_c@cobuy.test', role: 'restaurant_owner' }
  ];

  for (const u of usersToSeed) {
    const existingUser = await prisma.users.findUnique({
      where: { email: u.email }
    });

    if (existingUser) {
      console.log(`  [skipped] User '${u.username}' (${u.email}) already exists.`);
      userMap[u.username] = existingUser.user_id;
    } else {
      const userId = crypto.randomUUID();
      await prisma.$transaction(async (tx) => {
        await tx.users.create({
          data: {
            user_id: userId,
            username: u.username,
            email: u.email,
            password_hash: passwordHash
          }
        });

        await tx.user_roles.create({
          data: {
            user_id: userId,
            role_name: u.role
          }
        });
      });
      userMap[u.username] = userId;
      console.log(`  [created] User '${u.username}' with role '${u.role}' (${userId})`);
    }
  }

  // --------------------------------------------------------------------------
  // 2. SEED SUPPLIERS
  // Viva Note: Since MySQL spatial POINT columns are unsupported in standard Prisma
  // schema files, we use prisma.$executeRaw with ST_GeomFromText(..., 4326) to store
  // coordinates in standard WGS 84 format (POINT(longitude latitude)).
  // --------------------------------------------------------------------------
  console.log('\n--- 2. Seeding Suppliers ---');
  const suppliersToSeed = [
    {
      companyName: 'Fresh Foods',
      contactEmail: 'fresh@freshfoods.test',
      userKey: 'fresh_foods',
      latitude: 12.9600,
      longitude: 77.6300
    },
    {
      companyName: 'Green Basket',
      contactEmail: 'hello@greenbasket.test',
      userKey: 'green_basket',
      latitude: 12.9250,
      longitude: 77.6050
    }
  ];

  for (const s of suppliersToSeed) {
    const existingSupplier = await prisma.suppliers.findFirst({
      where: { contact_email: s.contactEmail }
    });

    if (existingSupplier) {
      console.log(`  [skipped] Supplier '${s.companyName}' (${s.contactEmail}) already exists.`);
      supplierMap[s.companyName] = existingSupplier.supplier_id;
    } else {
      const supplierId = crypto.randomUUID();
      const userId = userMap[s.userKey];
      const pointWkt = formatPointWKT(s.longitude, s.latitude);

      await prisma.$executeRaw`
        INSERT INTO suppliers (supplier_id, user_id, company_name, contact_email, warehouse_coord)
        VALUES (${supplierId}, ${userId}, ${s.companyName}, ${s.contactEmail}, ST_GeomFromText(${pointWkt}, 4326))
      `;

      supplierMap[s.companyName] = supplierId;
      console.log(`  [created] Supplier '${s.companyName}' (${supplierId})`);
    }
  }

  // --------------------------------------------------------------------------
  // 3. SEED RESTAURANTS (Cloud Kitchens)
  // Viva Note: wallet_balance uses DECIMAL(10,2) to eliminate binary rounding errors
  // common to floating-point numbers in financial applications.
  // --------------------------------------------------------------------------
  console.log('\n--- 3. Seeding Restaurants ---');
  const restaurantsToSeed = [
    {
      businessName: 'Kitchen A',
      userKey: 'kitchen_a',
      latitude: 12.9719,
      longitude: 77.6412,
      addressText: 'Indiranagar, Bengaluru',
      walletBalance: 5000.00
    },
    {
      businessName: 'Kitchen B',
      userKey: 'kitchen_b',
      latitude: 12.9450,
      longitude: 77.6200,
      addressText: 'Koramangala, Bengaluru',
      walletBalance: 5000.00
    },
    {
      businessName: 'Kitchen C',
      userKey: 'kitchen_c',
      latitude: 12.9640,
      longitude: 77.6500,
      addressText: 'HAL, Bengaluru',
      walletBalance: 5000.00
    }
  ];

  for (const r of restaurantsToSeed) {
    const ownerId = userMap[r.userKey];
    const existingRestaurant = await prisma.restaurants.findFirst({
      where: {
        owner_id: ownerId,
        business_name: r.businessName
      }
    });

    if (existingRestaurant) {
      console.log(`  [skipped] Restaurant '${r.businessName}' already exists for owner.`);
      restaurantMap[r.businessName] = existingRestaurant.restaurant_id;
    } else {
      const restaurantId = crypto.randomUUID();
      const pointWkt = formatPointWKT(r.longitude, r.latitude);

      await prisma.$executeRaw`
        INSERT INTO restaurants (restaurant_id, owner_id, business_name, location_coord, wallet_balance, address_text)
        VALUES (${restaurantId}, ${ownerId}, ${r.businessName}, ST_GeomFromText(${pointWkt}, 4326), ${r.walletBalance}, ${r.addressText})
      `;

      restaurantMap[r.businessName] = restaurantId;
      console.log(`  [created] Restaurant '${r.businessName}' (${restaurantId})`);
    }
  }

  // --------------------------------------------------------------------------
  // 4. SEED PRODUCTS
  // Viva Note: Products table only stores generic item definitions (satisfying 3NF).
  // Price and MOQ live in SUPPLIER_CATALOGUE because different suppliers offer
  // the same product under different commercial conditions.
  // --------------------------------------------------------------------------
  console.log('\n--- 4. Seeding Products ---');
  const productsToSeed = [
    { productName: 'Tomatoes', unitOfMeasure: 'kg', category: 'Produce' },
    { productName: 'Onions', unitOfMeasure: 'kg', category: 'Produce' },
    { productName: 'Cooking Oil', unitOfMeasure: 'litre', category: 'Oils' }
  ];

  for (const p of productsToSeed) {
    const existingProduct = await prisma.products.findFirst({
      where: { product_name: p.productName }
    });

    if (existingProduct) {
      console.log(`  [skipped] Product '${p.productName}' already exists.`);
      productMap[p.productName] = existingProduct.product_id;
    } else {
      const productId = crypto.randomUUID();
      await prisma.products.create({
        data: {
          product_id: productId,
          product_name: p.productName,
          unit_of_measure: p.unitOfMeasure,
          category: p.category
        }
      });

      productMap[p.productName] = productId;
      console.log(`  [created] Product '${p.productName}' (${productId})`);
    }
  }

  // --------------------------------------------------------------------------
  // 5. SEED SUPPLIER CATALOGUE
  // Junction table resolving Many-to-Many between SUPPLIERS and PRODUCTS.
  // --------------------------------------------------------------------------
  console.log('\n--- 5. Seeding Supplier Catalogue ---');
  const catalogueToSeed = [
    {
      supplierName: 'Fresh Foods',
      productName: 'Tomatoes',
      pricePerUnit: 20.00,
      minOrderQty: 500.00
    },
    {
      supplierName: 'Green Basket',
      productName: 'Onions',
      pricePerUnit: 30.00,
      minOrderQty: 300.00
    },
    {
      supplierName: 'Green Basket',
      productName: 'Cooking Oil',
      pricePerUnit: 120.00,
      minOrderQty: 200.00
    }
  ];

  for (const c of catalogueToSeed) {
    const supplierId = supplierMap[c.supplierName];
    const productId = productMap[c.productName];
    const key = `${c.supplierName}:${c.productName}`;

    const existingOffer = await prisma.supplier_catalogue.findFirst({
      where: {
        supplier_id: supplierId,
        product_id: productId
      }
    });

    if (existingOffer) {
      console.log(`  [skipped] Catalogue offer '${c.productName}' from '${c.supplierName}' already exists.`);
      catalogueMap[key] = existingOffer.catalogue_id;
    } else {
      const catalogueId = crypto.randomUUID();
      await prisma.supplier_catalogue.create({
        data: {
          catalogue_id: catalogueId,
          supplier_id: supplierId,
          product_id: productId,
          price_per_unit: c.pricePerUnit,
          min_order_qty: c.minOrderQty
        }
      });

      catalogueMap[key] = catalogueId;
      console.log(`  [created] Catalogue offer '${c.productName}' by '${c.supplierName}' (${catalogueId})`);
    }
  }

  // --------------------------------------------------------------------------
  // 6. SEED BUYING POOL (BP01 for Fresh Foods Tomato Offer)
  // Viva Note: target_moq is copied from the catalogue offer at pool creation time.
  // This preserves historical integrity so later supplier price/MOQ changes do not
  // alter active or fulfilled pool requirements.
  // --------------------------------------------------------------------------
  console.log('\n--- 6. Seeding Buying Pool ---');
  const tomatoCatalogueId = catalogueMap['Fresh Foods:Tomatoes'];
  let tomatoPoolId = null;

  const existingPool = await prisma.buying_pools.findFirst({
    where: {
      catalogue_id: tomatoCatalogueId,
      status: 'ACTIVE'
    }
  });

  if (existingPool) {
    console.log(`  [skipped] Active buying pool for Fresh Foods Tomatoes already exists.`);
    tomatoPoolId = existingPool.pool_id;
  } else {
    tomatoPoolId = crypto.randomUUID();
    // Fresh Foods warehouse point: lat 12.9600, lng 77.6300
    const poolPointWkt = formatPointWKT(77.6300, 12.9600);
    // Expiration: exactly 14 days from now
    const expirationTime = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    await prisma.$executeRaw`
      INSERT INTO buying_pools (pool_id, catalogue_id, geographic_zone, status, current_qty, target_moq, expiration_time)
      VALUES (${tomatoPoolId}, ${tomatoCatalogueId}, ST_GeomFromText(${poolPointWkt}, 4326), 'ACTIVE', 0.00, 500.00, ${expirationTime})
    `;

    console.log(`  [created] Buying Pool BP01 for Fresh Foods Tomatoes (${tomatoPoolId})`);
  }

  // --------------------------------------------------------------------------
  // 7. SUMMARY TABLE OUTPUT
  // --------------------------------------------------------------------------
  console.log('\n================================ CoBuy Seed Summary ================================');
  
  console.log('\n[Users & Roles]');
  console.table(usersToSeed.map(u => ({
    Username: u.username,
    Email: u.email,
    Role: u.role,
    UserID: userMap[u.username]
  })));

  console.log('\n[Suppliers]');
  console.table(suppliersToSeed.map(s => ({
    Supplier: s.companyName,
    ContactEmail: s.contactEmail,
    SupplierID: supplierMap[s.companyName]
  })));

  console.log('\n[Restaurants (Cloud Kitchens)]');
  console.table(restaurantsToSeed.map(r => ({
    Restaurant: r.businessName,
    OwnerUser: r.userKey,
    RestaurantID: restaurantMap[r.businessName],
    WalletBalance: '₹5,000.00',
    Address: r.addressText
  })));

  console.log('\n[Buying Pool BP01 (Fresh Foods Tomatoes)]');
  console.table([{
    PoolID: tomatoPoolId,
    CatalogueID: tomatoCatalogueId,
    Product: 'Tomatoes',
    Supplier: 'Fresh Foods',
    TargetMOQ: '500.00 kg',
    CurrentQty: '0.00 kg',
    Status: 'ACTIVE',
    ExpiresIn: '14 days'
  }]);

  console.log('====================================================================================\n');
  console.log('✅ Seeding completed successfully. Ready for aggregation tests.\n');
}

// Execute seed function and ensure clean database disconnection
seed()
  .catch((err) => {
    console.error('❌ [CoBuy Seed Error]:', err);
    process.exit(1);
  })
  .finally(async () => {
    // Viva Note: Disconnecting Prisma releases the database connection pool cleanly
    await prisma.$disconnect();
  });
