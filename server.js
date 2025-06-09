const express = require("express");
const axios = require("axios");
const { connectDB } = require("./db");
const { fetchInventoryData } = require("./lightspeed");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

// ✅ Handle OAuth callback and exchange for tokens
app.get("/callback", async (req, res) => {
  const code = req.query.code;

  if (!code) {
    return res.status(400).send("Missing authorization code");
  }

  try {
    const { data } = await axios.post(
      "https://cloud.lightspeedapp.com/oauth/access_token.php",
      new URLSearchParams({
        client_id: process.env.CLIENT_ID,
        client_secret: process.env.CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: "https://corbettstesting-production.up.railway.app/callback"
      }),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        }
      }
    );

    console.log("✅ Access Token:", data.access_token);
    console.log("✅ Refresh Token:", data.refresh_token);
    res.send("✅ Token exchange successful. Check logs.");
  } catch (err) {
    console.error("❌ Failed to exchange code:", err.response?.data || err.message);
    res.status(500).send("❌ Failed to exchange token.");
  }
});

// 🔍 Inventory lookup
app.get("/inventory/:sku", async (req, res) => {
  try {
    const db = await connectDB();
    const result = await db.collection("inventory").findOne({ customSku: req.params.sku });

    if (!result) return res.status(404).json({ error: "SKU not found" });

    res.json({
      sku: result.customSku,
      name: result.name,
      locations: result.locations
    });
  } catch (err) {
    console.error("❌ Error in inventory route:", err.message);
    res.status(500).json({ error: "Server error" });
  }
});

// 🔄 Manual Lightspeed sync trigger
app.get("/sync-now", async (req, res) => {
  try {
    const db = await connectDB();
    const collection = db.collection("inventory");
    const data = await fetchInventoryData();

    for (const item of data) {
      await collection.updateOne(
        { customSku: item.customSku },
        { $set: item },
        { upsert: true }
      );
    }

    res.send(`✅ Synced ${data.length} items`);
  } catch (err) {
    console.error("❌ Sync failed:", err.message);
    res.status(500).send("❌ Sync failed");
  }
});

app.listen(port, () => {
  console.log(`✅ Inventory API running at http://localhost:${port}`);
});