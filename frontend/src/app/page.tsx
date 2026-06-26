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

        {nav === "create" && (
          <div className="animate-fade-in">
            <header style={pageHeader}>
              <h1 style={titleStyle}>Post a Job Escrow</h1>
              <p style={subtitleStyle}>Lock GEN tokens in a secure contract with explicit tasks and requirements.</p>
            </header>
            <form
              onSubmit={e => {
                e.preventDefault();
                runTransaction(
                  "create_job",
                  [form.title, form.description, form.requirements, Number(form.duration)],
                  BigInt(form.amount || "0") * BigInt(10 ** 18)
                );
              }}
              style={formCard}
            >
              <div style={formGroup}>
                <label style={formLabel}>Contract Title</label>
                <input
                  type="text"
                  placeholder="e.g. Smart Contract Audit / Landing Page Design"
                  value={form.title}
                  onChange={e => setForm({ ...form, title: e.target.value })}
                  required
                  style={formInput}
                />
              </div>

              <div style={formGroup}>
                <label style={formLabel}>Job Specifications & Description</label>
                <textarea
                  placeholder="Clearly describe the project tasks, parameters, and deliverables..."
                  value={form.description}
                  onChange={e => setForm({ ...form, description: e.target.value })}
                  required
                  rows={4}
                  style={formTextarea}
                />
              </div>

              <div style={formGroup}>
                <label style={formLabel}>Validator Compliance Guidelines</label>
                <textarea
                  placeholder="Explicit requirements that AI validators will audit to settle disputes (e.g. must support dark mode, must pass unit tests)..."
                  value={form.requirements}
                  onChange={e => setForm({ ...form, requirements: e.target.value })}
                  required
                  rows={4}
                  style={formTextarea}
                />
              </div>

              <div style={twoColForm}>
                <div style={formGroup}>
                  <label style={formLabel}>Locked Escrow Amount (GEN)</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="e.g. 50"
                    value={form.amount}
                    onChange={e => setForm({ ...form, amount: e.target.value })}
                    required
                    style={formInput}
                  />
                </div>
                <div style={formGroup}>
                  <label style={formLabel}>Agreement Deadline (Hours)</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="e.g. 48"
                    value={form.duration}
                    onChange={e => setForm({ ...form, duration: e.target.value })}
                    required
                    style={formInput}
                  />
                </div>
              </div>

              <button type="submit" disabled={loading} style={primaryActionBtn}>
                {loading ? "Submitting Transaction..." : "Deploy Contract & Lock Escrow"}
              </button>
            </form>
          </div>
        )}

        {nav === "explore" && !selectedJob && (
          <div className="animate-fade-in">
            <header style={pageHeader}>
              <h1 style={titleStyle}>Explore Agreements</h1>
              <p style={subtitleStyle}>Browse all active contract escrows, applications, and resolved arbitrations.</p>
            </header>

            {/* Filter Panel */}
            <div style={filterPanel}>
              <div style={filterItem}>
                <label style={filterLabel}>Status Filter</label>
                <select
                  value={statusFilter}
                  onChange={e => setStatusFilter(e.target.value)}
                  style={filterSelect}
                >
                  <option value="all">All Agreements</option>
                  <option value="open">Open (Waiting for Contractor)</option>
                  <option value="active">Active (In Progress)</option>
                  <option value="disputed">Under Dispute (AI Arbitration)</option>
                  <option value="settled">Settled / Closed</option>
                </select>
              </div>
              <div style={filterItem}>
                <label style={filterLabel}>Role Filter</label>
                <select
                  value={userRoleFilter}
                  onChange={e => setUserRoleFilter(e.target.value)}
                  style={filterSelect}
                >
                  <option value="all">All Roles</option>
                  <option value="involved">My Agreements</option>
                  <option value="employer">As Employer</option>
                  <option value="contractor">As Contractor</option>
                </select>
              </div>
            </div>

            {/* Job Grid */}
            <div style={jobsGrid}>
              {filteredJobs.length === 0 ? (
                <div style={emptyExploreState}>
                  <span style={{ fontSize: 32 }}>📁</span>
                  <p style={{ marginTop: 12, color: "var(--text-muted)" }}>No agreements matching these filters found.</p>
                </div>
              ) : (
                filteredJobs.map(job => (
                  <div key={job.id} onClick={() => setSelectedJob(job)} style={jobCard}>
                    <div style={jobCardHeader}>
                      <span style={statusBadge(job.status)}>{STATUS_LABELS[job.status]}</span>
                      <span style={jobCardValue}>
                        {(Number(BigInt(job.escrow_amount)) / 1e18).toFixed(2)} GEN
                      </span>
                    </div>
                    <h3 style={jobCardTitle}>{job.title}</h3>
                    <p style={jobCardDesc}>{job.description.slice(0, 120)}{job.description.length > 120 ? "..." : ""}</p>
                    <div style={jobCardFooter}>
                      <div style={jobFooterItem}>
                        <span style={footerItemLabel}>Employer</span>
                        <span style={footerItemVal}>{formatAddress(job.employer)}</span>
                      </div>
                      {job.contractor && (
                        <div style={jobFooterItem}>
                          <span style={footerItemLabel}>Contractor</span>
                          <span style={footerItemVal}>{formatAddress(job.contractor)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        {nav === "explore" && selectedJob && (
          <div className="animate-fade-in" style={detailContainer}>
            {/* Back header */}
            <div style={detailHeader}>
              <button onClick={() => setSelectedJob(null)} style={backBtn}>
                ← Back to Explorer
              </button>
              <span style={statusBadge(selectedJob.status)}>{STATUS_LABELS[selectedJob.status]}</span>
            </div>

            <div style={detailContentGrid}>
              {/* Left Column: Contract Details */}
              <div style={detailLeftCol}>
                <h2 style={detailTitle}>{selectedJob.title}</h2>
                <div style={detailMetaRow}>
                  <div style={detailMetaItem}>
                    <span style={metaItemLabel}>Employer Address</span>
                    <span style={metaItemVal}>{selectedJob.employer}</span>
                  </div>
                  {selectedJob.contractor && (
                    <div style={detailMetaItem}>
                      <span style={metaItemLabel}>Contractor Address</span>
                      <span style={metaItemVal}>{selectedJob.contractor}</span>
                    </div>
                  )}
                </div>

                <div style={timelineContainer}>
                  <h4 style={subSectionTitle}>Progress Tracker</h4>
                  <div style={timeline}>
                    {[
                      { l: "Created", a: true },
                      { l: "Accepted", a: selectedJob.status >= 1 },
                      { l: "Submitted", a: selectedJob.status >= 2 },
                      { l: "Completed", a: selectedJob.status === 4 },
                    ].map((step, idx) => (
                      <div key={idx} style={timelineStep}>
                        <div style={stepBullet(step.a)}></div>
                        <span style={stepLabelText(step.a)}>{step.l}</span>
                        {idx < 3 && <div style={stepLine(step.a)}></div>}
                      </div>
                    ))}
                  </div>
                </div>

                <div style={descBox}>
                  <h4 style={subSectionTitle}>Project Specifications</h4>
                  <p style={descText}>{selectedJob.description}</p>
                </div>

                <div style={descBox}>
                  <h4 style={subSectionTitle}>Compliance Guidelines & Requirements</h4>
                  <p style={descText}>{selectedJob.requirements}</p>
                </div>

                {selectedJob.deliverable && (
                  <div style={deliverableBox}>
                    <h4 style={subSectionTitle}>Submitted Deliverable</h4>
                    <p style={descText}>{selectedJob.deliverable}</p>
                  </div>
                )}

                {selectedJob.dispute_reason && (
                  <div style={disputeBox}>
                    <h4 style={subSectionTitle}>Dispute Reason</h4>
                    <p style={descText}>{selectedJob.dispute_reason}</p>
                  </div>
                )}
              </div>

              {/* Right Column: Escrow Financials & Action Panel */}
              <div style={detailRightCol}>
                <div style={financialCard}>
                  <span style={financialLabel}>Escrow Custody</span>
                  <span style={financialValue}>
                    {(Number(BigInt(selectedJob.escrow_amount)) / 1e18).toFixed(2)} GEN
                  </span>
                  <div style={deadlineInfo}>
                    <span>Deadline Target:</span>
                    <span>{new Date(selectedJob.deadline * 1000).toLocaleString()}</span>
                  </div>
                </div>

                {/* Actions Box */}
                <div style={actionsCard}>
                  <h4 style={actionsCardTitle}>Contract Actions</h4>
                  
                  {/* Contractor accepts open job */}
                  {selectedJob.status === 0 && (
                    <div style={actionButtonGroup}>
                      <button
                        onClick={() => runTransaction("accept_job", [selectedJob.id])}
                        disabled={loading}
                        style={primaryActionBtn}
                      >
                        {loading ? "Accepting..." : "Accept & Start Contract"}
                      </button>
                      <button
                        onClick={() => runTransaction("cancel_job", [selectedJob.id])}
                        disabled={loading}
                        style={dangerActionBtn}
                      >
                        {loading ? "Cancelling..." : "Cancel Contract & Refund"}
                      </button>
                    </div>
                  )}

                  {/* Contractor submits deliverables */}
                  {selectedJob.status === 1 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                      <textarea
                        placeholder="Provide details of your deliverable (description, links to commits/hosting)..."
                        value={submissionText}
                        onChange={e => setSubmissionText(e.target.value)}
                        rows={4}
                        style={formTextarea}
                      />
                      <button
                        onClick={() => runTransaction("submit_work", [selectedJob.id, submissionText])}
                        disabled={loading || !submissionText}
                        style={primaryActionBtn}
                      >
                        {loading ? "Submitting..." : "Submit Deliverables"}
                      </button>
                      <button
                        onClick={() => runTransaction("claim_expired_refund", [selectedJob.id])}
                        disabled={loading}
                        style={dangerActionBtn}
                      >
                        Claim Expired Refund
                      </button>
                    </div>
                  )}

                  {/* Employer reviews deliverables */}
                  {selectedJob.status === 2 && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                      <button
                        onClick={() => runTransaction("approve_work", [selectedJob.id])}
                        disabled={loading}
                        style={successActionBtn}
                      >
                        {loading ? "Releasing funds..." : "Approve Work & Release Payout"}
                      </button>
                      
                      <div style={disputeSection}>
                        <textarea
                          placeholder="Provide the reason you are disputing this deliverable..."
                          value={disputeText}
                          onChange={e => setDisputeText(e.target.value)}
                          rows={3}
                          style={formTextarea}
                        />
                        <button
                          onClick={() => runTransaction("raise_dispute", [selectedJob.id, disputeText])}
                          disabled={loading || !disputeText}
                          style={dangerActionBtn}
                        >
                          {loading ? "Filing dispute..." : "Reject Work & Open Dispute"}
                        </button>
                      </div>
                    </div>
                  )}

                  {selectedJob.status > 2 && (
                    <p style={{ color: "var(--text-muted)", fontSize: 13 }}>
                      No direct actions available. See status metrics or ratings.
                    </p>
                  )}
                </div>
              </div>
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

const formCard: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-color)",
  borderRadius: 16,
  padding: "32px",
  maxWidth: 680,
  display: "flex",
  flexDirection: "column",
  gap: 20,
};

const formGroup: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const formLabel: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  color: "var(--text-main)",
};

const formInput: React.CSSProperties = {
  background: "rgba(7, 9, 14, 0.4)",
  border: "1px solid var(--border-color)",
  borderRadius: 10,
  padding: "12px 16px",
  color: "var(--text-main)",
  fontSize: 14,
  fontFamily: "var(--font-body)",
};

const formTextarea: React.CSSProperties = {
  background: "rgba(7, 9, 14, 0.4)",
  border: "1px solid var(--border-color)",
  borderRadius: 10,
  padding: "12px 16px",
  color: "var(--text-main)",
  fontSize: 14,
  fontFamily: "var(--font-body)",
  resize: "vertical",
};

const twoColForm: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 20,
};

const primaryActionBtn: React.CSSProperties = {
  background: "linear-gradient(135deg, var(--color-primary), #2563eb)",
  color: "#fff",
  border: "none",
  borderRadius: 12,
  padding: "14px 24px",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
  marginTop: 10,
  textAlign: "center",
  boxShadow: "0 4px 12px rgba(59, 130, 246, 0.2)",
};

const filterPanel: React.CSSProperties = {
  display: "flex",
  gap: 20,
  marginBottom: 32,
  flexWrap: "wrap",
};

const filterItem: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 6,
  minWidth: 200,
};

const filterLabel: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const filterSelect: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-color)",
  borderRadius: 10,
  padding: "10px 16px",
  color: "var(--text-main)",
  fontSize: 14,
  cursor: "pointer",
};

const jobsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
  gap: 24,
};

const jobCard: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-color)",
  borderRadius: 20,
  padding: "24px",
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  gap: 14,
  position: "relative",
  overflow: "hidden",
};

const jobCardHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const jobCardValue: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  color: "var(--color-primary)",
  fontSize: 16,
  fontWeight: 800,
};

const jobCardTitle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
  fontFamily: "var(--font-body)",
};

const jobCardDesc: React.CSSProperties = {
  color: "var(--text-muted)",
  fontSize: 13,
  lineHeight: 1.5,
  flex: 1,
};

const jobCardFooter: React.CSSProperties = {
  borderTop: "1px solid var(--border-color)",
  paddingTop: 12,
  display: "flex",
  gap: 16,
};

const jobFooterItem: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
};

const footerItemLabel: React.CSSProperties = {
  fontSize: 10,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  fontWeight: 700,
};

const footerItemVal: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  fontFamily: "monospace",
};

const emptyExploreState: React.CSSProperties = {
  gridColumn: "1 / -1",
  background: "var(--bg-card)",
  border: "1px dashed var(--border-color)",
  borderRadius: 20,
  padding: "60px 20px",
  textAlign: "center",
};

const detailContainer: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 24,
};

const detailHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const backBtn: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--color-primary)",
  fontSize: 15,
  fontWeight: 700,
  cursor: "pointer",
};

const detailContentGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "2fr 1fr",
  gap: 32,
  alignItems: "start",
};

const detailLeftCol: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 24,
};

