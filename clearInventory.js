const { connectDB } = require("./db");

async function clearInventory() {
  const db = await connectDB();
  const result = await db.collection("inventory").deleteMany({});
  console.log(`Deleted ${result.deletedCount} documents from inventory.`);
  process.exit();
}

clearInventory();
