const { connectDB } = require("./db");

async function main() {
  try {
    const db = await connectDB();
    const tokenDoc = await db.collection("tokens").findOne({ type: "lightspeed" });
    if (!tokenDoc) {
      console.log("No token found");
    } else {
      console.log("Access Token:", tokenDoc.access_token);
    }
  } catch (err) {
    console.error("Error fetching token:", err);
  } finally {
    process.exit();
  }
}

main();
