const axios = require("axios");
const { connectDB } = require("./db");
require("dotenv").config();

const PAGE_LIMIT = 100;
const CONCURRENCY = 10;
const MAX_RETRIES = 5;
const RETRY_BASE_DELAY = 1000;

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
        console.error(`❌ Failed offset ${offset}:`, err.message || err);
        finished = true; // fail-safe
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

module.exports = { getAccessToken, fetchInventoryData };