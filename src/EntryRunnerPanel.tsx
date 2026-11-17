import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Play,
  Pause,
  Square,
  Plus,
  Upload,
  Download,
  ShieldCheck,
  Mail,
  Globe,
  ExternalLink,
  Pencil,
  Trash2,
  RefreshCw,
  Search,
  X,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import type {
  EntryState,
  EntryResult,
  EntryCampaign,
  EntryCampaignInput,
  EntryJob,
  EntryProfile,
  EntryProxy,
  EntryImportPreview,
  EntryPrompt,
} from "./entry-types";
const initial: EntryState = {
  campaigns: [],
  jobs: [],
  proxies: [],
  logs: [],
  prompts: [],
  activeCampaignId: null,
  running: false,
  paused: false,
  stopping: false,
  secureStorage: false,
  credentialSupport: false,
  inboxEmail: null,
  runnerEmail: null,
};
type Modal =
  | { kind: "campaign"; campaign?: EntryCampaign }
  | { kind: "import"; preview: EntryImportPreview }
  | { kind: "proxy"; proxy?: EntryProxy }
  | { kind: "gmail" }
  | { kind: "profile"; job: EntryJob; profile: EntryProfile }
  | { kind: "start"; job?: EntryJob }
  | { kind: "retry"; job: EntryJob }
  | { kind: "delete-job"; job: EntryJob }
  | { kind: "delete-proxy"; proxy: EntryProxy };