const detailRightCol: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 24,
};

const detailTitle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 26,
  fontWeight: 800,
};

const detailMetaRow: React.CSSProperties = {
  display: "flex",
  gap: 24,
  background: "var(--bg-card)",
  border: "1px solid var(--border-color)",
  borderRadius: 12,
  padding: "16px",
};

const detailMetaItem: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
};

const metaItemLabel: React.CSSProperties = {
  fontSize: 11,
  color: "var(--text-muted)",
  textTransform: "uppercase",
  fontWeight: 700,
};

const metaItemVal: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  fontFamily: "monospace",
};

const timelineContainer: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-color)",
  borderRadius: 16,
  padding: "24px",
};

const subSectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
  textTransform: "uppercase",
  color: "var(--text-muted)",
  marginBottom: 12,
  letterSpacing: "0.5px",
};

const timeline: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  position: "relative",
  padding: "0 10px",
  marginTop: 10,
};

const timelineStep: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  flex: 1,
  position: "relative",
};

const stepBullet = (active: boolean): React.CSSProperties => ({
  width: 14,
  height: 14,
  borderRadius: "50%",
  background: active ? "var(--color-primary)" : "var(--border-color)",
  boxShadow: active ? "0 0 10px var(--color-primary)" : "none",
  zIndex: 2,
});

