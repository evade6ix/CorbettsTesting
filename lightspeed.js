const axios = require("axios");
const { connectDB } = require("./db");
require("dotenv").config();

const PAGE_LIMIT = 100; // Max items per page (Lightspeed max)

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
  let nextUrl = `https://api.lightspeedapp.com/API/V3/Account/${accountID}/Item.json?limit=${PAGE_LIMIT}&load_relations=${encodeURIComponent(JSON.stringify(["ItemShops"]))}`;

  let pageCount = 0;
  const MAX_PAGES = 5;

  while (nextUrl && pageCount < MAX_PAGES) {
    pageCount++;
    console.log(`Fetching page ${pageCount}: ${nextUrl}...`);

    const res = await axios.get(nextUrl, {
      headers: { Authorization: `Bearer ${token}` }
    });

    const items = res.data.Item || [];
    allItems = allItems.concat(items);

    // Get next page URL from response metadata
    nextUrl = res.data['@attributes']?.next || null;
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