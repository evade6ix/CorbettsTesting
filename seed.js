const { connectDB } = require("./db");
require('dotenv').config();

async function seedToken() {
  const db = await connectDB();
  console.log("Connected to DB:", db.databaseName);

  const result = await db.collection("tokens").updateOne(
    { type: "lightspeed" },
    {
      $set: {
        refresh_token: "46f2cb5891dd708f7c3b8ec8b374a555a4f70bb6",
        access_token: null,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
  console.log("Seed result:", result);
  console.log("✅ Token seeded");
  process.exit();
}

seedToken();