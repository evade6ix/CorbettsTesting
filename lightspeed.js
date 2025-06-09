import axios from "axios"
import dotenv from "dotenv"
dotenv.config()

const LS_BASE = "https://api.lightspeedapp.com/API"

async function getAccessToken() {
  const { data } = await axios.post(
    "https://cloud.lightspeedapp.com/oauth/access_token.php",
    new URLSearchParams({
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
      refresh_token: process.env.REFRESH_TOKEN,
      grant_type: "refresh_token"
    })
  )
  return data.access_token
}

export async function fetchInventoryData() {
  const token = await getAccessToken()
  const accountID = process.env.ACCOUNT_ID

  const itemsRes = await axios.get(`${LS_BASE}/Account/${accountID}/Item.json`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { load_relations: "ItemShops" }
  })

  const inventory = itemsRes.data.Item.map(item => {
    const customSku = item.customSku
    const name = item.description
    const locations = (item.ItemShops?.ItemShop || []).map(loc => ({
      location: loc.Shop.name,
      stock: parseInt(loc.qoh || "0")
    }))

    return { customSku, name, locations }
  })

  return inventory
}
