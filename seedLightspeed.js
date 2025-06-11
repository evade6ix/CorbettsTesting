const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const MONGO_URI = process.env.MONGO_URI;
const csvPath = path.join(__dirname, "item_listings_local_matches.csv");

if (!MONGO_URI) {
  console.error("❌ MONGO_URI not found in .env");
  process.exit(1);
}

if (!fs.existsSync(csvPath)) {
  console.error("❌ CSV file not found:", csvPath);
  process.exit(1);
}

const results = [];

MongoClient.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(async (client) => {
    const db = client.db("inventory");
    const collection = db.collection("lightspeed_products");

    fs.createReadStream(csvPath)
      .pipe(csv())
      .on("data", (row) => {
        const item = row["Item"] || "";
        if (item.includes("2024") || item.includes("2025")) {
          results.push(row);
        }
      })
      .on("end", async () => {
        await collection.deleteMany({});
        await collection.insertMany(results);
        console.log(`✅ Seeded ${results.length} filtered items into MongoDB`);
        client.close();
        process.exit();
      });
  })
  .catch((err) => {
    console.error("❌ MongoDB error:", err.message);
    process.exit(1);
  });
