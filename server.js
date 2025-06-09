const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { connectDB } = require("./db");
const { fetchInventoryData, getAccessToken } = require("./lightspeed");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 3000;

const allowedOrigins = [
  "https://www.corbetts.com",
  "https://store-186hk-1.mybigcommerce.com"
];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true); // Allow Postman, curl, etc.
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error(`CORS policy does not allow access from ${origin}`), false);
    }
    return callback(null, true);
  }
}));

// OAuth callback to store tokens
app.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing authorization code");

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
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );

    const db = await connectDB();
    await db.collection("tokens").updateOne(
      { type: "lightspeed" },
      {
        $set: {
          access_token: data.access_token,
          refresh_token: data.refresh_token,
          updatedAt: new Date()
        }
      },
      { upsert: true }
    );

    console.log("✅ Tokens stored to DB");
    res.send("✅ Token exchange successful. Refresh token saved to DB.");
  } catch (err) {
    console.error("❌ Failed to exchange code:", err.response?.data || err.message);
    res.status(500).send("❌ Token exchange failed");
  }
});

// Inventory lookup by SKU
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

// Manual Lightspeed sync trigger
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

// BigCommerce API info - put your BigCommerce token in .env as BC_ACCESS_TOKEN
const STORE_HASH = "186hk";
const BC_ACCESS_TOKEN = process.env.BC_ACCESS_TOKEN || "";

// Fetch BigCommerce products filtered by 2024 & 2025 in name
async function fetchFilteredBigCommerceProducts() {
  const products = [];
  let page = 1;
  const limit = 50;

  while (true) {
    const res = await axios.get(
      `https://api.bigcommerce.com/stores/${STORE_HASH}/v3/catalog/products`,
      {
        headers: {
          "X-Auth-Token": BC_ACCESS_TOKEN,
          Accept: "application/json"
        },
        params: { limit, page }
      }
    );

    const filtered = res.data.data.filter(product =>
      /2024|2025/.test(product.name)
    );

    products.push(...filtered);

    if (res.data.meta.pagination.total_pages === page) break;
    page++;
  }

  return products;
}

// Combine BigCommerce and Lightspeed inventory by SKU prefix
async function getCombinedInventory() {
  const bigCommerceProducts = await fetchFilteredBigCommerceProducts();
  console.log(`Fetched ${bigCommerceProducts.length} BigCommerce products`);
  const lightspeedInventory = await fetchInventoryData();
  console.log(`Fetched ${lightspeedInventory.length} Lightspeed items`);

  const lsMap = new Map();
  for (const item of lightspeedInventory) {
    const prefix = item.customSku.split("-")[0];
    if (!lsMap.has(prefix)) lsMap.set(prefix, []);
    lsMap.get(prefix).push(item);
  }

  const combined = bigCommerceProducts.map(bcProduct => {
    const bcSku = bcProduct.sku;
    const matchedLsItems = lsMap.get(bcSku) || [];

    return {
      bigCommerceProduct: {
        id: bcProduct.id,
        name: bcProduct.name,
        sku: bcSku,
        price: bcProduct.price,
        variants: bcProduct.variants || []
      },
      lightspeedInventory: matchedLsItems
    };
  });

  return combined;
}

// Endpoint to get combined inventory data
app.get("/combined-inventory", async (req, res) => {
  try {
    const data = await getCombinedInventory();
    res.json(data);
  } catch (err) {
    console.error("❌ Error fetching combined inventory:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.listen(port, () => {
  console.log(`✅ Inventory API running at http://localhost:${port}`);
});
