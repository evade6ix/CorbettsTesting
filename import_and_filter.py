import pandas as pd
from pymongo import MongoClient
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

MONGO_URI = os.getenv("MONGO_URI") or "mongodb+srv://corbetts:corbetts@corbetts.rrbmdyq.mongodb.net/corbetts"
client = MongoClient(MONGO_URI)
db = client["corbetts"]
collection = db["lightspeed_products"]

# Load CSV from root
df = pd.read_csv("item_listings_local_matches.csv")

# Step 1: Clear previous data
collection.delete_many({})
print("🧹 Collection cleared.")

# Step 2: Insert all data
collection.insert_many(df.to_dict(orient="records"))
print(f"✅ Inserted {len(df)} records into MongoDB.")

# Step 3: Delete rows where 'Item' does NOT contain 2024 or 2025
deleted = collection.delete_many({
    "Item": {
        "$not": {
            "$regex": "2024|2025"
        }
    }
})
print(f"🗑️ Deleted {deleted.deleted_count} non-matching rows.")
