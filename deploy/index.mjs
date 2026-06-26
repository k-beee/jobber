import { createClient, createAccount } from "genlayer-js";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const contractPath = resolve(__dirname, "../contracts/jobber_escrow.py");
const code = readFileSync(contractPath, "utf-8");

// Generate a random temporary account to trigger the deploy via SDK
const account = createAccount();

// Set up the GenLayer Studio Network Client
const client = createClient({
  chain: {
    id: 61_999,
    name: "GenLayer Studionet",
    rpcUrls: { default: { http: ["https://studio.genlayer.com/api"] } },
  },
  account,
});

console.log("==================================================");
console.log("🚀 Deploying JobberEscrow to GenLayer Studionet...");
console.log(`🔌 Generated deployment address: ${account.address}`);
console.log("==================================================");

try {
  const hash = await client.deployContract({ code, args: [] });
  console.log(`👉 Tx submitted! Hash: ${hash}`);
  console.log("⏳ Waiting for transaction receipt...");
  
  const receipt = await client.waitForTransactionReceipt({ hash });
  console.log(`\n🎉 Success! JobberEscrow has been deployed!`);
  console.log(`📍 Contract Address: ${receipt.contractAddress}`);
  console.log(`\nCopy the following line to frontend/.env.local:`);
  console.log(`NEXT_PUBLIC_CONTRACT_ADDRESS=${receipt.contractAddress}`);
} catch (e) {
  console.error("❌ Deployment failed:", e.message || e);
}
