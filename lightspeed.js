const axios = require("axios");
const { connectDB } = require("./db");
require("dotenv").config();

// CONFIG
const PAGE_LIMIT = 100;
const CONCURRENCY = 10;
const MAX_RETRIES = 5;
const RETRY_BASE_DELAY = 1000;

// BigCommerce API client
const BC_API = `https://api.bigcommerce.com/stores/${process.env.BC_STORE_HASH}/v3`;
const bcAxios = axios.create({
  baseURL: BC_API,
  headers: {
    "X-Auth-Token": process.env.BC_ACCESS_TOKEN,
    "Accept": "application/json",
    "Content-Type": "application/json"
  }
});

// Token handler
async function getAccessToken() {
  const db = await connectDB();
  const tokenDoc = await db.collection("tokens").findOne({ type: "lightspeed" });

  if (!tokenDoc || !tokenDoc.refresh_token) {
    throw new Error("No refresh token found in DB");
  }

  try {
    const { data } = await axios.post(
      "https://cloud.lightspeedapp.com/oauth/access_token.php",
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        refresh_token: tokenDoc.refresh_token,
        grant_type: "refresh_token"
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    await db.collection("tokens").updateOne(
      { type: "lightspeed" },
      {
        $set: {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          updatedAt: new Date()
        }
      }
    );

    console.log("✅ Got access token");
    return data.access_token;
  } catch (err) {
    console.error("❌ Failed to get access token:", err.response?.data || err.message);
    throw err;
  }
}

// Retry helper
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchPage(url, token, refreshTokenFunc, retryCount = 0) {
  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` }
    });
    return { data: res.data, token };
  } catch (err) {
    const status = err.response?.status;

    if (status === 401 && retryCount === 0) {
      console.log("⚠️ Access token expired, refreshing...");
      const newToken = await refreshTokenFunc();
      return fetchPage(url, newToken, refreshTokenFunc, retryCount + 1);
    }

    if ((status === 429 || status === 503) && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_BASE_DELAY * Math.pow(2, retryCount);
      console.warn(`⚠️ Rate limited. Retrying in ${delayMs}ms...`);
      await delay(delayMs);
      return fetchPage(url, token, refreshTokenFunc, retryCount + 1);
    }

    throw err;
  }
}

// ✅ Fetch inventory from Lightspeed
async function fetchInventoryData() {
  let accessToken = await getAccessToken();
  const accountID = process.env.ACCOUNT_ID;

  const baseUrl = `https://api.lightspeedapp.com/API/V3/Account/${accountID}/Item.json?limit=${PAGE_LIMIT}&load_relations=${encodeURIComponent(JSON.stringify(["ItemShops"]))}`;
  let offset = 0;
  let finished = false;
  const allResults = [];

  while (!finished) {
    const batch = [];
    for (let i = 0; i < CONCURRENCY; i++) {
      const url = `${baseUrl}&offset=${offset}`;
      batch.push(fetchPage(url, accessToken, getAccessToken).then(({ data, token }) => {
        accessToken = token;
        const items = data.Item || [];
        if (items.length < PAGE_LIMIT) finished = true;
        allResults.push(...items);
        console.log(`📦 Offset ${offset} — Fetched ${items.length} items`);
      }).catch(err => {
        console.error(`❌ Error at offset ${offset}:`, err.message || err);
        finished = true;
      }));
      offset += PAGE_LIMIT;
    }

    await Promise.all(batch);
  }

  const filtered = allResults.filter(item => /2024|2025/.test(item.description || ""));
  const inventory = filtered.map(item => ({
    customSku: item.customSku,
    name: item.description,
    locations: (item.ItemShops?.ItemShop || []).map(loc => ({
      location: loc.Shop?.name || "Unknown",
      stock: parseInt(loc.qoh || "0")
    }))
  }));

  console.log(`✅ DONE — Total fetched: ${allResults.length}, After filter: ${inventory.length}`);
  return inventory;
}

// ✅ Sync to BigCommerce
async function syncToBigCommerce(lightspeedInventory) {
  const allVariants = [];
  let page = 1;
  const limit = 250;

  while (true) {
    const { data } = await bcAxios.get(`/catalog/variants`, {
      params: { page, limit }
    });

    const variants = data.data;
    if (!variants.length) break;

    allVariants.push(...variants);
    page++;
  }

  console.log(`📦 Pulled ${allVariants.length} BigCommerce variants`);

  const variantMap = new Map();
  for (const variant of allVariants) {
    if (variant.sku) {
      variantMap.set(variant.sku.trim(), variant);
    }
  }

  let updated = 0;
  for (const item of lightspeedInventory) {
    const sku = item.customSku?.trim();
    const totalStock = item.locations.reduce((sum, loc) => sum + (loc.stock || 0), 0);

    if (!sku || !variantMap.has(sku)) continue;

    const variant = variantMap.get(sku);
    if (variant.inventory_level !== totalStock) {
      try {
        await bcAxios.put(`/catalog/products/${variant.product_id}/variants/${variant.id}`, {
          inventory_level: totalStock
        });
        console.log(`✅ ${sku} → ${variant.inventory_level} → ${totalStock}`);
        updated++;
      } catch (err) {
        console.error(`❌ Failed to update ${sku}:`, err.response?.data || err.message);
      }
    }
  }

  console.log(`🎯 Sync complete — ${updated} variants updated`);
}

// 🔁 Combined main runner
(async () => {
  const lightspeedData = await fetchInventoryData();
  await syncToBigCommerce(lightspeedData);
})();