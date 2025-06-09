const axios = require("axios");
const { connectDB } = require("./db");
require("dotenv").config();

const MAX_CONCURRENT_REQUESTS = 5; // Max parallel requests
const PAGE_LIMIT = 100;            // Items per page
const MAX_RETRIES = 5;             // Max retries on rate limiting
const RETRY_BASE_DELAY = 1000;     // 1 second base for exponential backoff

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

// Helper: delay ms milliseconds
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Fetch a single page with retries
async function fetchPage(token, accountID, page, updatedSince, retryCount = 0) {
  try {
    const params = {
      load_relations: JSON.stringify(["ItemShops"]),
      limit: PAGE_LIMIT,
      page
    };
    if (updatedSince) {
      params.updatedSince = updatedSince; // Lightspeed uses 'updatedSince' for incremental sync (check docs)
    }

    const res = await axios.get(
      `https://api.lightspeedapp.com/API/Account/${accountID}/Item.json`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params
      }
    );
    return res.data.Item || [];
  } catch (err) {
    const status = err.response?.status;

    // Retry on 429 (rate limit) or 503 (service unavailable)
    if ((status === 429 || status === 503) && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_BASE_DELAY * Math.pow(2, retryCount); // exponential backoff
      console.warn(`Rate limited or service unavailable. Retrying page ${page} in ${delayMs} ms.`);
      await delay(delayMs);
      return fetchPage(token, accountID, page, updatedSince, retryCount + 1);
    }

    // Re-throw other errors
    throw err;
  }
}

// Limited parallel fetch of all pages
async function fetchAllPages(token, accountID, updatedSince) {
  let allItems = [];
  let page = 1;
  let keepFetching = true;

  while (keepFetching) {
    // Prepare batch of page fetches limited by MAX_CONCURRENT_REQUESTS
    const pageBatch = [];
    for (let i = 0; i < MAX_CONCURRENT_REQUESTS; i++) {
      pageBatch.push(fetchPage(token, accountID, page + i, updatedSince));
    }

    // Wait for batch to finish
    const results = await Promise.all(pageBatch);

    // Flatten results and append
    const batchItems = results.flat();

    allItems = allItems.concat(batchItems);

    // If any page returned less than PAGE_LIMIT, it’s the last page
    if (batchItems.length < PAGE_LIMIT * MAX_CONCURRENT_REQUESTS) {
      keepFetching = false;
    } else {
      page += MAX_CONCURRENT_REQUESTS;
    }
  }

  return allItems;
}

async function fetchInventoryData() {
  const token = await getAccessToken();
  const accountID = process.env.ACCOUNT_ID;

  // Optional: fetch last sync time from DB for incremental sync
  const db = await connectDB();
  const lastSyncDoc = await db.collection("syncMetadata").findOne({ type: "inventory" });
  const updatedSince = lastSyncDoc?.lastSyncISO || null; // ISO timestamp or null for full sync

  console.log(`Starting inventory fetch. Incremental sync since: ${updatedSince}`);

  const allItems = await fetchAllPages(token, accountID, updatedSince);

  // Map to your inventory format
  const inventory = allItems.map(item => {
    const customSku = item.customSku;
    const name = item.description;
    const locations = (item.ItemShops?.ItemShop || []).map(loc => ({
      location: loc.Shop ? loc.Shop.name : "Unknown",
      stock: parseInt(loc.qoh || "0")
    }));
    return { customSku, name, locations };
  });

  // Update last sync timestamp in DB
  await db.collection("syncMetadata").updateOne(
    { type: "inventory" },
    { $set: { lastSyncISO: new Date().toISOString() } },
    { upsert: true }
  );

  console.log(`Fetched ${inventory.length} items.`);

  return inventory;
}

module.exports = { getAccessToken, fetchInventoryData };