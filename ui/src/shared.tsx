import { X } from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type DependencyList,
  type FormEvent,
  type ReactNode,
} from "react";
import { api, localToday, type Entry, type EntryInput } from "./api";

export interface EntryDraft {
  entry?: Entry;
  prefill?: Partial<EntryInput>;
}

export interface AppActions {
  version: number;
  refresh: () => void;
  notify: (message: string) => void;
  openEntry: (draft?: EntryDraft) => void;
}

export const AppContext = createContext<AppActions>({ version: 0, refresh: () => {}, notify: () => {}, openEntry: () => {} });
export const useApp = () => useContext(AppContext);

export const errorText = (e: unknown) => {
  const text = e instanceof Error ? e.message : "Something went wrong.";
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export function useLoad<T>(load: () => Promise<T>, deps: DependencyList = []) {
  const { version } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let live = true;
    load()
      .then((value) => {
        if (!live) return;
        setData(value);
        setError(null);
      })
      .catch((e) => live && setError(errorText(e)));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, tick, ...deps]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, reload };
}

export function Dialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (node && !node.open) node.showModal();
  }, []);
  return (
    <dialog ref={ref} className="dialog" onCancel={onClose} aria-label={title}>
      <header className="dialog-head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </header>
      <div className="dialog-body">{children}</div>
    </dialog>
  );
}

export function Confirm({ title, message, action, onConfirm, onClose }: { title: string; message: string; action: string; onConfirm: () => Promise<void>; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      await onConfirm();
      onClose();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <p>{message}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button type="button" className="btn" onClick={onClose}>Cancel</button>
        <button type="button" className="btn danger" disabled={busy} onClick={run}>{action}</button>
      </div>
    </Dialog>
  );
}

export function EntryDialog({ draft, onClose }: { draft: EntryDraft; onClose: () => void }) {
  const { refresh, notify } = useApp();
  const source = draft.entry ?? draft.prefill;
  const [form, setForm] = useState({
    date: source?.date ?? localToday(),
    organization: source?.organization ?? "",
    activity: source?.activity ?? "",
    hours: source?.hours ? String(source.hours) : "",
    note: source?.note ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const input = { ...form, hours: Number(form.hours) };
      if (draft.entry) await api.updateEntry(draft.entry.id, input);
      else await api.addEntry(input);
      refresh();
      notify(draft.entry ? "Entry updated" : "Hours logged as a draft");
      onClose();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  };

  return (
    <Dialog title={draft.entry ? "Edit hours" : "Log hours"} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <div className="form-row">
          <label>Date<input type="date" required value={form.date} onChange={(e) => set("date", e.target.value)} /></label>
          <label>Hours<input type="number" required min={0.25} max={24} step={0.25} value={form.hours} onChange={(e) => set("hours", e.target.value)} /></label>
        </div>
        <label>Organization<input required maxLength={100} value={form.organization} onChange={(e) => set("organization", e.target.value)} /></label>
        <label>Activity<input required maxLength={200} value={form.activity} onChange={(e) => set("activity", e.target.value)} /></label>
        <label>Note (optional)<input maxLength={500} value={form.note} onChange={(e) => set("note", e.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary" disabled={busy}>{draft.entry ? "Save changes" : "Log hours"}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function VerifyDialog({ entry, onClose }: { entry: Entry; onClose: () => void }) {
  const { refresh, notify } = useApp();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.setStatus(entry.id, "verified", name);
      refresh();
      notify("Marked as verified");
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Dialog title="Mark as verified" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="muted">Only do this once a supervisor has confirmed these hours.</p>
        <label>Who confirmed them?<input required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Mark verified</button>
        </div>
      </form>
    </Dialog>
  );
}

export function Loading() {
  return <div className="skeleton" role="status" aria-label="Loading" />;
}

export function ErrorNote({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="note-error" role="alert">
      <span>{message}</span>
      {retry && <button type="button" className="btn small" onClick={retry}>Try again</button>}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><h3>{title}</h3>{children}</div>;
}

export function Card({ title, action, children }: { title?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="card">
      {(title || action) && <header className="card-head">{title && <h2>{title}</h2>}{action}</header>}
      {children}
    </section>
  );
}
