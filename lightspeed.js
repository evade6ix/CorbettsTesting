const axios = require("axios");
const { connectDB } = require("./db");
require("dotenv").config();

const PAGE_LIMIT = 100; // Max items per page (Lightspeed max)
const MAX_PAGES = 10;   // Fetch up to 10 pages = 1000 items

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

async function fetchInventoryData() {
  const token = await getAccessToken();
  const accountID = process.env.ACCOUNT_ID;

  let allItems = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    console.log(`Fetching page ${page}...`);
    const itemsRes = await axios.get(
      `https://api.lightspeedapp.com/API/Account/${accountID}/Item.json`,
      {
        headers: { Authorization: `Bearer ${token}` },
        params: { 
          load_relations: JSON.stringify(["ItemShops"]),
          limit: PAGE_LIMIT,
          page: page
        }
      }
    );

    const items = itemsRes.data.Item || [];
    allItems = allItems.concat(items);

    // If fewer than PAGE_LIMIT items returned, no more pages
    if (items.length < PAGE_LIMIT) {
      console.log(`Last page reached at page ${page}`);
      break;
    }
  }

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

  console.log(`Fetched ${inventory.length} items total.`);

  return inventory;
}

module.exports = { getAccessToken, fetchInventoryData };