const stepLabelText = (active: boolean): React.CSSProperties => ({
  fontSize: 12,
  fontWeight: 700,
  color: active ? "var(--text-main)" : "var(--text-muted)",
});

const stepLine = (active: boolean): React.CSSProperties => ({
  position: "absolute",
  top: 6,
  left: "50%",
  width: "100%",
  height: 2,
  background: active ? "var(--color-primary)" : "var(--border-color)",
  zIndex: 1,
});

const descBox: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-color)",
  borderRadius: 16,
  padding: "24px",
};

const descText: React.CSSProperties = {
  fontSize: 14,
  color: "var(--text-main)",
  lineHeight: 1.6,
};

const deliverableBox: React.CSSProperties = {
  background: "rgba(168, 85, 247, 0.05)",
  border: "1px solid rgba(168, 85, 247, 0.2)",
  borderRadius: 16,
  padding: "24px",
};

const disputeBox: React.CSSProperties = {
  background: "rgba(239, 68, 68, 0.05)",
  border: "1px solid rgba(239, 68, 68, 0.2)",
  borderRadius: 16,
  padding: "24px",
};

const financialCard: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-color)",
  borderRadius: 16,
  padding: "24px",
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const financialLabel: React.CSSProperties = {
  fontSize: 14,
  color: "var(--text-muted)",
  fontWeight: 600,
};

const financialValue: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 32,
  fontWeight: 800,
  color: "var(--color-primary)",
};

const deadlineInfo: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  fontSize: 12,
  borderTop: "1px solid var(--border-color)",
  paddingTop: 12,
  marginTop: 8,
  color: "var(--text-muted)",
};

const actionsCard: React.CSSProperties = {
  background: "var(--bg-card)",
  border: "1px solid var(--border-color)",
  borderRadius: 16,
  padding: "24px",
};

const actionsCardTitle: React.CSSProperties = {
  fontSize: 15,
  fontWeight: 700,
  marginBottom: 16,
};

const actionButtonGroup: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const dangerActionBtn: React.CSSProperties = {
  background: "rgba(239, 68, 68, 0.1)",
  color: "var(--color-danger)",
  border: "1px solid rgba(239, 68, 68, 0.3)",
  borderRadius: 10,
  padding: "12px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  width: "100%",
  textAlign: "center",
};

const successActionBtn: React.CSSProperties = {
  background: "linear-gradient(135deg, var(--color-secondary), #059669)",
  color: "#fff",
  border: "none",
  borderRadius: 10,
  padding: "14px",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
  width: "100%",
  textAlign: "center",
  boxShadow: "0 4px 12px rgba(16, 185, 129, 0.2)",
};

const disputeSection: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
  borderTop: "1px solid var(--border-color)",
  paddingTop: 16,
  marginTop: 16,
};


