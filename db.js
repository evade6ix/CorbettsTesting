import { MongoClient } from "mongodb"
import dotenv from "dotenv"
dotenv.config()

const client = new MongoClient(process.env.MONGO_URI)
const dbName = "inventory"

export async function connectDB() {
  if (!client.isConnected) await client.connect()
  return client.db(dbName)
}
