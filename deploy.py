"""Deploy JobberEscrow contract to GenLayer Studio Network via JSON-RPC."""
import json
import requests
import time

STUDIO_URL = "https://studio.genlayer.com/api"

def rpc_call(method, params=None):
    payload = {"jsonrpc": "2.0", "id": 1, "method": method, "params": params or []}
    r = requests.post(STUDIO_URL, json=payload)
    data = r.json()
    if "error" in data:
        raise Exception(f"RPC Error: {data['error']}")
    return data.get("result")

def main():
    # Read contract source
    with open("contracts/jobber_escrow.py", "r") as f:
        contract_code = f.read()

    print("==================================================")
    print("🚀 Deploying JobberEscrow to GenLayer Studio Network...")
    print(f"🔗 Target RPC: {STUDIO_URL}")
    print("==================================================")

    # Get available accounts from Studio
    accounts = rpc_call("eth_accounts")
    if not accounts:
        print("❌ No accounts available on Studio. Please open studio.genlayer.com and create an account first.")
        return
    
    sender = accounts[0]
    print(f"👉 Deploying from account: {sender}")

    # Deploy contract
    result = rpc_call("gen_deployContract", [{
        "from": sender,
        "code": contract_code,
        "args": [],
    }])

    if result:
        print(f"\n✅ Deployment transaction submitted!")
        print(f"   Transaction hash: {result}")
        print("   Waiting 5 seconds for confirmation...")
        time.sleep(5)
        receipt = rpc_call("gen_getTransactionReceipt", [result])
        if receipt:
            contract_addr = receipt.get('contract_address', 'check in Studio')
            print(f"\n🎉 Success! JobberEscrow Contract Address: {contract_addr}")
            print("\nCopy this address and add it to your frontend/.env.local file:")
            print(f"NEXT_PUBLIC_CONTRACT_ADDRESS={contract_addr}")
        else:
            print("⚠️ Confirmation pending. Please check transaction receipt on studio.genlayer.com.")
    else:
        print("❌ Deployment returned no result. Check Studio UI for status.")

if __name__ == "__main__":
    main()
