const axios = require("axios");
const { connectDB } = require("./db");
require("dotenv").config();

const PAGE_LIMIT = 100; // Max items per page (Lightspeed max)
const MAX_CONCURRENT_REQUESTS = 10;
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
      // Token expired, refresh token once then retry
      console.log("⚠️ Access token expired, refreshing...");
      const newToken = await refreshTokenFunc();
      return fetchPage(url, newToken, refreshTokenFunc, retryCount + 1);
    }

    if ((status === 429 || status === 503) && retryCount < MAX_RETRIES) {
      const delayMs = RETRY_BASE_DELAY * Math.pow(2, retryCount);
      console.warn(`Rate limited or service unavailable. Retrying in ${delayMs} ms...`);
      await delay(delayMs);
      return fetchPage(url, token, refreshTokenFunc, retryCount + 1);
    }

    throw err;
  }
}

async function fetchInventoryData() {
  let accessToken = await getAccessToken();
  const accountID = process.env.ACCOUNT_ID;

  const firstUrl = `https://api.lightspeedapp.com/API/V3/Account/${accountID}/Item.json?limit=${PAGE_LIMIT}&load_relations=${encodeURIComponent(JSON.stringify(["ItemShops"]))}&sort=itemID`;

  const queue = [firstUrl];
  const results = [];
  let activeRequests = 0;
  let totalFetched = 0;
  let pageCount = 0;

  return new Promise((resolve, reject) => {
    const processQueue = async () => {
      if (queue.length === 0 && activeRequests === 0) {
        // All done
        const filtered = results.filter(item => /2024|2025/.test(item.description || ""));
        const inventory = filtered.map(item => ({
          customSku: item.customSku,
          name: item.description,
          locations: (item.ItemShops?.ItemShop || []).map(loc => ({
            location: loc.Shop?.name || "Unknown",
            stock: parseInt(loc.qoh || "0")
          }))
        }));
        console.log(`✅ DONE — Fetched ${inventory.length} items total.`);
        resolve(inventory);
        return;
      }

      while (queue.length > 0 && activeRequests < MAX_CONCURRENT_REQUESTS) {
        const url = queue.shift();
        activeRequests++;
        pageCount++;

        fetchPage(url, accessToken, getAccessToken)
          .then(({ data, token }) => {
            accessToken = token; // Update token if refreshed

            const items = data.Item || [];
            results.push(...items);
            totalFetched += items.length;

            console.log(`📦 Page ${pageCount} — Fetched ${items.length} items (Total: ${totalFetched})`);

            const nextUrl = data['@attributes']?.next;
            if (nextUrl) queue.push(nextUrl);

            activeRequests--;
            processQueue();
          })
          .catch(err => {
            console.error("❌ Error while fetching page:", err.response?.data || err.message);
            reject(err);
          });
      }
    };

    processQueue();
  });
}


module.exports = { getAccessToken, fetchInventoryData };