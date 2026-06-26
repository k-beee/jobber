import { createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import type { GenLayerClient } from "genlayer-js/types";

// The deployed contract address is loaded from env, or uses the default template address
export const CONTRACT_ADDRESS = (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS ||
  "0x9FE4534ae99C7cd9F5963bC6e0715A7d05D32318") as `0x${string}`;

declare global {
  interface Window {
    ethereum?: any;
  }
}

export type WalletState = {
  address: `0x${string}` | null;
  client: GenLayerClient<any> | null;
};

// GenLayer Studionet Chain Configuration for direct EVM wallet switching
const STUDIONET_PARAMS = {
  chainId: "0xF22F", // 61999 in hex
  chainName: "GenLayer Studio Network",
  nativeCurrency: { name: "GEN Token", symbol: "GEN", decimals: 18 },
  rpcUrls: ["https://studio.genlayer.com/api"],
  blockExplorerUrls: ["https://genlayer-explorer.vercel.app"],
};

export function hasWallet(): boolean {
  return typeof window !== "undefined" && !!window.ethereum;
}

/**
 * Connects standard EVM wallets (MetaMask, Rabby, Frame, etc.) directly.
 * Bypasses GenLayer Snap prompts by setting up the RPC client directly 
 * via standard EVM network registration.
 */
export async function connectWallet(): Promise<WalletState> {
  if (!hasWallet()) {
    throw new Error("No compatible EVM wallet detected. Please install MetaMask or Rabby.");
  }

  // Request accounts
  const accounts: string[] = await window.ethereum.request({
    method: "eth_requestAccounts",
  });
  if (!accounts || accounts.length === 0) {
    throw new Error("Wallet authorization rejected by user.");
  }
  const address = accounts[0] as `0x${string}`;

  // Enforce/Add GenLayer Studio network
  try {
    await window.ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: STUDIONET_PARAMS.chainId }],
    });
  } catch (switchError: any) {
    // 4902 error indicates network is not added
    if (switchError?.code === 4902 || /unrecognized/i.test(switchError?.message || "")) {
      try {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [STUDIONET_PARAMS],
        });
      } catch (addError: any) {
        throw new Error("Failed to register GenLayer Studio network in wallet.");
      }
    } else if (switchError?.code !== 4001) {
      console.warn("Non-blocking network switch warning:", switchError);
    } else {
      throw switchError;
    }
  }

  // Initialize GenLayer Client without Snap setup (signs transaction payload raw)
  const client = createClient({
    chain: studionet,
    account: address,
    provider: window.ethereum,
  } as any);

  return { address, client };
}

/**
 * Read-only Client configured to pull state straight from Studionet JSON-RPC.
 */
export function getReadClient(): GenLayerClient<any> {
  return createClient({ chain: studionet }) as GenLayerClient<any>;
}

export function formatAddress(address: string): string {
  if (!address) return "";
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
