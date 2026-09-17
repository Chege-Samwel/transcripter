'use client';

import Link from "next/link";
import { useEffect, useState } from "react";
import ConfirmDialog from "../../components/ConfirmDialog";
import Icon from "../../components/Icon";
import { requestJson } from "../../lib/http";
import { readLocalJobs, removeLocalJob } from "../../lib/local-jobs";
import type { Account, JobRecord } from "../../lib/types";

function formatWhen(value: string) {
  try {
    return new Date(value).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return value;
  }
}

export default function HistoryClient({ account }: { account: Account }) {
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [ready, setReady] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<JobRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const local = readLocalJobs().filter((job) => !job.ownerEmail || job.ownerEmail === account.email);
      try {
        const { data } = await requestJson<{ jobs?: JobRecord[]; persistence?: string }>("/api/jobs");
        const remote = Array.isArray(data.jobs) ? data.jobs : [];
        const merged = data.persistence === "database" && remote.length ? remote : mergeJobs(remote, local);
        if (!cancelled) setJobs(merged);
      } catch {
        if (!cancelled) setJobs(local);
      } finally {
        if (!cancelled) setReady(true);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [account.email]);

  async function confirmDelete() {
    if (!pendingDelete) return;
    setBusy(true);
    removeLocalJob(pendingDelete.id);
    await requestJson(`/api/jobs/${pendingDelete.id}`, { method: "DELETE" }, { retries: 1 });
    setJobs((current) => current.filter((job) => job.id !== pendingDelete.id));
    setPendingDelete(null);
    setBusy(false);
    setMessage("Transcript removed from history.");
  }

  if (!ready) return <main className="workspace-page"><div className="loading-state"><span className="spinner dark" />Loading history</div></main>;

  return (
    <main className="workspace-page">
      <header className="page-header">
        <div>
          <p className="overline">HISTORY</p>
          <h1>Previous transcripts.</h1>
          <p className="page-subtitle">Open a finished canvas, continue a paused run, or start a new transcript without losing the last one.</p>
        </div>
        <div className="header-actions">
          <Link className="primary-button" href="/workspace"><Icon name="plus" size={15} />New transcript</Link>
        </div>
      </header>
      {message && <div className="workspace-notice info"><Icon name="check" size={16} /><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss"><Icon name="x" size={15} /></button></div>}
      {jobs.length === 0 ? (
        <section className="empty-history card">
          <p className="overline">NOTHING HERE YET</p>
          <h2>Your edits will collect here.</h2>
          <p>Start a new transcript, run a demo, and it will appear in this list with its status, kind, and word count.</p>
          <Link className="primary-button" href="/workspace">Start a transcript</Link>
        </section>
      ) : (
        <section className="history-list">
          {jobs.map((job) => (
            <article className="history-row card" key={job.id}>
              <div>
                <div className="history-title-row">
                  <h2>{job.title}</h2>
                  <span className={`badge ${job.kind}`}>{job.kind}</span>
                  <span className={`badge ${job.status}`}>{job.status.replace("_", " ")}</span>
                </div>
                <p>{job.sourceFileName || "Untitled source"} · {job.wordCount || 0} words · {formatWhen(job.updatedAt)}</p>
              </div>
              <div className="history-actions">
                <Link className="secondary-button" href={`/workspace/${job.id}`}>{job.status === "complete" ? "Open canvas" : job.status === "failed" || job.status === "paused" ? "Continue" : "Open"}</Link>
                <button type="button" className="quiet-button" onClick={() => setPendingDelete(job)}>Remove</button>
              </div>
            </article>
          ))}
        </section>
      )}
      <ConfirmDialog
        open={Boolean(pendingDelete)}
        title="Remove this transcript?"
        body="The canvas, stages, and error log for this item will be deleted. This does not affect other transcripts."
        confirmLabel="Remove"
        busy={busy}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
      />
    </main>
  );
}

function mergeJobs(remote: JobRecord[], local: JobRecord[]) {
  const seen = new Set(remote.map((job) => job.id));
  return [...remote, ...local.filter((job) => !seen.has(job.id))].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}
