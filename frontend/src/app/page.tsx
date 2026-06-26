"use client";

import { useState, useEffect, useCallback } from "react";
import { CONTRACT_ADDRESS, connectWallet, getReadClient, formatAddress, type WalletState } from "@/lib/genlayer";
import { TransactionStatus } from "genlayer-js/types";

type Job = {
  id: string;
  employer: string;
  contractor: string;
  title: string;
  description: string;
  requirements: string;
  escrow_amount: string;
  status: number;
  deliverable: string;
  dispute_reason: string;
  resolution: string;
  created_at: number;
  deadline: number;
  employer_rated: boolean;
  contractor_rated: boolean;
};

type UserRating = {
  total_score: number;
  count: number;
  average: number;
};

const STATUS_LABELS = [
  "Open Contract",
  "In Progress",
  "Work Submitted",
  "AI Arbitration",
  "Agreement Settled",
  "Cancelled"
];

const STATUS_COLORS = [
  "#3b82f6", // Open - Blue
  "#f59e0b", // In Progress - Amber
  "#a855f7", // Submitted - Purple
  "#ef4444", // Disputed - Red
  "#10b981", // Completed - Emerald
  "#64748b"  // Cancelled - Slate
];

export default function Page() {
  const [wallet, setWallet] = useState<WalletState>({ address: null, client: null });
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(false);
  const [nav, setNav] = useState<"dashboard" | "explore" | "create">("dashboard");
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [ratings, setRatings] = useState<Record<string, UserRating>>({});
  
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [userRoleFilter, setUserRoleFilter] = useState<string>("all");

  const [form, setForm] = useState({
    title: "",
    description: "",
    requirements: "",
    amount: "",
    duration: "48"
  });
  
  const [submissionText, setSubmissionText] = useState("");
  const [disputeText, setDisputeText] = useState("");
  const [ratingValue, setRatingValue] = useState<number>(5);
  const [statusMessage, setStatusMessage] = useState("");

  // Load contract state
  const loadState = useCallback(async () => {
    try {
      const readClient = getReadClient();
      const count = Number(
        await readClient.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_job_count",
          args: [],
        })
      );
      
      const loadedJobs: Job[] = [];
      const fetchedRatings: Record<string, UserRating> = {};

      for (let i = 1; i <= count; i++) {
        const rawJob = await readClient.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_job",
          args: [String(i)],
        });
        const job = JSON.parse(rawJob as string) as Job;
        loadedJobs.push(job);

        // Fetch ratings for employer and contractor if they are valid addresses
        if (job.employer && !fetchedRatings[job.employer]) {
          const rawRating = await readClient.readContract({
            address: CONTRACT_ADDRESS,
            functionName: "get_user_rating",
            args: [job.employer],
          });
          fetchedRatings[job.employer] = JSON.parse(rawRating as string);
        }
        if (job.contractor && !fetchedRatings[job.contractor]) {
          const rawRating = await readClient.readContract({
            address: CONTRACT_ADDRESS,
            functionName: "get_user_rating",
            args: [job.contractor],
          });
          fetchedRatings[job.contractor] = JSON.parse(rawRating as string);
        }
      }

      setJobs(loadedJobs.reverse());
      setRatings(fetchedRatings);
    } catch (e) {
      console.error("Error loading contract state:", e);
    }
  }, []);

  useEffect(() => {
    loadState();
  }, [loadState]);

  // Connect Wallet Handler
  async function handleConnect() {
    setStatusMessage("Switching network & requesting account...");
    try {
      const w = await connectWallet();
      setWallet(w);
      setStatusMessage("");
      // Fetch user rating for connected wallet
      if (w.address) {
        const readClient = getReadClient();
        const rawRating = await readClient.readContract({
          address: CONTRACT_ADDRESS,
          functionName: "get_user_rating",
          args: [w.address],
        });
        setRatings(prev => ({
          ...prev,
          [w.address!]: JSON.parse(rawRating as string)
        }));
      }
    } catch (e: any) {
      setStatusMessage(`Connection failed: ${e.message}`);
    }
  }

  // Execute Contract Transaction
  async function runTransaction(fnName: string, args: any[], value?: bigint) {
    if (!wallet.client || !wallet.address) {
      setStatusMessage("Please connect your wallet first.");
      return;
    }
    setLoading(true);
    setStatusMessage(`Requesting signature: ${fnName}...`);
    try {
      const hash = await wallet.client.writeContract({
        address: CONTRACT_ADDRESS,
        functionName: fnName,
        args,
        value: value ?? BigInt(0),
      });
      setStatusMessage(`Transaction submitted. Awaiting block confirmation...`);
      await wallet.client.waitForTransactionReceipt({
        hash,
        status: TransactionStatus.ACCEPTED,
      });
      setStatusMessage("");
      await loadState();
      // Reset contextual states
      setSubmissionText("");
      setDisputeText("");
      setSelectedJob(null);
      if (nav === "create") setNav("explore");
    } catch (e: any) {
      setStatusMessage(`Transaction reverted: ${e.message}`);
    }
    setLoading(false);
  }

  // Filter jobs based on role and status selection
  const filteredJobs = jobs.filter(job => {
    const isEmployer = wallet.address && job.employer.toLowerCase() === wallet.address.toLowerCase();
    const isContractor = wallet.address && job.contractor.toLowerCase() === wallet.address.toLowerCase();
    
    if (userRoleFilter === "employer" && !isEmployer) return false;
    if (userRoleFilter === "contractor" && !isContractor) return false;
    if (userRoleFilter === "involved" && !isEmployer && !isContractor) return false;
    
    if (statusFilter !== "all") {
      if (statusFilter === "open" && job.status !== 0) return false;
      if (statusFilter === "active" && job.status !== 1 && job.status !== 2) return false;
      if (statusFilter === "disputed" && job.status !== 3) return false;
      if (statusFilter === "settled" && job.status !== 4 && job.status !== 5) return false;
    }
    
    return true;
  });

  // Calculate statistics
  const stats = {
    totalEscrowLocked: jobs.reduce((sum, j) => j.status < 4 ? sum + Number(BigInt(j.escrow_amount)) / 1e18 : sum, 0),
    activeCount: jobs.filter(j => j.status === 1 || j.status === 2).length,
    disputeCount: jobs.filter(j => j.status === 3).length,
    completedCount: jobs.filter(j => j.status === 4).length,
  };

  return (
    <div style={layoutContainer}>
      {/* Sidebar Navigation */}
      <aside style={sidebarStyle}>
        <div style={logoContainer}>
          <span style={logoIcon}>⚡</span>
          <span style={logoText}>JOBBER</span>
        </div>
        <nav style={navGroup}>
          <button onClick={() => { setNav("dashboard"); setSelectedJob(null); }} style={navButton(nav === "dashboard")}>
            <span style={navBtnIcon}>📊</span> Dashboard
          </button>
          <button onClick={() => { setNav("explore"); setSelectedJob(null); }} style={navButton(nav === "explore")}>
            <span style={navBtnIcon}>🔍</span> Explore Contracts
          </button>
          <button onClick={() => { setNav("create"); setSelectedJob(null); }} style={navButton(nav === "create")}>
            <span style={navBtnIcon}>✍️</span> Post a Contract
          </button>
        </nav>

        {/* User Account / Profile Wallet Component */}
        <div style={sidebarFooter}>
          {wallet.address ? (
            <div style={profileCard}>
              <div style={profileHeader}>
                <div style={profileIndicator}></div>
                <span style={profileAddr}>{formatAddress(wallet.address)}</span>
              </div>
              <div style={ratingBadge}>
                ⭐ Reputation: {ratings[wallet.address]?.average.toFixed(1) ?? "0.0"} ({ratings[wallet.address]?.count ?? 0} reviews)
              </div>
            </div>
          ) : (
            <button onClick={handleConnect} style={connectButton}>
              Connect Wallet
            </button>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <main style={mainContainer}>
        {statusMessage && (
          <div style={statusBar}>
            <span style={{ marginRight: 8 }}>ℹ️</span>
            <span>{statusMessage}</span>
          </div>
        )}

        {nav === "dashboard" && (
          <div className="animate-fade-in">
            <header style={pageHeader}>
              <h1 style={titleStyle}>Contractor Dashboard</h1>
              <p style={subtitleStyle}>Manage locked escrows, submit deliverables, and track autonomous AI arbitration.</p>
            </header>

            {/* Platform Overview */}
            <section style={dashboardHero}>
              <div style={heroInner}>
                <h2 style={heroTitle}>Next-Gen Freelance Shielding</h2>
                <p style={heroText}>
                  Jobber ensures complete financial safety for both employers and freelancers. Payments are locked in smart contracts, and subjective disputes are settled in minutes by decentralized AI validator pools based on objective contract criteria.
                </p>
                <div style={heroSteps}>
                  <div style={heroStep}>
                    <div style={stepNum}>01</div>
                    <div style={stepTitle}>Post & Lock</div>
                    <div style={stepDesc}>Employer locks native GEN in escrow with specifications.</div>
                  </div>
                  <div style={heroStep}>
                    <div style={stepNum}>02</div>
                    <div style={stepTitle}>Accept & Deliver</div>
                    <div style={stepDesc}>Contractor accepts and uploads deliverables before the deadline.</div>
                  </div>
                  <div style={heroStep}>
                    <div style={stepNum}>03</div>
                    <div style={stepTitle}>Approve or Dispute</div>
                    <div style={stepDesc}>Employer approves payout, or triggers AI arbitration split.</div>
                  </div>
                </div>
              </div>
            </section>

            {/* Statistics Widgets */}
            <div style={statsGrid}>
              <div style={statCard}>
                <span style={statLabel}>Total Value Locked</span>
                <span style={statValue}>{stats.totalEscrowLocked.toFixed(2)} GEN</span>
              </div>
              <div style={statCard}>
                <span style={statLabel}>Active Contracts</span>
                <span style={statValue}>{stats.activeCount}</span>
              </div>
              <div style={statCard}>
                <span style={statLabel}>Arbitration Disputes</span>
                <span style={{ ...statValue, color: "var(--color-danger)" }}>{stats.disputeCount}</span>
              </div>
              <div style={statCard}>
                <span style={statLabel}>Completed Jobs</span>
                <span style={{ ...statValue, color: "var(--color-secondary)" }}>{stats.completedCount}</span>
              </div>
            </div>
            
            <div style={{ marginTop: 40 }}>
              <h3 style={sectionTitle}>Your Active Agreements</h3>
              <p style={{ color: "var(--text-muted)", fontSize: 14, marginBottom: 16 }}>Connect wallet to display agreements you are involved in.</p>
              {wallet.address && jobs.filter(j => j.employer.toLowerCase() === wallet.address!.toLowerCase() || j.contractor.toLowerCase() === wallet.address!.toLowerCase()).slice(0, 3).map(job => (
                <div key={job.id} onClick={() => { setNav("explore"); setSelectedJob(job); }} style={jobRow}>
                  <div>
                    <div style={jobRowTitle}>{job.title}</div>
                    <div style={jobRowMeta}>
                      Employer: {formatAddress(job.employer)} | Value: {(Number(BigInt(job.escrow_amount)) / 1e18).toFixed(2)} GEN
                    </div>
                  </div>
                  <span style={statusBadge(job.status)}>
                    {STATUS_LABELS[job.status]}
                  </span>
                </div>
              ))}
              {(!wallet.address || jobs.filter(j => j.employer.toLowerCase() === wallet.address!.toLowerCase() || j.contractor.toLowerCase() === wallet.address!.toLowerCase()).length === 0) && (
                <div style={emptyStateCard}>
                  <p style={{ color: "var(--text-muted)" }}>No active agreements found.</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// Styling Constants (Inline CSS for maximum portability and type safety)
const layoutContainer: React.CSSProperties = {
  display: "flex",
  minHeight: "100vh",
  background: "var(--bg-main)",
  color: "var(--text-main)",
};

const sidebarStyle: React.CSSProperties = {
  width: 280,
  background: "var(--bg-sidebar)",
  borderRight: "1px solid var(--border-color)",
  padding: "32px 24px",
  display: "flex",
  flexDirection: "column",
  flexShrink: 0,
};

const logoContainer: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginBottom: 40,
};

const logoIcon: React.CSSProperties = {
  fontSize: 24,
  background: "linear-gradient(135deg, var(--color-primary), var(--color-secondary))",
  WebkitBackgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

const logoText: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 20,
  fontWeight: 800,
  letterSpacing: "1px",
};

const navGroup: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
  flex: 1,
};

const navButton = (active: boolean): React.CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "14px 18px",
  borderRadius: 12,
  border: "none",
  background: active ? "var(--bg-card)" : "transparent",
  color: active ? "var(--text-main)" : "var(--text-muted)",
  cursor: "pointer",
  fontSize: 14,
  fontWeight: 600,
  textAlign: "left",
  width: "100%",
});

const navBtnIcon: React.CSSProperties = {
  fontSize: 16,
};

const sidebarFooter: React.CSSProperties = {
  marginTop: "auto",
};

const connectButton: React.CSSProperties = {
  background: "linear-gradient(135deg, var(--color-primary), #2563eb)",
  color: "#fff",
  border: "none",
  borderRadius: 12,
  padding: "14px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  width: "100%",
  boxShadow: "0 4px 12px rgba(59, 130, 246, 0.2)",
};

const profileCard: React.CSSProperties = {
  background: "var(--bg-card)",
  borderRadius: 12,
  border: "1px solid var(--border-color)",
  padding: "16px",
};

const profileHeader: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  marginBottom: 6,
};

const profileIndicator: React.CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: "50%",
  background: "var(--color-secondary)",
  boxShadow: "0 0 8px var(--color-secondary)",
};

const profileAddr: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  fontFamily: "monospace",
};

