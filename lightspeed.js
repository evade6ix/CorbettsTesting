const axios = require("axios");
const { connectDB } = require("./db");
require("dotenv").config();

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

    const updateData = {
  access_token: data.access_token,
  updatedAt: new Date()
};

if (data.refresh_token) {
  updateData.refresh_token = data.refresh_token;
}

await db.collection("tokens").updateOne(
  { type: "lightspeed" },
  { $set: updateData }
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

  const itemsRes = await axios.get(
    `https://api.lightspeedapp.com/API/Account/${accountID}/Item.json`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params: { load_relations: JSON.stringify(["ItemShops"]) }
    }
  );

  const inventory = itemsRes.data.Item.map(item => {
    const customSku = item.customSku;
    const name = item.description;
    const locations = (item.ItemShops?.ItemShop || []).map(loc => ({
      location: loc.Shop ? loc.Shop.name : "Unknown",
      stock: parseInt(loc.qoh || "0")
    }));
    return { customSku, name, locations };
  });

  return inventory;
}

module.exports = { getAccessToken, fetchInventoryData };
