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
    const collection = db.collection("inventory"); // match your API route

    fs.createReadStream(csvPath)
      .pipe(csv())
      .on("data", (row) => {
        const itemName = row["Item"] || "";
        if (itemName.includes("2024") || itemName.includes("2025")) {
          const normalized = {
            customSku: row["Custom SKU"],
            item: row["Item"],
            brand: row["Brand"],
            upc: row["UPC"],
            manufactSku: row["Manufact. SKU"],
            systemId: row["System ID"],
            price: row["Price"],
            tax: row["Tax"],
            msrp: row["MSRP"],
            locations: {
              collingwood: parseInt(row[" Collingwood "]) || 0,
              corbetts: parseInt(row[" Corbetts Ski & Snowboard "]) || 0,
              clearance: parseInt(row[" Clearance Centre "]) || 0,
              reruns: parseInt(row[" ReRuns Basement "]) || 0,
              skiShow: parseInt(row[" Ski Show "]) || 0
            }
          };
          results.push(normalized);
        }
      })
      .on("end", async () => {
        let inserted = 0;
        for (const doc of results) {
          await collection.updateOne(
            { customSku: doc.customSku },
            { $set: doc },
            { upsert: true }
          );
          inserted++;
        }

        console.log(`✅ Seeded ${inserted} filtered items into MongoDB`);
        client.close();
        process.exit();
      });
  })
  .catch((err) => {
    console.error("❌ MongoDB error:", err.message);
    process.exit(1);
  });
