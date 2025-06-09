// db.js
const { MongoClient } = require("mongodb")
require("dotenv").config()

let client

async function connectDB() {
  if (!client) {
    client = new MongoClient(process.env.MONGO_URI, { useUnifiedTopology: true })
    await client.connect()
  }
  return client.db("inventory") // This name can be anything; “inventory” is fine
}

module.exports = { connectDB }
