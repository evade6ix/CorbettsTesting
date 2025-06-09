const { connectDB } = require("./db");

async function seedToken() {
  const db = await connectDB();
  await db.collection("tokens").updateOne(
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
  console.log("✅ Token seeded");
  process.exit();
}

seedToken();
