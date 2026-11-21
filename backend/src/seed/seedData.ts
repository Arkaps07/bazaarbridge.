import bcrypt from 'bcryptjs';

// Deterministic UUIDs so seed is repeatable and demo/tests can reference exact records cleanly
export const SEED_IDS = {
  users: {
    customer: '10000000-0000-4000-8000-000000000001',
    admin: '10000000-0000-4000-8000-000000000002',
    customer2: '10000000-0000-4000-8000-000000000003',
  },
  categories: {
    audio: '20000000-0000-4000-8000-000000000001',
    computing: '20000000-0000-4000-8000-000000000002',
    wearables: '20000000-0000-4000-8000-000000000003',
    homeTech: '20000000-0000-4000-8000-000000000004',
    mobilePower: '20000000-0000-4000-8000-000000000005',
  },
  locations: {
    bangaloreWarehouse: '30000000-0000-4000-8000-000000000001',
    koramangalaHub: '30000000-0000-4000-8000-000000000002',
    quarantine: '30000000-0000-4000-8000-000000000003',
    mysuruHolding: '30000000-0000-4000-8000-000000000004',
  },
  hub: {
    koramangala: '35000000-0000-4000-8000-000000000001',
  },
  dealers: {
    indiranagar: '40000000-0000-4000-8000-000000000001',
    spRoad: '40000000-0000-4000-8000-000000000002',
    jayanagar: '40000000-0000-4000-8000-000000000003',
    koramangala: '40000000-0000-4000-8000-000000000004',
    whitefield: '40000000-0000-4000-8000-000000000005',
    mysuruHeritage: '40000000-0000-4000-8000-000000000006',
  },
  products: {
    fiveDealerSpeaker: '50000000-0000-4000-8000-000000000001',
    mixedCartHeadphones: '50000000-0000-4000-8000-000000000002',
    oneUnitDac: '50000000-0000-4000-8000-000000000003',
    mysuruEarphones: '50000000-0000-4000-8000-000000000004',
    mysuruKettle: '50000000-0000-4000-8000-000000000005',
  },
  offers: {
    speakerBudget: '60000000-0000-4000-8000-000000000001', // Rs.699 / 4d / 3.9 / 12 units
    speakerFastest: '60000000-0000-4000-8000-000000000002', // Rs.779 / 1d / 4.3 / 10 units
    speakerRated: '60000000-0000-4000-8000-000000000003', // Rs.749 / 2d / 4.8 / 8 units
    speakerValue: '60000000-0000-4000-8000-000000000004', // Rs.725 / 2d / 4.4 / 15 units
    speakerAvailable: '60000000-0000-4000-8000-000000000005', // Rs.769 / 3d / 4.1 / 40 units
    mixedCartQuick: '60000000-0000-4000-8000-000000000006', // Hub + Warehouse, quick eligible
    oneUnitOffer: '60000000-0000-4000-8000-000000000007', // 1 unit concurrency test
    mysuruOnlySectionB: '60000000-0000-4000-8000-000000000008', // Mysuru holding ONLY, NO Bangalore row
    mysuruSectionA: '60000000-0000-4000-8000-000000000009', // Mysuru dealer stocked in Bangalore
  },
};

export interface SeedCatalogProduct {
  product_id: string;
  name: string;
  brand: string;
  category_id: string;
  description: string;
  specs: Record<string, string | number | boolean>;
  basePricePaise: number;
}