const ratingBadge: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  marginTop: 4,
};

const mainContainer: React.CSSProperties = {
  flex: 1,
  padding: "48px 48px",
  maxHeight: "100vh",
  overflowY: "auto",
};

const statusBar: React.CSSProperties = {
  background: "rgba(59, 130, 246, 0.1)",
  border: "1px solid rgba(59, 130, 246, 0.3)",
  color: "#93c5fd",
  padding: "14px 20px",
  borderRadius: 12,
  marginBottom: 24,
  fontSize: 14,
  display: "flex",
  alignItems: "center",
};

const pageHeader: React.CSSProperties = {
  marginBottom: 36,
};

const titleStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 32,
  fontWeight: 800,
  letterSpacing: "-0.5px",
  marginBottom: 8,
};

const subtitleStyle: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: 16,
  maxWidth: 600,
  lineHeight: 1.5,
};

const dashboardHero: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(17, 20, 32, 0.7) 0%, rgba(11, 13, 20, 0.7) 100%)",
  border: "1px solid var(--border-color)",
  borderRadius: 20,
  padding: "32px",
  marginBottom: 32,
  backdropFilter: "blur(12px)",
};

const heroInner: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 16,
};

const heroTitle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 22,
  fontWeight: 700,
};

const heroText: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: 14,
  lineHeight: 1.6,
  maxWidth: 800,
};

