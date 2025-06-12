const cron = require("node-cron")
const { fetchInventoryData } = require("./lightspeed")
const { connectDB } = require("./db")

cron.schedule("*/30 * * * *", async () => {
  console.log("🔁 Syncing inventory from Lightspeed...")
  const db = await connectDB()
  const collection = db.collection("lightspeed_products")

  const data = await fetchInventoryData()
  for (const item of data) {
    await collection.updateOne(
      { customSku: item.customSku },
      { $set: item },
      { upsert: true }
    )
  }

  console.log(`✅ Synced ${data.length} items`)
})

console.log("⏳ Cron job running every 30 minutes...")
