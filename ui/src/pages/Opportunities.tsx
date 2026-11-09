import { CalendarDays, MapPin, Pencil, Plus, Trash2, Upload, Users } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { api, CAUSES, localToday, type ImportResult, type Opportunity, type OpportunityInput } from "../api";
import { fmtHours, shortDate, timeRange } from "../format";
import { Card, Confirm, Dialog, Empty, ErrorNote, Loading, errorText, useApp, useLoad } from "../shared";

const NO_FILTERS = { search: "", cause: "", source: "", from: "", to: "", miles: "", age: "" };

function shiftHours(o: Opportunity): number | undefined {
  if (!o.start || !o.end) return undefined;
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
  return Math.round(((mins(o.end) - mins(o.start)) / 60) * 4) / 4;
}

function ageLabel(o: Opportunity): string {
  if (o.minAge !== null && o.maxAge !== null) return `Ages ${o.minAge}–${o.maxAge}`;
  if (o.minAge !== null) return `Ages ${o.minAge}+`;
  return o.maxAge !== null ? `Up to age ${o.maxAge}` : "";
}

export function Opportunities() {
  const { refresh, notify, openEntry } = useApp();
  const list = useLoad(api.opportunities);
  const [f, setF] = useState(NO_FILTERS);
  const [showPast, setShowPast] = useState(false);
  const [goingOnly, setGoingOnly] = useState(false);
  const [editing, setEditing] = useState<Opportunity | "new" | null>(null);
  const [importing, setImporting] = useState(false);
  const [removing, setRemoving] = useState<Opportunity | null>(null);
  const today = localToday();

  const rows = useMemo(() => {
    const q = f.search.trim().toLowerCase();
    const miles = f.miles === "" ? null : Number(f.miles);
    const age = f.age === "" ? null : Number(f.age);
    return (list.data ?? []).filter((o) =>
      (showPast || o.date >= today) &&
      (!goingOnly || o.going) &&
      (!q || `${o.title} ${o.organization} ${o.location} ${o.details}`.toLowerCase().includes(q)) &&
      (!f.cause || o.cause === f.cause) &&
      (!f.source || o.source === f.source) &&
      (!f.from || o.date >= f.from) &&
      (!f.to || o.date <= f.to) &&
      (miles === null || (o.distanceMiles !== null && o.distanceMiles <= miles)) &&
      (age === null || ((o.minAge === null || age >= o.minAge) && (o.maxAge === null || age <= o.maxAge))),
    );
  }, [list.data, f, showPast, goingOnly, today]);

  const set = (key: keyof typeof NO_FILTERS, value: string) => setF((v) => ({ ...v, [key]: value }));
  const toggle = async (o: Opportunity) => {
    try {
      await api.setGoing(o.id, !o.going);
      refresh();
      notify(o.going ? "Removed from your shifts" : "Added to your shifts");
    } catch (e) {
      notify(errorText(e));
    }
  };

  if (list.error && !list.data) return <ErrorNote message={list.error} retry={list.reload} />;
  if (!list.data) return <Loading />;

  return (
    <div className="stack">
      <div className="button-row">
        <button type="button" className="btn" onClick={() => setEditing("new")}><Plus size={16} /> Add opportunity</button>
        <button type="button" className="btn" onClick={() => setImporting(true)}><Upload size={16} /> Import school list</button>
      </div>
      <Card>
        <div className="filters">
          <label className="wide">Search<input type="search" placeholder="Role, organization or place" value={f.search} onChange={(e) => set("search", e.target.value)} /></label>
          <label>Cause<select value={f.cause} onChange={(e) => set("cause", e.target.value)}><option value="">All causes</option>{CAUSES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Source<select value={f.source} onChange={(e) => set("source", e.target.value)}><option value="">All</option><option value="school">School list</option><option value="student">Added by me</option></select></label>
          <label>From<input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} /></label>
          <label>To<input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} /></label>
          <label>Within miles<input type="number" min={0} value={f.miles} onChange={(e) => set("miles", e.target.value)} /></label>
          <label>My age<input type="number" min={0} max={120} value={f.age} onChange={(e) => set("age", e.target.value)} /></label>
        </div>
        <div className="check-row">
          <label><input type="checkbox" checked={goingOnly} onChange={(e) => setGoingOnly(e.target.checked)} /> My shifts only</label>
          <label><input type="checkbox" checked={showPast} onChange={(e) => setShowPast(e.target.checked)} /> Show past</label>
          {f !== NO_FILTERS && <button type="button" className="text-link as-button" onClick={() => setF(NO_FILTERS)}>Clear filters</button>}
        </div>
        {f.miles !== "" && <p className="muted small">Items with no distance listed are hidden while this filter is on.</p>}
      </Card>

      {rows.length === 0 ? (
        <Card><Empty title={list.data.length ? "No opportunities match" : "No opportunities yet"}>{!list.data.length && <p className="muted">Add one you've found, or import a list from your school.</p>}</Empty></Card>
      ) : (
        <ul className="opp-grid" aria-label="Opportunities">
          {rows.map((o) => (
            <li key={o.id} className="opp">
              <div className="opp-top">
                <span className="chip">{o.cause}</span>
                <span className="muted small">{o.source === "school" ? "School list" : "Added by me"}</span>
              </div>
              <h3>{o.title}</h3>
              <p className="muted">{o.organization}</p>
              <p className="meta"><CalendarDays size={14} aria-hidden="true" /> {shortDate(o.date)}{o.start ? `, ${timeRange(o.start, o.end)}` : ""}</p>
              {(o.location || o.distanceMiles !== null) && <p className="meta"><MapPin size={14} aria-hidden="true" /> {[o.location, o.distanceMiles !== null ? `${o.distanceMiles} mi` : ""].filter(Boolean).join(" · ")}</p>}
              {ageLabel(o) && <p className="meta"><Users size={14} aria-hidden="true" /> {ageLabel(o)}</p>}
              {o.details && <p className="small details">{o.details}</p>}
              <div className="opp-actions">
                <button type="button" className={o.going ? "btn small selected" : "btn small"} aria-pressed={o.going} onClick={() => toggle(o)}>{o.going ? "Going" : "I'm going"}</button>
                <button type="button" className="btn small" title={shiftHours(o) ? `Prefills ${fmtHours(shiftHours(o)!)}` : undefined} onClick={() => openEntry({ prefill: { date: o.date <= today ? o.date : today, organization: o.organization, activity: o.title, hours: shiftHours(o) } })}>Log hours</button>
                <span className="grow" />
                {o.source === "student" && <button type="button" className="icon-btn" aria-label={`Edit ${o.title}`} onClick={() => setEditing(o)}><Pencil size={16} /></button>}
                <button type="button" className="icon-btn" aria-label={`Remove ${o.title}`} onClick={() => setRemoving(o)}><Trash2 size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editing && <OpportunityDialog item={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
      {importing && <ImportDialog onClose={() => setImporting(false)} />}
      {removing && (
        <Confirm title="Remove this opportunity?" message={`${removing.title} will be removed from your list.`} action="Remove" onClose={() => setRemoving(null)}
          onConfirm={async () => { await api.removeOpportunity(removing.id); refresh(); notify("Opportunity removed"); }} />
      )}
    </div>
  );
}

function OpportunityDialog({ item, onClose }: { item: Opportunity | null; onClose: () => void }) {
  const { refresh, notify } = useApp();
  const [form, setForm] = useState({
    organization: item?.organization ?? "", title: item?.title ?? "", cause: item?.cause ?? "Community", date: item?.date ?? localToday(),
    start: item?.start ?? "", end: item?.end ?? "", location: item?.location ?? "", details: item?.details ?? "",
    distanceMiles: item?.distanceMiles?.toString() ?? "", minAge: item?.minAge?.toString() ?? "", maxAge: item?.maxAge?.toString() ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));
  const num = (v: string) => (v === "" ? null : Number(v));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const input: OpportunityInput = { ...form, start: form.start || null, end: form.end || null, distanceMiles: num(form.distanceMiles), minAge: num(form.minAge), maxAge: num(form.maxAge) };
    try {
      if (item) await api.updateOpportunity(item.id, input);
      else await api.addOpportunity(input);
      refresh();
      notify(item ? "Opportunity updated" : "Opportunity added");
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };

  return (
    <Dialog title={item ? "Edit opportunity" : "Add opportunity"} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Organization<input required maxLength={100} value={form.organization} onChange={(e) => set("organization", e.target.value)} /></label>
        <label>Role<input required maxLength={150} value={form.title} onChange={(e) => set("title", e.target.value)} /></label>
        <div className="form-row">
          <label>Cause<select value={form.cause} onChange={(e) => set("cause", e.target.value)}>{CAUSES.map((c) => <option key={c}>{c}</option>)}</select></label>
          <label>Date<input type="date" required value={form.date} onChange={(e) => set("date", e.target.value)} /></label>
          <label>Starts<input type="time" value={form.start} onChange={(e) => set("start", e.target.value)} /></label>
          <label>Ends<input type="time" value={form.end} onChange={(e) => set("end", e.target.value)} /></label>
        </div>
        <label>Location<input maxLength={120} value={form.location} onChange={(e) => set("location", e.target.value)} /></label>
        <div className="form-row three">
          <label>Distance, miles<input type="number" min={0} max={500} step="any" value={form.distanceMiles} onChange={(e) => set("distanceMiles", e.target.value)} /></label>
          <label>Minimum age<input type="number" min={0} max={120} value={form.minAge} onChange={(e) => set("minAge", e.target.value)} /></label>
          <label>Maximum age<input type="number" min={0} max={120} value={form.maxAge} onChange={(e) => set("maxAge", e.target.value)} /></label>
        </div>
        <label>Details<input maxLength={1000} value={form.details} onChange={(e) => set("details", e.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">{item ? "Save changes" : "Add opportunity"}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ImportDialog({ onClose }: { onClose: () => void }) {
  const { refresh, notify } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const check = async () => {
    if (!file) return;
    try {
      setError(null);
      setPreview(await api.importList(file, false));
    } catch (e) {
      setPreview(null);
      setError(errorText(e));
    }
  };
  const confirm = async () => {
    if (!file) return;
    try {
      const result = await api.importList(file, true);
      refresh();
      notify(`Added ${result.new.length} ${result.new.length === 1 ? "opportunity" : "opportunities"}`);
      onClose();
    } catch (e) {
      setError(errorText(e));
    }
  };

  return (
    <Dialog title="Import a school list" onClose={onClose}>
      <div className="form">
        <p className="muted small">Upload a CSV with at least organization, title and date columns. <a className="text-link" href="/sample-opportunities.csv" download>Download a template</a></p>
        <label>CSV file<input type="file" accept=".csv,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} /></label>
        <div><button type="button" className="btn" disabled={!file} onClick={check}>Preview</button></div>
        {error && <p className="form-error" role="alert">{error}</p>}
        {preview && (
          <>
            <p>{preview.new.length} new, {preview.skippedDuplicates} already added, {preview.errors.length} with problems.</p>
            {preview.errors.length > 0 && <ul className="import-errors">{preview.errors.slice(0, 8).map((e) => <li key={e.row} className="small form-error">Row {e.row}: {e.error}</li>)}</ul>}
            <ul className="row-list import-list">
              {preview.new.slice(0, 30).map((o) => <li key={`${o.organization}-${o.title}-${o.date}`} className="row"><span className="grow">{o.title}</span><span className="muted small">{o.organization} · {shortDate(o.date)}</span></li>)}
            </ul>
            <div className="dialog-actions">
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="button" className="btn primary" disabled={preview.new.length === 0} onClick={confirm}>Add to list</button>
            </div>
          </>
        )}
      </div>
    </Dialog>
  );
}