const heroSteps: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 20,
  marginTop: 16,
};

const heroStep: React.CSSProperties = {
  background: "rgba(7, 9, 14, 0.4)",
  border: "1px solid var(--border-color)",
  borderRadius: 12,
  padding: "20px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const stepNum: React.CSSProperties = {
  fontSize: 12,
  color: "var(--color-primary)",
  fontWeight: 800,
};

const stepTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
};

const stepDesc: React.CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  lineHeight: 1.4,
};

const statsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
  gap: 20,
};

const statCard: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-color)",
  borderRadius: 16,
  padding: "24px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const statLabel: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: 14,
  fontWeight: 500,
};

const statValue: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 28,
  fontWeight: 800,
};

const sectionTitle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 18,
  fontWeight: 700,
  marginBottom: 4,
};

const jobRow: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-color)",
  borderRadius: 16,
  padding: "18px 24px",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  cursor: "pointer",
  marginBottom: 12,
};

const jobRowTitle: React.CSSProperties = {
  fontSize: 16,
  fontWeight: 700,
  marginBottom: 4,
};

const jobRowMeta: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-muted)",
};

const statusBadge = (status: number): React.CSSProperties => ({
  background: STATUS_COLORS[status] + "1a",
  color: STATUS_COLORS[status],
  border: `1px solid ${STATUS_COLORS[status]}33`,
  borderRadius: 20,
  padding: "6px 14px",
  fontSize: 12,
  fontWeight: 700,
});

const emptyStateCard: React.CSSProperties = {
  background: "rgba(17, 20, 32, 0.4)",
  border: "1px dashed var(--border-color)",
  borderRadius: 16,
  padding: "40px",
  textAlign: "center",
};