export default function EntryRunnerPanel({
  onOpenInbox,
}: {
  onOpenInbox: () => void;
}) {
  const [state, setState] = useState(initial),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [selected, setSelected] = useState(""),
    [query, setQuery] = useState(""),
    [filter, setFilter] = useState("All statuses"),
    [page, setPage] = useState(1),
    [modal, setModal] = useState<Modal | null>(null);
  const running = useRef(false),
    revision = useRef(0);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (running.current) return;
      const rev = revision.current;
      try {
        const value = await window.toolbox!.entryState();
        if (alive && rev === revision.current) {
          setState(value);
          setSelected(
            (old) =>
              value.activeCampaignId || old || value.campaigns[0]?.id || "",
          );
          setLoading(false);
        }
      } catch {
        if (alive) {
          setError("Could not load Entry Runner. Reopen Tasks to retry.");
          setLoading(false);
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  async function action(fn: () => Promise<EntryResult>, message: string) {
    if (running.current) return false;
    running.current = true;
    revision.current++;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await fn();
      setState(result.state);
      if (!result.ok) {
        setError(result.error || "Entry operation failed.");
        return false;
      }
      const added = result.state.campaigns.find(
        (c) => !state.campaigns.some((old) => old.id === c.id),
      );
      if (added) setSelected(added.id);
      setNotice(message);
      setModal(null);
      return true;
    } catch {
      setError(
        "Could not complete the entry request. Check the desktop connection and retry.",
      );
      return false;
    } finally {
      running.current = false;
      setBusy(false);
    }
  }
  const locked = busy || state.running,
    campaign = state.campaigns.find((c) => c.id === selected),
    all = state.jobs.filter((j) => j.campaignId === selected),
    jobs = all.filter(
      (j) =>
        (filter === "All statuses" || j.status === filter) &&
        [j.label, j.profileName, j.maskedEmail]
          .join(" ")
          .toLowerCase()
          .includes(query.toLowerCase()),
    ),
    pages = Math.max(1, Math.ceil(jobs.length / 25)),
    current = Math.min(page, pages);
  const open = (value: Modal) => {
    setError("");
    setModal(value);
  };
  async function preview() {
    if (!campaign) return;
    setBusy(true);
    setError("");
    try {
      const preview = await window.toolbox!.previewEntryImport(campaign.id);
      if (preview.error) setError(preview.error);
      else if (!preview.cancelled) open({ kind: "import", preview });
    } catch {
      setError("Could not open the CSV import.");
    } finally {
      setBusy(false);
    }
  }
  async function profile(job: EntryJob) {
    setBusy(true);
    setError("");
    try {
      open({
        kind: "profile",
        job,
        profile: await window.toolbox!.entryProfile(job.id),
      });
    } catch {
      setError(
        "The encrypted profile cannot be opened on this Windows account.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return <div className="panel loading">Loading Entry Runner…</div>;
  return (
    <div className="entry-module">
      <div className="entry-intro">
        <div>
          <div className="eyebrow">FAMILY PROFILES · VISIBLE BROWSERS</div>
          <h2>
            Entry Runner<span className="gold">.</span>
          </h2>
          <p>
            Run authorized Third Eye / EQL entry steps, handle verification
            codes, and review each final submission.
          </p>
        </div>
        <div className="actions">
          <button disabled={locked} onClick={() => open({ kind: "gmail" })}>
            <Mail size={15} />
            Code inbox
          </button>
          <button
            className="primary"
            disabled={locked}
            onClick={() => open({ kind: "campaign" })}
          >
            <Plus size={15} />
            New product queue
          </button>
        </div>
      </div>
      {error && (
        <div className="alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="notice" role="status">
          {notice}
          <button
            aria-label="Dismiss entry notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
      {!state.secureStorage && (
        <div className="alert" role="alert">
          <ShieldCheck size={16} />
          Profile import and runs require Windows encrypted storage. No
          plaintext fallback is used. You can create queue settings and download
          the CSV template here.
        </div>
      )}
      <section className="panel entry-controls">
        <div className="entry-queue-selector">
          <label>
            Product queue
            <select
              aria-label="Entry product queue"
              value={selected}
              disabled={locked}
              onChange={(e) => {
                setSelected(e.target.value);
                setPage(1);
              }}
            >
              <option value="" disabled>
                Choose or create a product queue
              </option>
              {state.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {campaign && (
            <button
              className="text-button"
              disabled={locked}
              onClick={() => open({ kind: "campaign", campaign })}
            >
              <Pencil size={14} />
              Queue settings
            </button>
          )}
        </div>
        {campaign && (
          <>
            <div className="entry-product-url">{campaign.url}</div>
            <div className="entry-config-summary">
              <span>
                {campaign.concurrency} browser window
                {campaign.concurrency === 1 ? "" : "s"} maximum
              </span>
              <span>
                {campaign.browser === "msedge"
                  ? "Microsoft Edge"
                  : campaign.browser === "chrome"
                    ? "Google Chrome"
                    : "Playwright Chromium"}
              </span>
              <span>
                {campaign.gmailSource === "off"
                  ? "Manual codes"
                  : campaign.gmailSource === "inbox"
                    ? "Use connected Inbox Gmail"
                    : "Use runner Gmail"}
              </span>
              <span>
                {campaign.onePerHousehold
                  ? "One profile per household"
                  : "One profile per person"}
              </span>
            </div>
          </>
        )}
        <div className="entry-run-buttons">
          <button
            disabled={locked || !campaign || !state.secureStorage}
            onClick={() => void preview()}
          >
            <Upload size={14} />
            Import profiles CSV
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void window
                .toolbox!.saveEntryTemplate()
                .then((saved) => saved && setNotice("CSV template saved."))
                .catch(() => setError("Could not save the template."))
            }
          >
            <Download size={14} />
            CSV template
          </button>
          <div className="entry-run-primary">
            {!state.running ? (
              <button
                className="primary"
                disabled={
                  locked ||
                  !campaign ||
                  !state.secureStorage ||
                  !all.some((j) => j.status === "Pending")
                }
                onClick={() => open({ kind: "start" })}
              >
                <Play size={15} />
                Start queue
              </button>
            ) : (
              <>
                <button
                  disabled={busy || state.stopping}
                  onClick={() =>
                    void action(
                      () =>
                        state.paused
                          ? window.toolbox!.resumeEntries()
                          : window.toolbox!.pauseEntries(),
                      state.paused
                        ? "Queue resumed with the same profiles and proxies."
                        : "Queue paused. Browser windows remain open.",
                    )
                  }
                >
                  {state.paused ? <Play size={15} /> : <Pause size={15} />}{" "}
                  {state.paused ? "Resume" : "Pause"}
                </button>
                <button
                  className="danger-button"
                  disabled={busy || state.stopping}
                  onClick={() =>
                    void action(
                      () => window.toolbox!.stopEntries(),
                      "Queue stopped. Interrupted attempts are retained for review.",
                    )
                  }
                >
                  <Square size={14} />
                  {state.stopping ? "Stopping…" : "Stop"}
                </button>
              </>
            )}
          </div>
        </div>
        <p className="entry-help">
          Only consenting, eligible people with their actual details should be
          queued. Proxies remain fixed per profile; blocked connections are not
          cycled. Each final entry requires your review. A clicked button is not
          counted as a successful entry.
        </p>
        {campaign && campaign.cooldownUntil > Date.now() && (
          <div className="alert" role="alert">
            Site cooldown until{" "}
            {new Date(campaign.cooldownUntil).toLocaleString()}. The queue stays
            paused; do not switch proxies to retry.
          </div>
        )}
      </section>
      <div className="entry-summary">
        {[
          {
            label: "Pending",
            value: all.filter((j) => j.status === "Pending").length,
          },
          {
            label: "Active / waiting",
            value: all.filter((j) =>
              ["Running", "Waiting", "Ready"].includes(j.status),
            ).length,
          },
          {
            label: "Site-confirmed",
            value: all.filter((j) => j.status === "Completed").length,
          },
          {
            label: "Needs attention",
            value: all.filter((j) =>
              ["Failed", "Needs review"].includes(j.status),
            ).length,
          },
        ].map((s) => (
          <article className="panel" key={s.label} aria-label={s.label}>
            <span>{s.label}</span>
            <strong>{s.value}</strong>
          </article>
        ))}
      </div>
      {!!state.prompts.length && (
        <section
          className="entry-prompts"
          aria-label="Entry actions waiting for you"
        >
          {state.prompts.map((prompt) => (
            <PromptCard
              key={prompt.id}
              prompt={prompt}
              job={state.jobs.find((j) => j.id === prompt.jobId)!}
              busy={busy || state.paused || state.stopping}
              onFocus={() =>
                void window
                  .toolbox!.focusEntryBrowser(prompt.jobId)
                  .catch(() => setError("Could not bring the browser forward."))
              }
              onAnswer={(code, submit, confirmed, skip) =>
                action(
                  () =>
                    window.toolbox!.answerEntryPrompt({
                      promptId: prompt.id,
                      action: skip ? "skip" : submit ? "submit" : "continue",
                      ...(code ? { code } : {}),
                      ...(confirmed ? { confirmed: true } : {}),
                    }),
                  submit
                    ? "Submission requested. Waiting for the site's confirmation."
                    : "Your requested step was continued.",
                )
              }
            />
          ))}
        </section>
      )}
      <section className="panel entry-jobs">
        <div className="panel-heading">
          <div>
            <h2>
              Family profiles <span className="count">{all.length}</span>
            </h2>
            <p>
              Encrypted at rest. Completion and uncertain attempts are retained
              per product.
            </p>
          </div>
          <span className="local-pill">
            <ShieldCheck size={13} />
            Local protected data
          </span>
        </div>
        <div className="table-toolbar">
          <label className="search">
            <Search size={15} />
            <input
              aria-label="Search entry profiles"
              placeholder="Search label, person, or masked email…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <select
            aria-label="Entry status filter"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setPage(1);
            }}
          >
            {[
              "All statuses",
              "Pending",
              "Running",
              "Waiting",
              "Ready",
              "Completed",
              "Needs review",
              "Failed",
              "Skipped",
            ].map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>PROFILE</th>
                <th>FIXED CONNECTION</th>
                <th>STATUS / STEP</th>
                <th className="right">ACTIONS</th>
              </tr>
            </thead>
            <tbody>
              {jobs.slice((current - 1) * 25, current * 25).map((job) => (
                <tr key={job.id}>
                  <td>
                    <strong>{job.label}</strong>
                    <small>
                      {job.profileName} · {job.maskedEmail}
                    </small>
                  </td>
                  <td>
                    <span>
                      {state.proxies.find((p) => p.id === job.proxyId)?.name ||
                        "Direct connection"}
                    </span>
                    <small>
                      {job.proxyId
                        ? state.proxies.find((p) => p.id === job.proxyId)
                            ?.server
                        : "No proxy configured"}
                    </small>
                  </td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (job.status === "Completed"
                          ? "delivered"
                          : "processing")
                      }
                    >
                      {job.status}
                    </span>
                    <small>{job.stage}</small>
                    {job.note && (
                      <small className="entry-job-note">{job.note}</small>
                    )}
                  </td>
                  <td>
                    <div className="entry-job-actions">
                      <button
                        className="text-button"
                        disabled={busy || !job.readable}
                        aria-label={`View profile ${job.number}`}
                        onClick={() => void profile(job)}
                      >
                        <Pencil size={14} />
                        {job.attempts ? "View" : "Edit"}
                      </button>
                      {!state.running &&
                        ["Needs review", "Completed", "Failed"].includes(
                          job.status,
                        ) && (
                          <button
                            className="text-button"
                            disabled={busy || !job.readable}
                            aria-label={`Review entry ${job.number}`}
                            onClick={() => open({ kind: "start", job })}
                          >
                            <ExternalLink size={14} />
                            Review
                          </button>
                        )}
                      {!state.running &&
                        ["Failed", "Skipped", "Needs review"].includes(
                          job.status,
                        ) &&
                        !job.submissionStartedAt && (
                          <button
                            className="text-button"
                            disabled={busy}
                            aria-label={`Retry entry ${job.number}`}
                            onClick={() => open({ kind: "retry", job })}
                          >
                            <RefreshCw size={14} />
                            Retry
                          </button>
                        )}
                      {!job.attempts && job.status === "Pending" && (
                        <button
                          className="text-button"
                          disabled={locked}
                          aria-label={`Delete entry profile ${job.number}`}
                          onClick={() => open({ kind: "delete-job", job })}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!jobs.length && (
          <div className="empty entry-empty">
            <Play size={28} />
            <h3>
              {all.length
                ? "No profiles match this filter"
                : "Import your family profiles to begin"}
            </h3>
            <p>
              Use the CSV template, save any proxies, then import into the
              selected product queue. Preview and duplicates are checked before
              saving.
            </p>
          </div>
        )}
        <div className="table-bottom">
          <span>
            {jobs.length} profiles · Final submissions are individually reviewed
          </span>
          <div className="expense-pagination">
            <button
              disabled={current === 1}
              onClick={() => setPage(current - 1)}
            >
              Previous
            </button>
            <span>
              {current} / {pages}
            </span>
            <button
              disabled={current >= pages}
              onClick={() => setPage(current + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      <section className="panel entry-proxies">
        <div className="panel-heading">
          <div>
            <h2>
              Proxy connections{" "}
              <span className="count">{state.proxies.length}</span>
            </h2>
            <p>
              Assign by saved name in CSV or edit an unused profile.
              Authentication stays in Windows Credential Manager.
            </p>
          </div>
          <button
            disabled={locked || !state.credentialSupport}
            onClick={() => open({ kind: "proxy" })}
          >
            <Plus size={14} />
            Add proxy
          </button>
        </div>
        {!state.proxies.length ? (
          <p className="entry-proxy-empty">
            No proxies saved. Profiles use your direct connection unless you
            assign one.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>NAME / ENDPOINT</th>
                  <th>AUTHENTICATION</th>
                  <th>HEALTH</th>
                  <th className="right">ACTIONS</th>
                </tr>
              </thead>
              <tbody>
                {state.proxies.map((proxy) => (
                  <tr key={proxy.id}>
                    <td>
                      <strong>{proxy.name}</strong>
                      <small>{proxy.server}</small>
                    </td>
                    <td>
                      {proxy.authenticated
                        ? "Credential Manager"
                        : "No authentication"}
                    </td>
                    <td>
                      <span
                        className={
                          "badge " +
                          (proxy.health === "Reachable"
                            ? "delivered"
                            : "processing")
                        }
                      >
                        {proxy.health}
                      </span>
                    </td>
                    <td>
                      <div className="entry-job-actions">
                        <button
                          className="text-button"
                          disabled={locked}
                          onClick={() =>
                            void action(
                              () => window.toolbox!.testEntryProxy(proxy.id),
                              "Proxy test completed against the store; no entry was submitted.",
                            )
                          }
                        >
                          Test
                        </button>
                        <button
                          className="text-button"
                          disabled={locked}
                          aria-label={`Edit proxy ${proxy.name}`}
                          onClick={() => open({ kind: "proxy", proxy })}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="text-button"
                          disabled={locked}
                          aria-label={`Delete proxy ${proxy.name}`}
                          onClick={() => open({ kind: "delete-proxy", proxy })}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="panel entry-logs">
        <div className="panel-heading">
          <div>
            <h2>Run log</h2>
            <p>
              Passwords, verification codes and shipping addresses are excluded.
            </p>
          </div>
        </div>
        <div className="entry-log-lines" role="log" aria-label="Entry run log">
          {state.logs
            .filter((l) => l.campaignId === selected)
            .slice(-100)
            .map((l) => (
              <div key={l.id}>
                <time>{new Date(l.at).toLocaleTimeString()}</time>
                <span>
                  {l.jobId
                    ? `Profile ${state.jobs.find((j) => j.id === l.jobId)?.number || ""}`
                    : "Queue"}
                </span>
                <p>{l.message}</p>
              </div>
            ))}
          {!state.logs.some((l) => l.campaignId === selected) && (
            <p>No run events yet.</p>
          )}
        </div>
      </section>
      {modal && (
        <EntryDialog
          title={
            modal.kind === "campaign"
              ? modal.campaign
                ? "Product queue settings"
                : "New product queue"
              : modal.kind === "proxy"
                ? modal.proxy
                  ? "Update proxy credential"
                  : "Add proxy connection"
                : modal.kind === "gmail"
                  ? "Verification code inbox"
                  : modal.kind === "import"
                    ? "Review CSV import"
                    : modal.kind === "profile"
                      ? modal.job.attempts
                        ? "View saved profile"
                        : "Edit unused profile"
                      : modal.kind === "start"
                        ? modal.job
                          ? "Review an existing entry"
                          : "Start authorized entries"
                        : modal.kind === "retry"
                          ? "Review before retry"
                          : modal.kind === "delete-job"
                            ? "Delete unused profile"
                            : "Delete proxy"
          }
          busy={busy}
          onClose={() => setModal(null)}
        >
          {error && (
            <div className="alert" role="alert">
              {error}
            </div>
          )}
          {modal.kind === "campaign" ? (
            <CampaignForm
              campaign={modal.campaign}
              busy={busy}
              onSave={(config) =>
                modal.campaign
                  ? action(
                      () =>
                        window.toolbox!.editEntryCampaign({
                          id: modal.campaign!.id,
                          config,
                        }),
                      "Queue settings saved.",
                    )
                  : action(
                      () => window.toolbox!.createEntryCampaign(config),
                      "Product queue created. Add proxies and import your profiles.",
                    )
              }
            />
          ) : modal.kind === "proxy" ? (
            <ProxyForm
              proxy={modal.proxy}
              fixed={Boolean(
                modal.proxy &&
                state.jobs.some(
                  (j) => j.proxyId === modal.proxy!.id && j.attempts,
                ),
              )}
              busy={busy}
              onSave={(input) =>
                action(
                  () => window.toolbox!.saveEntryProxy(input),
                  "Proxy saved securely. Assign it to the intended unused profile.",
                )
              }
            />
          ) : modal.kind === "gmail" ? (
            <GmailForm
              state={state}
              busy={busy}
              onInbox={onOpenInbox}
              onSave={(input) =>
                action(
                  () => window.toolbox!.connectEntryGmail(input),
                  "Runner Gmail verified and saved in Windows Credential Manager.",
                )
              }
              onDisconnect={() =>
                action(
                  () => window.toolbox!.disconnectEntryGmail(),
                  "Runner Gmail credential removed. Existing Inbox Gmail settings were not changed.",
                )
              }
            />
          ) : modal.kind === "profile" ? (
            <ProfileForm
              profile={modal.profile}
              job={modal.job}
              proxies={state.proxies}
              busy={busy || state.running}
              onSave={(profile, proxyId) =>
                action(
                  () =>
                    window.toolbox!.editEntryProfile({
                      id: modal.job.id,
                      profile,
                      proxyId,
                    }),
                  "Unused profile updated.",
                )
              }
            />
          ) : modal.kind === "import" ? (
            <>
              <p className="collection-form-note">
                {modal.preview.total} rows · {modal.preview.duplicates}{" "}
                duplicate profiles will be skipped. Preview shows the first 10
                rows. Saving encrypts personal details locally.
              </p>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>ROW</th>
                      <th>PROFILE</th>
                      <th>EMAIL</th>
                      <th>PROXY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {modal.preview.rows?.map((r) => (
                      <tr key={r.number}>
                        <td>{r.number}</td>
                        <td>{r.label}</td>
                        <td>{r.maskedEmail}</td>
                        <td>{r.proxyName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="modal-actions">
                <button disabled={busy} onClick={() => setModal(null)}>
                  Cancel
                </button>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      () =>
                        window.toolbox!.commitEntryImport(modal.preview.token!),
                      "Profile import saved. Duplicates were skipped.",
                    )
                  }
                >
                  Save encrypted profiles
                </button>
              </div>
            </>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (modal.kind === "start" && campaign)
                  void action(
                    () =>
                      window.toolbox!.startEntries({
                        campaignId: campaign.id,
                        confirmed: true,
                        ...(modal.job ? { reviewJobId: modal.job.id } : {}),
                      }),
                    modal.job
                      ? "Review browser opened. No new entry will be submitted."
                      : "Queue started. Watch for verification and final review prompts.",
                  );
                else if (modal.kind === "retry")
                  void action(
                    () =>
                      window.toolbox!.retryEntryJob({
                        id: modal.job.id,
                        reviewed: true,
                      }),
                    "Attempt returned to Pending with the original profile and proxy.",
                  );
                else if (modal.kind === "delete-job")
                  void action(
                    () => window.toolbox!.deleteEntryJob(modal.job.id),
                    "Unused profile removed.",
                  );
                else if (modal.kind === "delete-proxy")
                  void action(
                    () => window.toolbox!.deleteEntryProxy(modal.proxy.id),
                    "Unused proxy and its credential removed.",
                  );
              }}
            >
              <p className="collection-form-note">
                {modal.kind === "start"
                  ? modal.job
                    ? `Open ${modal.job.profileName}'s existing entry for this exact product. This review cannot submit another entry.`
                    : `Open ${all.filter((j) => j.status === "Pending").length} pending profiles for ${campaign?.name}. At most ${campaign?.concurrency} visible browser windows run at once. Each final submission still waits for your review.`
                  : modal.kind === "retry"
                    ? "Confirm you checked the site and this profile has no submitted entry. Only pre-submission attempts can return to Pending. The saved proxy will not change."
                    : modal.kind === "delete-job"
                      ? "Delete this never-started profile from the queue? Started and completed history cannot be reset this way."
                      : "Delete this proxy credential? A proxy assigned to saved profiles cannot be deleted."}
              </p>
              <label className="entry-check">
                <input
                  type="checkbox"
                  required
                  aria-label="Confirm entry operation"
                />
                {modal.kind === "start" && !modal.job
                  ? "These are real consenting people, their details are accurate, and I will follow the retailer's entry and eligibility rules."
                  : "I reviewed the exact profile/product or connection and confirm this action."}
              </label>
              <div className="modal-actions">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button
                  className={
                    modal.kind.startsWith("delete")
                      ? "danger-button"
                      : "primary"
                  }
                  disabled={busy}
                >
                  {modal.kind === "start"
                    ? modal.job
                      ? "Open existing-entry review"
                      : "Start queue"
                    : modal.kind === "retry"
                      ? "Return to Pending"
                      : "Delete"}
                </button>
              </div>
            </form>
          )}
        </EntryDialog>
      )}
    </div>
  );
}
function EntryDialog({
  title,
  busy,
  onClose,
  children,
}: {
  title: string;
  busy: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current!;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="expense-dialog entry-dialog"
      aria-labelledby="entry-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="expense-dialog-heading">
        <h2 id="entry-dialog-title">{title}</h2>
        <button
          disabled={busy}
          aria-label="Close entry dialog"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function CampaignForm({
  campaign,
  busy,
  onSave,
}: {
  campaign?: EntryCampaign;
  busy: boolean;
  onSave: (value: EntryCampaignInput) => Promise<boolean>;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        void onSave({
          name: String(data.get("name")),
          url: campaign?.url || String(data.get("url")),
          concurrency: Number(data.get("concurrency")) as 1 | 2 | 3 | 4,
          browser: String(data.get("browser")) as EntryCampaignInput["browser"],
          gmailSource: String(
            data.get("gmailSource"),
          ) as EntryCampaignInput["gmailSource"],
          senderDomains: String(data.get("domains"))
            .split(/[\s,;]+/)
            .map((s) => s.trim().toLowerCase())
            .filter(Boolean),
          onePerHousehold:
            campaign?.onePerHousehold ?? data.get("household") === "on",
        });
      }}
    >
      <fieldset disabled={busy}>
        <label>
          Queue name
          <input
            name="name"
            required
            maxLength={120}
            defaultValue={campaign?.name || ""}
          />
        </label>
        <label>
          Third Eye product URL
          <input
            name="url"
            type="url"
            required
            maxLength={2048}
            readOnly={Boolean(campaign)}
            defaultValue={campaign?.url || ""}
            placeholder="https://shop.thirdeyecomics.com/products/…"
          />
        </label>
        <div className="form-grid">
          <label>
            Browser
            <select
              aria-label="Entry browser"
              name="browser"
              defaultValue={campaign?.browser || "msedge"}
            >
              <option value="msedge">Installed Microsoft Edge</option>
              <option value="chrome">Installed Google Chrome</option>
              <option value="chromium">Playwright Chromium</option>
            </select>
          </label>
          <label>
            Maximum windows
            <select
              aria-label="Entry concurrency"
              name="concurrency"
              defaultValue={campaign?.concurrency || 1}
            >
              {[1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n} visible window{n === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Verification code source
          <select
            aria-label="Entry code source"
            name="gmailSource"
            defaultValue={campaign?.gmailSource || "off"}
          >
            <option value="off">Manual — enter codes yourself</option>
            <option value="inbox">Connected Gmail from Inbox</option>
            <option value="runner">Separate runner Gmail</option>
          </select>
        </label>
        <label>
          Trusted code sender domains
          <input
            name="domains"
            required
            maxLength={500}
            defaultValue={
              campaign?.senderDomains.join(", ") ||
              "eql.com, thirdeyecomics.com"
            }
          />
        </label>
        <p className="collection-form-note">
          Code lookup only accepts fresh login/verification codes for the exact
          recipient from these domains. Forwarding must preserve the intended
          recipient headers. Password resets and unrelated numeric emails are
          ignored.
        </p>
        <label className="entry-check">
          <input
            name="household"
            type="checkbox"
            disabled={Boolean(campaign)}
            defaultChecked={campaign?.onePerHousehold || false}
          />
          This product permits only one entry per household (also skip duplicate
          addresses).
        </label>
        <p className="entry-help">
          The product and entry-rule choice are fixed after creating the queue.
          Use the site's actual rules. Microsoft Edge/Chrome must be installed;
          for Chromium, run <code>npm run browser:install</code> once.
        </p>
        <div className="modal-actions">
          <button className="primary">
            {campaign ? "Save queue settings" : "Create product queue"}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
function ProxyForm({
  proxy,
  fixed,
  busy,
  onSave,
}: {
  proxy?: EntryProxy;
  fixed: boolean;
  busy: boolean;
  onSave: (
    value: Parameters<NonNullable<Window["toolbox"]>["saveEntryProxy"]>[0],
  ) => Promise<boolean>;
}) {
  const [auth, setAuth] = useState(proxy?.authenticated || false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget),
          value = {
            ...(proxy ? { id: proxy.id } : {}),
            name: String(data.get("name")),
            server: String(data.get("server")),
            username: auth ? username : "",
            password: auth ? password : "",
          };
        setUsername("");
        setPassword("");
        void onSave(value);
      }}
    >
      <fieldset disabled={busy}>
        <label>
          Proxy name
          <input
            name="name"
            required
            maxLength={80}
            defaultValue={proxy?.name || ""}
            placeholder="Family connection 1"
          />
        </label>
        <label>
          Proxy server
          <input
            name="server"
            required
            maxLength={250}
            readOnly={fixed}
            defaultValue={proxy?.server || ""}
            placeholder="http://proxy.example.com:8080"
          />
        </label>
        <p className="collection-form-note">
          Use HTTP/HTTPS, or SOCKS5 without authentication. Each profile keeps
          its assigned endpoint throughout retries. No rotating pool or
          direct-connection fallback is used.
        </p>
        <label className="entry-check">
          <input
            type="checkbox"
            checked={auth}
            onChange={(e) => setAuth(e.target.checked)}
          />
          This proxy requires authentication
        </label>
        {auth && (
          <div className="form-grid">
            <label>
              Proxy username
              <input
                aria-label="Proxy username"
                type="password"
                autoComplete="off"
                required
                maxLength={200}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </label>
            <label>
              Proxy password
              <input
                aria-label="Proxy password"
                type="password"
                autoComplete="off"
                required
                maxLength={300}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
          </div>
        )}
        <p className="entry-help">
          <ShieldCheck size={13} />
          Authentication is stored in Windows Credential Manager. Re-enter both
          fields when changing a saved authenticated credential; saved passwords
          are never returned to this form.
        </p>
        <div className="modal-actions">
          <button className="primary">Save proxy securely</button>
        </div>
      </fieldset>
    </form>
  );
}
function GmailForm({
  state,
  busy,
  onInbox,
  onSave,
  onDisconnect,
}: {
  state: EntryState;
  busy: boolean;
  onInbox: () => void;
  onSave: (input: { email: string; appPassword: string }) => Promise<boolean>;
  onDisconnect: () => Promise<boolean>;
}) {
  const [password, setPassword] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const email = String(new FormData(e.currentTarget).get("email")),
          appPassword = password;
        setPassword("");
        void onSave({ email, appPassword });
      }}
    >
      <p className="collection-form-note">
        Use a Gmail inbox that receives the authorized family members' codes.
        Select its source in each queue's settings. Lookups use read-only IMAP,
        match recipients and sender domains, and never save or log codes.
      </p>
      <p className="entry-help">
        Inbox connection: {state.inboxEmail || "Not connected"}
        <br />
        Runner connection: {state.runnerEmail || "Not connected"}
      </p>
      <button
        type="button"
        className="text-button"
        disabled={state.running}
        onClick={onInbox}
      >
        Manage existing Inbox Gmail <ExternalLink size={13} />
      </button>
      <fieldset disabled={busy || state.running || !state.credentialSupport}>
        <label>
          Separate runner Gmail address
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            defaultValue={state.runnerEmail || ""}
          />
        </label>
        <label>
          Google app password
          <input
            aria-label="Runner Gmail app password"
            type="password"
            autoComplete="off"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="16-letter Google app password"
          />
        </label>
        <p className="collection-form-note">
          This optional connection is separate from the shipment Inbox. A normal
          Gmail password will not work. Google app passwords require account
          support and two-step verification.
        </p>
        <div className="modal-actions">
          {state.runnerEmail && (
            <button
              type="button"
              className="danger-button"
              onClick={() => void onDisconnect()}
            >
              Disconnect runner Gmail
            </button>
          )}
          <button className="primary">Verify and save Gmail</button>
        </div>
      </fieldset>
    </form>
  );
}
function ProfileForm({
  profile,
  job,
  proxies,
  busy,
  onSave,
}: {
  profile: EntryProfile;
  job: EntryJob;
  proxies: EntryProxy[];
  busy: boolean;
  onSave: (profile: EntryProfile, proxyId: string | null) => Promise<boolean>;
}) {
  const readonly = Boolean(job.attempts);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const profile = Object.fromEntries(
          [
            "label",
            "email",
            "first_name",
            "last_name",
            "address",
            "city",
            "state",
            "zip",
          ].map((k) => [k, String(data.get(k) || "")]),
        ) as EntryProfile;
        void onSave(profile, String(data.get("proxyId") || "") || null);
      }}
    >
      <fieldset disabled={busy || readonly}>
        <label>
          Profile label
          <input name="label" maxLength={100} defaultValue={profile.label} />
        </label>
        <label>
          Email
          <input
            name="email"
            type="email"
            required
            maxLength={254}
            defaultValue={profile.email}
          />
        </label>
        <div className="form-grid">
          {[
            ["first_name", "First name"],
            ["last_name", "Last name"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                required
                maxLength={120}
                defaultValue={profile[key as keyof EntryProfile]}
              />
            </label>
          ))}
        </div>
        <label>
          Shipping street address
          <input
            name="address"
            required
            maxLength={120}
            defaultValue={profile.address}
          />
        </label>
        <div className="form-grid">
          {[
            ["city", "City"],
            ["state", "State"],
            ["zip", "ZIP code"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                name={key}
                required
                maxLength={key === "zip" ? 10 : 120}
                defaultValue={profile[key as keyof EntryProfile]}
              />
            </label>
          ))}
        </div>
        <label>
          Fixed proxy
          <select
            aria-label="Profile fixed proxy"
            name="proxyId"
            defaultValue={job.proxyId || ""}
          >
            <option value="">Direct connection</option>
            {proxies.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.server}
              </option>
            ))}
          </select>
        </label>
        {!readonly && (
          <div className="modal-actions">
            <button className="primary">Save profile</button>
          </div>
        )}
      </fieldset>
      {readonly && (
        <p className="collection-form-note">
          Started profiles are retained as recorded. Review corrections on the
          site. This entry cannot be duplicated by changing its identity or
          proxy assignment.
        </p>
      )}
    </form>
  );
}
function PromptCard({
  prompt,
  job,
  busy,
  onFocus,
  onAnswer,
}: {
  prompt: EntryPrompt;
  job: EntryJob;
  busy: boolean;
  onFocus: () => void;
  onAnswer: (
    code: string,
    submit: boolean,
    confirmed: boolean,
    skip: boolean,
  ) => Promise<boolean>;
}) {
  const [code, setCode] = useState("");
  return (
    <article
      className="panel entry-prompt"
      aria-label={`Entry action for profile ${job.number}`}
    >
      <div className="entry-prompt-title">
        <AlertTriangle size={18} />
        <div>
          <h3>
            {job.label} · {job.profileName}
          </h3>
          <small>
            {job.maskedEmail} · Profile {job.number}
          </small>
        </div>
        <button className="text-button" disabled={busy} onClick={onFocus}>
          Show browser <ExternalLink size={13} />
        </button>
      </div>
      <p>{prompt.message}</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget),
            value = code;
          setCode("");
          void onAnswer(
            value,
            prompt.kind === "review",
            data.get("confirmed") === "on",
            false,
          );
        }}
      >
        {prompt.kind === "code" && (
          <label>
            Verification code (optional if completed in browser)
            <input
              aria-label={`Verification code for profile ${job.number}`}
              type="password"
              autoComplete="off"
              inputMode="numeric"
              pattern="[0-9]{4,8}"
              minLength={4}
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </label>
        )}
        {["review", "verify"].includes(prompt.kind) && (
          <label className="entry-check">
            <input
              name="confirmed"
              type="checkbox"
              required
              aria-label={`Confirm profile ${job.number} review`}
            />
            I checked the correct person/product and the site's details, rules,
            and any payment obligation.
          </label>
        )}
        <div className="modal-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setCode("");
              void onAnswer("", false, false, true);
            }}
          >
            Skip / keep for review
          </button>
          <button className="primary" disabled={busy}>
            {prompt.kind === "review"
              ? "Submit this entry"
              : prompt.kind === "verify"
                ? "Verify site confirmation"
                : "Continue"}
          </button>
        </div>
      </form>
    </article>
  );
}
