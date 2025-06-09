import express from "express"
import { connectDB } from "./db.js"
import dotenv from "dotenv"
dotenv.config()

const app = express()
const port = process.env.PORT || 3000

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

app.listen(port, () => {
  console.log(`✅ Inventory API running at http://localhost:${port}`)
})
