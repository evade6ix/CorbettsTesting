import cron from "node-cron"
import { fetchInventoryData } from "./lightspeed.js"
import { connectDB } from "./db.js"

cron.schedule("*/30 * * * *", async () => {
  console.log("🔁 Syncing inventory from Lightspeed...")
  const db = await connectDB()
  const collection = db.collection("inventory")

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
