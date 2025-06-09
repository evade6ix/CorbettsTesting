const axios = require("axios");
const { connectDB } = require("./db");
require("dotenv").config();

const PAGE_LIMIT = 100;
const MAX_CONCURRENT_REQUESTS = 5;
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
        grant_type: "refresh_token",
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    await db.collection("tokens").updateOne(
      { type: "lightspeed" },
      {
        $set: {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          updatedAt: new Date(),
        },
      }
    );

    console.log("✅ Got access token");
    return data.access_token;
  } catch (error) {
    console.error("❌ Failed to get access token:", error.response?.data || error.message);
    throw error;
  }
}

function delay(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

async function fetchPage(url, token, refreshTokenFunc, retryCount = 0) {
  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return { data: res.data, token };
  } catch (error) {
    const status = error.response?.status;

    if (status === 401 && retryCount === 0) {
      console.log("⚠️ Access token expired, refreshing...");
      const newToken = await refreshTokenFunc();
      return fetchPage(url, newToken, refreshTokenFunc, retryCount + 1);
    }

    if ((status === 429 || status === 503) && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_BASE_DELAY * 2 ** retryCount;
      console.warn(`Rate limited or service unavailable. Retrying in ${delayMs}ms...`);
      await delay(delayMs);
      return fetchPage(url, token, refreshTokenFunc, retryCount + 1);
    }

    throw error;
  }
}

async function fetchInventoryData() {
  let accessToken = await getAccessToken();
  const accountID = process.env.ACCOUNT_ID;

  const baseUrl = `https://api.lightspeedapp.com/API/V3/Account/${accountID}/Item.json?limit=${PAGE_LIMIT}&load_relations=${encodeURIComponent(
    JSON.stringify(["ItemShops"])
  )}&sort=itemID`;

  let nextUrls = [baseUrl];
  let allItems = [];

  while (nextUrls.length > 0) {
    // Fetch up to MAX_CONCURRENT_REQUESTS pages in parallel
    const batch = nextUrls.splice(0, MAX_CONCURRENT_REQUESTS);

    console.log(`Fetching batch of ${batch.length} pages...`);

    const results = await Promise.all(
      batch.map((url) => fetchPage(url, accessToken, getAccessToken))
    );

    // Update access token if refreshed in any request
    for (const result of results) {
      accessToken = result.token;
      allItems.push(...(result.data.Item || []));
    }

    // Collect next page URLs for next batch
    nextUrls = results
      .map((result) => result.data["@attributes"]?.next)
      .filter((url) => url);

    console.log(`Total items fetched so far: ${allItems.length}`);
  }

  // Filter 2024 or 2025 in description
  const filtered = allItems.filter((item) => /2024|2025/.test(item.description));

  // Map to your inventory format
  const inventory = filtered.map((item) => ({
    customSku: item.customSku,
    name: item.description,
    locations: (item.ItemShops?.ItemShop || []).map((loc) => ({
      location: loc.Shop ? loc.Shop.name : "Unknown",
      stock: parseInt(loc.qoh || "0"),
    })),
  }));

  console.log(`✅ Finished fetching. Total filtered items: ${inventory.length}`);

  return inventory;
}

module.exports = { getAccessToken, fetchInventoryData };
