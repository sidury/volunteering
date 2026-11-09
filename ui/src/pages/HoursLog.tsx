import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { api, type Entry, type Status } from "../api";
import { capitalize, fmtHours, shortDate } from "../format";
import { Card, Confirm, Empty, ErrorNote, Loading, VerifyDialog, errorText, useApp, useLoad } from "../shared";

export function StatusBadge({ status }: { status: Status }) {
  return <span className={`badge ${status}`}>{capitalize(status)}</span>;
}

export function HoursLog() {
  const { refresh, notify, openEntry } = useApp();
  const entries = useLoad(api.entries);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [verifying, setVerifying] = useState<Entry | null>(null);
  const [removing, setRemoving] = useState<Entry | null>(null);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (entries.data ?? []).filter((e) => (!status || e.status === status) && (!q || `${e.organization} ${e.activity}`.toLowerCase().includes(q)));
  }, [entries.data, status, search]);

  const move = async (entry: Entry, next: Status, message: string) => {
    try {
      await api.setStatus(entry.id, next);
      refresh();
      notify(message);
    } catch (e) {
      notify(errorText(e));
    }
  };

  if (entries.error && !entries.data) return <ErrorNote message={entries.error} retry={entries.reload} />;
  if (!entries.data) return <Loading />;
  const shownHours = rows.reduce((sum, e) => sum + e.hours, 0);

  return (
    <div className="stack">
      <Card>
        <div className="filters two">
          <label>Search<input type="search" placeholder="Organization or activity" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          <label>Status
            <select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option><option value="draft">Draft</option><option value="submitted">Submitted</option><option value="verified">Verified</option>
            </select>
          </label>
        </div>
      </Card>
      {rows.length === 0 ? (
        <Card>
          <Empty title={entries.data.length ? "No entries match" : "No hours logged yet"}>
            {!entries.data.length && <button type="button" className="btn primary" onClick={() => openEntry()}><Plus size={16} /> Log your first hours</button>}
          </Empty>
        </Card>
      ) : (
        <>
          <ul className="entry-list" aria-label="Hours">
            {rows.map((e) => (
              <li key={e.id} className="entry">
                <div className="entry-main">
                  <div className="strong">{e.activity}</div>
                  <div className="muted small">{e.organization} · {shortDate(e.date)}</div>
                  {e.note && <div className="muted small">{e.note}</div>}
                  {e.verifiedBy && <div className="muted small">Verified by {e.verifiedBy}</div>}
                </div>
                <div className="entry-hours">{fmtHours(e.hours)}</div>
                <StatusBadge status={e.status} />
                <div className="entry-actions">
                  {e.status === "draft" && <button type="button" className="btn small" onClick={() => move(e, "submitted", "Submitted for sign-off")}>Submit</button>}
                  {e.status === "submitted" && <>
                    <button type="button" className="btn small" onClick={() => setVerifying(e)}>Mark verified</button>
                    <button type="button" className="btn small" onClick={() => move(e, "draft", "Moved back to draft")}>Back to draft</button>
                  </>}
                  {e.status === "verified" && <button type="button" className="btn small" onClick={() => move(e, "submitted", "Verification removed")}>Undo verified</button>}
                  {e.status !== "verified" && <button type="button" className="icon-btn" aria-label={`Edit ${e.activity}`} onClick={() => openEntry({ entry: e })}><Pencil size={16} /></button>}
                  <button type="button" className="icon-btn" aria-label={`Delete ${e.activity}`} onClick={() => setRemoving(e)}><Trash2 size={16} /></button>
                </div>
              </li>
            ))}
          </ul>
          <p className="muted small">Showing {rows.length} {rows.length === 1 ? "entry" : "entries"}, {fmtHours(shownHours)}.</p>
        </>
      )}
      {verifying && <VerifyDialog entry={verifying} onClose={() => setVerifying(null)} />}
      {removing && (
        <Confirm title="Delete this entry?" message={`${removing.activity} on ${shortDate(removing.date)} will be permanently deleted.`} action="Delete" onClose={() => setRemoving(null)}
          onConfirm={async () => { await api.removeEntry(removing.id); refresh(); notify("Entry deleted"); }} />
      )}
    </div>
  );
}
