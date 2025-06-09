const express = require("express")
const { connectDB } = require("./db")
const { fetchInventoryData } = require("./lightspeed")
require("dotenv").config()

const app = express()
const port = process.env.PORT || 3000

// Inventory lookup API
app.get("/inventory/:sku", async (req, res) => {
  const db = await connectDB()
  const result = await db.collection("inventory").findOne({ customSku: req.params.sku })

  if (!result) return res.status(404).json({ error: "SKU not found" })
  res.json({
    sku: result.customSku,
    name: result.name,
    locations: result.locations
  })
})

// Manual Lightspeed sync trigger
app.get("/sync-now", async (req, res) => {
  try {
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

    res.send(`✅ Synced ${data.length} items`)
  } catch (err) {
    console.error("❌ Sync failed:", err.message)
    res.status(500).send("❌ Sync failed")
  }
})

app.listen(port, () => {
  console.log(`✅ Inventory API running at http://localhost:${port}`)
})