function makeProductUuid(index: number): string {
  return `50000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function makeOfferUuid(index: number): string {
  return `60000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

export function buildSeedDataset(adminPasswordRaw?: string) {
  const customerHash = bcrypt.hashSync('Demo@1234', 10);
  const adminPassword = adminPasswordRaw || process.env.SEED_ADMIN_PASSWORD || 'Admin@1234';
  const adminHash = bcrypt.hashSync(adminPassword, 10);

  const users = [
    {
      user_id: SEED_IDS.users.customer,
      name: 'Aarav Nair (Demo Customer)',
      email: 'demo@bazaarbridge.dev',
      password_hash: customerHash,
      role: 'customer' as const,
    },
    {
      user_id: SEED_IDS.users.admin,
      name: 'Priya Menon (Operations Admin)',
      email: 'admin@bazaarbridge.dev',
      password_hash: adminHash,
      role: 'admin' as const,
    },
    {
      user_id: SEED_IDS.users.customer2,
      name: 'Rohan Kulkarni (Demo Shopper 2)',
      email: 'shopper2@bazaarbridge.dev',
      password_hash: customerHash,
      role: 'customer' as const,
    },
  ];

  const categories = [
    { category_id: SEED_IDS.categories.audio, category_name: 'Audio & Speakers' },
    { category_id: SEED_IDS.categories.computing, category_name: 'Computing & Peripherals' },
    { category_id: SEED_IDS.categories.wearables, category_name: 'Wearables & Smartwatches' },
    { category_id: SEED_IDS.categories.homeTech, category_name: 'Home & Kitchen Tech' },
    { category_id: SEED_IDS.categories.mobilePower, category_name: 'Mobile & Power Gear' },
  ];

  const stock_locations = [
    {
      location_id: SEED_IDS.locations.bangaloreWarehouse,
      name: 'Bengaluru Central Warehouse (Peenya)',
      city: 'Bengaluru',
      state: 'Karnataka',
      location_type: 'warehouse' as const,
      is_home: true,
      is_sellable: true,
    },
    {
      location_id: SEED_IDS.locations.koramangalaHub,
      name: 'Koramangala Quick Fulfilment Hub (SAMPLE)',
      city: 'Bengaluru',
      state: 'Karnataka',
      location_type: 'hub' as const,
      is_home: false,
      is_sellable: true,
    },
    {
      location_id: SEED_IDS.locations.quarantine,
      name: 'Bengaluru QC Quarantine Bay',
      city: 'Bengaluru',
      state: 'Karnataka',
      location_type: 'quarantine' as const,
      is_home: false,
      is_sellable: false,
    },
    {
      location_id: SEED_IDS.locations.mysuruHolding,
      name: 'Mysuru Regional Holding Depot (SAMPLE)',
      city: 'Mysuru',
      state: 'Karnataka',
      location_type: 'holding' as const,
      is_home: false,
      is_sellable: true,
    },
  ];

  const fulfilment_hubs = [
    {
      hub_id: SEED_IDS.hub.koramangala,
      location_id: SEED_IDS.locations.koramangalaHub,
      address: '80 Feet Road, 4th Block Koramangala, Bengaluru 560034 (SAMPLE)',
      hours: { open: '00:00', close: '23:59', always_open: true },
      active: true,
      order_capacity: 20,
      delivery_radius_km: 6,
    },
  ];

  const hub_service_areas = [
    { area_id: '36000000-0000-4000-8000-000000000001', hub_id: SEED_IDS.hub.koramangala, pin_code: '560034' },
    { area_id: '36000000-0000-4000-8000-000000000002', hub_id: SEED_IDS.hub.koramangala, pin_code: '560095' },
    { area_id: '36000000-0000-4000-8000-000000000003', hub_id: SEED_IDS.hub.koramangala, pin_code: '560038' },
  ];

  // 5 Bangalore dealers with distinct ratings/review counts + 1 Mysuru dealer
  const dealers = [
    {
      dealer_id: SEED_IDS.dealers.spRoad,
      shop_name: 'SP Road Value Electronics (SAMPLE)',
      city: 'Bengaluru',
      state: 'Karnataka',
      contact: 'sproad@sample.bazaarbridge.dev',
      dealer_rating: 3.9,
      total_reviews: 12,
      verified: false,
      supplier_status: 'active',
    },
    {
      dealer_id: SEED_IDS.dealers.indiranagar,
      shop_name: 'Indiranagar Express Audio (SAMPLE)',
      city: 'Bengaluru',
      state: 'Karnataka',
      contact: 'indiranagar@sample.bazaarbridge.dev',
      dealer_rating: 4.3,
      total_reviews: 6,
      verified: false,
      supplier_status: 'active',
    },
    {
      dealer_id: SEED_IDS.dealers.jayanagar,
      shop_name: 'Jayanagar Acoustic House (SAMPLE)',
      city: 'Bengaluru',
      state: 'Karnataka',
      contact: 'jayanagar@sample.bazaarbridge.dev',
      dealer_rating: 4.8,
      total_reviews: 3,
      verified: false,
      supplier_status: 'active',
    },
    {
      dealer_id: SEED_IDS.dealers.koramangala,
      shop_name: 'Koramangala Tech Emporium (SAMPLE)',
      city: 'Bengaluru',
      state: 'Karnataka',
      contact: 'koramangala@sample.bazaarbridge.dev',
      dealer_rating: 4.4,
      total_reviews: 9,
      verified: false,
      supplier_status: 'active',
    },
    {
      dealer_id: SEED_IDS.dealers.whitefield,
      shop_name: 'Whitefield Direct Distributors (SAMPLE)',
      city: 'Bengaluru',
      state: 'Karnataka',
      contact: 'whitefield@sample.bazaarbridge.dev',
      dealer_rating: 4.1,
      total_reviews: 18,
      verified: false,
      supplier_status: 'active',
    },
    {
      dealer_id: SEED_IDS.dealers.mysuruHeritage,
      shop_name: 'Mysuru Heritage Sound & Tech (SAMPLE)',
      city: 'Mysuru',
      state: 'Karnataka',
      contact: 'mysuru@sample.bazaarbridge.dev',
      dealer_rating: 4.6,
      total_reviews: 27,
      verified: false,
      supplier_status: 'active',
    },
  ];

  // 40 products across 5 categories
  const coreProducts: SeedCatalogProduct[] = [
    {
      product_id: SEED_IDS.products.fiveDealerSpeaker,
      name: 'AeroPulse Portable Bluetooth Speaker',
      brand: 'AeroPulse',
      category_id: SEED_IDS.categories.audio,
      description: 'Compact 20W IPX7 waterproof cylindrical Bluetooth 5.3 speaker with dual passive radiators and 14-hour playback. Flagship 5-dealer comparison product (SAMPLE).',
      specs: { connectivity: 'Bluetooth 5.3', output: '20W RMS', battery: '14 hours', water_resistance: 'IPX7', weight_g: 420 },
      basePricePaise: 74900,
    },
    {
      product_id: SEED_IDS.products.mixedCartHeadphones,
      name: 'AcousticOne ANC Bluetooth Headphones',
      brand: 'AcousticOne',
      category_id: SEED_IDS.categories.audio,
      description: 'Over-ear hybrid active noise cancelling wireless headphones with 40mm dynamic drivers and multipoint USB-C fast charging (SAMPLE).',
      specs: { connectivity: 'Bluetooth 5.3 + 3.5mm', anc: 'Hybrid 38dB', battery: '36 hours', driver: '40mm', weight_g: 265 },
      basePricePaise: 249900,
    },
    {
      product_id: SEED_IDS.products.oneUnitDac,
      name: 'StudioCore USB-C Hi-Res DAC Amplifier (1-Unit Rare Stock)',
      brand: 'StudioCore',
      category_id: SEED_IDS.categories.audio,
      description: 'Precision 32-bit/384kHz portable USB-C DAC and balanced headphone amplifier. Seeded with exactly 1 sellable unit for atomic concurrency testing (SAMPLE).',
      specs: { dac_chip: 'ES9281AC', sample_rate: '32-bit / 384kHz', interface: 'USB-C', output: '3.5mm + 4.4mm' },
      basePricePaise: 329900,
    },
    {
      product_id: SEED_IDS.products.mysuruEarphones,
      name: 'Kaveri Pro Wireless Bluetooth Earphones',
      brand: 'KaveriAudio',
      category_id: SEED_IDS.categories.audio,
      description: 'Ergonomic neckband Bluetooth earphones tuned for vocal clarity and low-latency calls. Available from Mysuru dealer stock (SAMPLE).',
      specs: { connectivity: 'Bluetooth 5.2', battery: '22 hours', water_resistance: 'IPX5', charging: 'USB-C' },
      basePricePaise: 119900,
    },
    {
      product_id: SEED_IDS.products.mysuruKettle,
      name: 'ArtisanBrew Precision Gooseneck Smart Kettle',
      brand: 'ArtisanBrew',
      category_id: SEED_IDS.categories.homeTech,
      description: 'Variable temperature electric gooseneck kettle with 1-degree PID control and brushed stainless interior (SAMPLE).',
      specs: { capacity: '0.9L', power: '1200W', temp_control: '40C–100C PID', material: '304 Stainless Steel' },
      basePricePaise: 349900,
    },
  ];

  const additionalSpecs: Array<[string, string, string, number, Record<string, string | number | boolean>]> = [
    // Audio & Speakers (remaining 3 -> 8 total)
    ['Sonora Mini Bluetooth Soundbar', 'Sonora', SEED_IDS.categories.audio, 189900, { connectivity: 'Bluetooth 5.1 + Aux', output: '30W', battery: '8 hours' }],
    ['PulseBuds True Wireless Earbuds', 'AeroPulse', SEED_IDS.categories.audio, 149900, { connectivity: 'Bluetooth 5.3', anc: '30dB', battery: '28 hours' }],
    ['ClearMic USB Condenser Studio Microphone', 'StudioCore', SEED_IDS.categories.audio, 279900, { pattern: 'Cardioid', interface: 'USB-C', sample_rate: '24-bit/96kHz' }],
    // Computing & Peripherals (8)
    ['TactilePro 75% Aluminum Mechanical Keyboard', 'KeyCraft', SEED_IDS.categories.computing, 499900, { connectivity: 'Tri-Mode Bluetooth/2.4G/USB-C', switches: 'Hot-swap Tactile', layout: '75%' }],
    ['PrecisionGlide Ergonomic Wireless Mouse', 'KeyCraft', SEED_IDS.categories.computing, 229900, { connectivity: 'Bluetooth + 2.4GHz', dpi: '8000 DPI', battery: '70 days' }],
    ['LinkDock 8-in-1 USB-C Aluminum Hub', 'PortLogic', SEED_IDS.categories.computing, 199900, { hdmi: '4K 60Hz', pd_charging: '100W', ports: '8-in-1' }],
    ['ClarityCam 2K QHD Auto-Focus Webcam', 'OptiFrame', SEED_IDS.categories.computing, 289900, { resolution: '2560x1440 30fps', mic: 'Dual Stereo', privacy_shutter: true }],
    ['AeroStand Machined Aluminum Laptop Riser', 'DeskForm', SEED_IDS.categories.computing, 139900, { material: 'Anodized Aluminum', compatibility: '11–17 inch', foldable: true }],
    ['SwiftNVMe 1TB Portable USB-C SSD', 'DataVault', SEED_IDS.categories.computing, 649900, { capacity: '1TB', speed: '1050 MB/s', interface: 'USB 3.2 Gen 2' }],
    ['SilentClick Slim Bluetooth Trackpad', 'KeyCraft', SEED_IDS.categories.computing, 269900, { connectivity: 'Bluetooth 5.1', gestures: 'Multi-touch', battery: '30 days' }],
    ['DeskMat Wool Felt Extended Mousepad', 'DeskForm', SEED_IDS.categories.computing, 89900, { size: '900x400mm', material: 'Merino Felt', base: 'Anti-slip' }],
    // Wearables & Smartwatches (8)
    ['ChronoFit Titanium AMOLED Smartwatch', 'ChronoFit', SEED_IDS.categories.wearables, 449900, { display: '1.43" AMOLED', gps: 'Dual-Band', battery: '14 days', water_resistance: '5 ATM' }],
    ['StrideBand Pro Fitness & Sleep Tracker', 'ChronoFit', SEED_IDS.categories.wearables, 179900, { display: '1.1" AMOLED', sensors: 'SpO2 + HR', battery: '12 days' }],
    ['VeloSport GPS Running Watch', 'PulseGear', SEED_IDS.categories.wearables, 599900, { gps: 'Multi-GNSS', weight_g: 39, battery: '18 days' }],
    ['AuraRing Smart Wellness Band', 'PulseGear', SEED_IDS.categories.wearables, 389900, { material: 'Titanium', battery: '7 days', sensors: 'HRV + Sleep' }],
    ['MagLoop Woven Nylon Smartwatch Strap 22mm', 'ChronoFit', SEED_IDS.categories.wearables, 59900, { width: '22mm', material: 'Woven Nylon', clasp: 'Hook & Loop' }],
    ['ActiveScale Smart Body Composition Scale', 'PulseGear', SEED_IDS.categories.wearables, 159900, { connectivity: 'Bluetooth 5.0', metrics: '13 metrics', max_load: '180kg' }],
    ['TrailBeat Bluetooth Heart Rate Chest Strap', 'PulseGear', SEED_IDS.categories.wearables, 219900, { connectivity: 'ANT+ / Bluetooth', battery: '400 hours', water_resistance: 'IP67' }],
    ['SmartTemp Digital Contactless Forehead Monitor', 'ChronoFit', SEED_IDS.categories.wearables, 119900, { reading_time: '1 second', memory: '32 readings', display: 'Backlit LED' }],
    // Home & Kitchen Tech (7 remaining -> 8 total)
    ['LumaArc Sculptural Smart Desk Lamp', 'LumaHome', SEED_IDS.categories.homeTech, 219900, { cri: '95+ CRI', dimming: 'Stepless 2700K–6500K', control: 'Touch + App' }],
    ['PureBreeze Compact HEPA-13 Air Purifier', 'LumaHome', SEED_IDS.categories.homeTech, 549900, { filter: 'True HEPA-13', cadr: '220 m3/h', noise: '24 dB sleep mode' }],
    ['BaristaMini Digital Espresso Coffee Scale', 'ArtisanBrew', SEED_IDS.categories.homeTech, 169900, { precision: '0.1g', timer: 'Auto-tare', charging: 'USB-C' }],
    ['SenseAir Indoor CO2 & Humidity Monitor', 'LumaHome', SEED_IDS.categories.homeTech, 199900, { sensors: 'NDIR CO2 + Temp + RH', display: 'E-Ink', battery: '60 days' }],
    ['SmartPlug 16A Energy Monitoring Socket', 'LumaHome', SEED_IDS.categories.homeTech, 79900, { rating: '16A Heavy Duty', connectivity: 'Wi-Fi 2.4GHz', metering: 'Real-time Watts' }],
    ['BlendGo Portable USB-C Personal Blender', 'ArtisanBrew', SEED_IDS.categories.homeTech, 149900, { capacity: '380ml', blades: '6-leaf Stainless', battery: '15 blends' }],
    ['QuietHumid Ultrasonic Cool Mist Humidifier', 'LumaHome', SEED_IDS.categories.homeTech, 239900, { tank: '2.5L', runtime: '20 hours', noise: '26 dB' }],
    // Mobile & Power Gear (8)
    ['VoltCraft 65W GaN Triple-Port Fast Charger', 'VoltCraft', SEED_IDS.categories.mobilePower, 189900, { power: '65W PD 3.0 + PPS', ports: '2x USB-C + 1x USB-A', tech: 'GaN III' }],
    ['AnodizePower 20000mAh 65W Laptop Power Bank', 'VoltCraft', SEED_IDS.categories.mobilePower, 319900, { capacity: '20000mAh', output: '65W PD', shell: 'Anodized Aluminum' }],
    ['BraidLink 100W E-Marker USB-C Cable (2m)', 'PortLogic', SEED_IDS.categories.mobilePower, 49900, { power: '100W 5A', length: '2 meters', jacket: 'Double-Braided Nylon' }],
    ['MagDock 15W Qi2 Foldable Travel Charger', 'VoltCraft', SEED_IDS.categories.mobilePower, 249900, { standard: 'Qi2 15W', foldable: true, input: 'USB-C' }],
    ['GripMount Magnetic Car Vent Phone Holder', 'DeskForm', SEED_IDS.categories.mobilePower, 89900, { magnets: 'N52 Neodymium', rotation: '360-degree', mount: 'Steel Hook' }],
    ['PocketJuice 10000mAh Slim Magnetic Power Bank', 'VoltCraft', SEED_IDS.categories.mobilePower, 209900, { capacity: '10000mAh', wireless: '15W MagSafe compatible', wired: '20W PD' }],
    ['SurgeGuard 6-Outlet Extension Strip with USB-C', 'PortLogic', SEED_IDS.categories.mobilePower, 129900, { outlets: '6 Universal', usb: '30W USB-C PD', cord: '2m Heavy Gauge' }],
    ['TravelPlug Universal 45W GaN World Adapter', 'VoltCraft', SEED_IDS.categories.mobilePower, 229900, { regions: '150+ countries', output: '45W PD', fuse: 'Dual 8A Auto-reset' }],
  ];

  const products: SeedCatalogProduct[] = [
    ...coreProducts,
    ...additionalSpecs.map(([name, brand, category_id, basePricePaise, specs], idx) => ({
      product_id: makeProductUuid(idx + 6),
      name,
      brand,
      category_id,
      description: `${brand} ${name} available from verified local Bengaluru and Karnataka partner dealers with multi-offer comparison (SAMPLE).`,
      specs,
      basePricePaise,
    })),
  ];

  // Offers & Inventory
  const dealer_offers: Array<{
    offer_id: string;
    product_id: string;
    dealer_id: string;
    purchase_price: number;
    selling_price: number;
    status: string;
    bangalore_delivery_days: number | null;
    transfer_days_min: number | null;
    transfer_days_max: number | null;
    eligible_modes: string[];
    warranty_months: number;
    warranty_note: string;
  }> = [];

  const inventory: Array<{
    offer_id: string;
    location_id: string;
    quantity: number;
    reserved_quantity: number;
  }> = [];

  // 1) Flagship 5-dealer Bluetooth Speaker (EXACT v7.2 comparison winners!)
  // Budget Rs.699/4d/3.9/12u, Fastest Rs.779/1d/4.3/10u, Rated Rs.749/2d/4.8/8u, Value Rs.725/2d/4.4/15u, Available Rs.769/3d/4.1/40u
  const speakerOffers = [
    {
      offer_id: SEED_IDS.offers.speakerBudget,
      dealer_id: SEED_IDS.dealers.spRoad,
      selling_price: 69900,
      bangalore_delivery_days: 4,
      qty: 12,
      warranty_months: 6,
    },
    {
      offer_id: SEED_IDS.offers.speakerFastest,
      dealer_id: SEED_IDS.dealers.indiranagar,
      selling_price: 77900,
      bangalore_delivery_days: 1,
      qty: 10,
      warranty_months: 12,
    },
    {
      offer_id: SEED_IDS.offers.speakerRated,
      dealer_id: SEED_IDS.dealers.jayanagar,
      selling_price: 74900,
      bangalore_delivery_days: 2,
      qty: 8,
      warranty_months: 12,
    },
    {
      offer_id: SEED_IDS.offers.speakerValue,
      dealer_id: SEED_IDS.dealers.koramangala,
      selling_price: 72500,
      bangalore_delivery_days: 2,
      qty: 15,
      warranty_months: 12,
    },
    {
      offer_id: SEED_IDS.offers.speakerAvailable,
      dealer_id: SEED_IDS.dealers.whitefield,
      selling_price: 76900,
      bangalore_delivery_days: 3,
      qty: 40,
      warranty_months: 12,
    },
  ];

  for (const so of speakerOffers) {
    dealer_offers.push({
      offer_id: so.offer_id,
      product_id: SEED_IDS.products.fiveDealerSpeaker,
      dealer_id: so.dealer_id,
      purchase_price: Math.round(so.selling_price * 0.78),
      selling_price: so.selling_price,
      status: 'active',
      bangalore_delivery_days: so.bangalore_delivery_days,
      transfer_days_min: null,
      transfer_days_max: null,
      eligible_modes: ['standard'],
      warranty_months: so.warranty_months,
      warranty_note: `${so.warranty_months}-month dealer carry-in warranty (SAMPLE)`,
    });
    inventory.push({
      offer_id: so.offer_id,
      location_id: SEED_IDS.locations.bangaloreWarehouse,
      quantity: so.qty,
      reserved_quantity: 0,
    });
  }
  // Add Quarantine stock on Budget offer to verify quarantine units NEVER count anywhere
  inventory.push({
    offer_id: SEED_IDS.offers.speakerBudget,
    location_id: SEED_IDS.locations.quarantine,
    quantity: 50,
    reserved_quantity: 0,
  });

  // 2) Mixed-cart demo product: AcousticOne ANC Bluetooth Headphones (free units at BOTH Hub AND Warehouse, eligible_modes includes 'quick')
  dealer_offers.push({
    offer_id: SEED_IDS.offers.mixedCartQuick,
    product_id: SEED_IDS.products.mixedCartHeadphones,
    dealer_id: SEED_IDS.dealers.koramangala,
    purchase_price: 195000,
    selling_price: 249900,
    status: 'active',
    bangalore_delivery_days: 1,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['quick', 'standard'],
    warranty_months: 12,
    warranty_note: '12-month brand warranty (SAMPLE)',
  });
  inventory.push(
    {
      offer_id: SEED_IDS.offers.mixedCartQuick,
      location_id: SEED_IDS.locations.koramangalaHub,
      quantity: 14,
      reserved_quantity: 0,
    },
    {
      offer_id: SEED_IDS.offers.mixedCartQuick,
      location_id: SEED_IDS.locations.bangaloreWarehouse,
      quantity: 18,
      reserved_quantity: 0,
    }
  );

  // 3) 1-unit product for concurrency test
  dealer_offers.push({
    offer_id: SEED_IDS.offers.oneUnitOffer,
    product_id: SEED_IDS.products.oneUnitDac,
    dealer_id: SEED_IDS.dealers.jayanagar,
    purchase_price: 260000,
    selling_price: 329900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: null,
    transfer_days_max: null,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '12-month studio dealer warranty (SAMPLE)',
  });
  inventory.push({
    offer_id: SEED_IDS.offers.oneUnitOffer,
    location_id: SEED_IDS.locations.bangaloreWarehouse,
    quantity: 1,
    reserved_quantity: 0,
  });

  // 4) Mysuru dealer Section B offer: exists ONLY at Mysuru holding with NO Bangalore row!
  // Also sells "Bluetooth Earphones" so city=Mysuru + q=bluetoth is non-empty!
  dealer_offers.push({
    offer_id: SEED_IDS.offers.mysuruOnlySectionB,
    product_id: SEED_IDS.products.mysuruEarphones,
    dealer_id: SEED_IDS.dealers.mysuruHeritage,
    purchase_price: 89000,
    selling_price: 119900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: 2,
    transfer_days_max: 3,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '12-month Mysuru dealer warranty (SAMPLE)',
  });
  inventory.push({
    offer_id: SEED_IDS.offers.mysuruOnlySectionB,
    location_id: SEED_IDS.locations.mysuruHolding,
    quantity: 16,
    reserved_quantity: 0,
  });

  // 5) Mysuru dealer Section A offer (stocked IN Bangalore warehouse for faster delivery)
  dealer_offers.push({
    offer_id: SEED_IDS.offers.mysuruSectionA,
    product_id: SEED_IDS.products.mysuruKettle,
    dealer_id: SEED_IDS.dealers.mysuruHeritage,
    purchase_price: 270000,
    selling_price: 349900,
    status: 'active',
    bangalore_delivery_days: 2,
    transfer_days_min: 2,
    transfer_days_max: 3,
    eligible_modes: ['standard'],
    warranty_months: 12,
    warranty_note: '12-month Mysuru dealer warranty (SAMPLE)',
  });
  inventory.push({
    offer_id: SEED_IDS.offers.mysuruSectionA,
    location_id: SEED_IDS.locations.bangaloreWarehouse,
    quantity: 11,
    reserved_quantity: 0,
  });

  // Generate 2–3 offers per remaining product (products 6..40)
  const bangaloreDealerIds = [
    SEED_IDS.dealers.koramangala,
    SEED_IDS.dealers.jayanagar,
    SEED_IDS.dealers.indiranagar,
    SEED_IDS.dealers.whitefield,
    SEED_IDS.dealers.spRoad,
  ];

  let offerCounter = 10;
  for (let i = 5; i < products.length; i++) {
    const prod = products[i];
    const offerCount = i % 3 === 0 ? 3 : 2;
    for (let j = 0; j < offerCount; j++) {
      const offerId = makeOfferUuid(offerCounter++);
      const isMysuruTransfer = i % 7 === 0 && j === offerCount - 1;
      const dealerId = isMysuruTransfer
        ? SEED_IDS.dealers.mysuruHeritage
        : bangaloreDealerIds[(i + j) % bangaloreDealerIds.length];

      const priceDelta = j === 0 ? 0 : j === 1 ? -4000 : 5000;
      const sellingPrice = Math.max(29900, prod.basePricePaise + priceDelta);
      const quickEligible = !isMysuruTransfer && j === 0 && i % 2 === 0;

      dealer_offers.push({
        offer_id: offerId,
        product_id: prod.product_id,
        dealer_id: dealerId,
        purchase_price: Math.round(sellingPrice * 0.78),
        selling_price: sellingPrice,
        status: 'active',
        bangalore_delivery_days: quickEligible ? 1 : 2 + (j % 3),
        transfer_days_min: isMysuruTransfer ? 2 : null,
        transfer_days_max: isMysuruTransfer ? 3 : null,
        eligible_modes: quickEligible ? ['quick', 'standard'] : ['standard'],
        warranty_months: 12,
        warranty_note: '12-month standard dealer warranty (SAMPLE)',
      });

      if (isMysuruTransfer) {
        inventory.push({
          offer_id: offerId,
          location_id: SEED_IDS.locations.mysuruHolding,
          quantity: 12,
          reserved_quantity: 0,
        });
      } else {
        inventory.push({
          offer_id: offerId,
          location_id: SEED_IDS.locations.bangaloreWarehouse,
          quantity: 10 + ((i * 3 + j * 7) % 25),
          reserved_quantity: 0,
        });
        if (quickEligible) {
          inventory.push({
            offer_id: offerId,
            location_id: SEED_IDS.locations.koramangalaHub,
            quantity: 8 + (i % 10),
            reserved_quantity: 0,
          });
        }
      }
    }
  }

  // SAMPLE closed 30-day price history rows (higher historical price, valid_from now-20d, valid_to now-1d)
  const now = Date.now();
  const DAY = 24 * 60 * 60 * 1000;
  const historical_prices = dealer_offers.slice(0, 15).map((offer) => ({
    offer_id: offer.offer_id,
    selling_price: offer.selling_price + 10000, // Rs. 100 higher historical SAMPLE reference
    valid_from: new Date(now - 20 * DAY).toISOString(),
    valid_to: new Date(now - 1 * DAY).toISOString(),
  }));

  // Flagged optional coupons (v7.2: max_redemptions=1, per_customer_limit=1, and one normal)
  const coupons = [
    {
      coupon_id: '70000000-0000-4000-8000-000000000001',
      code: 'BRIDGE100',
      kind: 'fixed_paise' as const,
      value: 10000, // Rs. 100 off
      min_basket_paise: 50000,
      max_redemptions: 100,
      redeemed_count: 0,
      per_customer_limit: 5,
      valid_from: new Date(now - 7 * DAY).toISOString(),
      valid_to: new Date(now + 60 * DAY).toISOString(),
      active: true,
    },
    {
      coupon_id: '70000000-0000-4000-8000-000000000002',
      code: 'FIRSTONE',
      kind: 'fixed_paise' as const,
      value: 15000, // Rs. 150 off, max_redemptions = 1 for coupon-race test
      min_basket_paise: 50000,
      max_redemptions: 1,
      redeemed_count: 0,
      per_customer_limit: 1,
      valid_from: new Date(now - 7 * DAY).toISOString(),
      valid_to: new Date(now + 60 * DAY).toISOString(),
      active: true,
    },
    {
      coupon_id: '70000000-0000-4000-8000-000000000003',
      code: 'ONCEONLY10',
      kind: 'percent' as const,
      value: 10, // 10% off, per_customer_limit = 1
      min_basket_paise: 60000,
      max_redemptions: 50,
      redeemed_count: 0,
      per_customer_limit: 1,
      valid_from: new Date(now - 7 * DAY).toISOString(),
      valid_to: new Date(now + 60 * DAY).toISOString(),
      active: true,
    },
  ];

  const customer_addresses = [
    {
      address_id: '80000000-0000-4000-8000-000000000001',
      user_id: SEED_IDS.users.customer,
      label: 'Home',
      recipient_name: 'Aarav Nair',
      phone: '+91-98000-00001 (SAMPLE)',
      line1: '42, 4th Cross, 4th Block Koramangala',
      line2: 'Near Sony World Signal',
      landmark: 'Opposite BDA Complex',
      city: 'Bengaluru',
      state: 'Karnataka',
      pin_code: '560034',
      instructions: 'Call on arrival (SAMPLE)',
      is_default: true,
    },
    {
      address_id: '80000000-0000-4000-8000-000000000002',
      user_id: SEED_IDS.users.customer,
      label: 'Work',
      recipient_name: 'Aarav Nair',
      phone: '+91-98000-00001 (SAMPLE)',
      line1: 'Tower B, Outer Ring Road, Bellandur',
      line2: 'Floor 4',
      landmark: 'EcoSpace Tech Park',
      city: 'Bengaluru',
      state: 'Karnataka',
      pin_code: '560103',
      instructions: 'Leave at reception desk (SAMPLE)',
      is_default: false,
    },
  ];

  return {
    users,
    categories,
    stock_locations,
    fulfilment_hubs,
    hub_service_areas,
    dealers,
    products,
    dealer_offers,
    inventory,
    historical_prices,
    coupons,
    customer_addresses,
  };
}
