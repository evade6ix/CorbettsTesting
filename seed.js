const { connectDB } = require("./db");

async function seedToken() {
  const db = await connectDB();
  await db.collection("tokens").updateOne(
    { type: "lightspeed" },
    {
      $set: {
        refresh_token: "your_actual_refresh_token_here",
        access_token: null,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
  console.log("✅ Token seeded");
  process.exit();
}

seedToken();
