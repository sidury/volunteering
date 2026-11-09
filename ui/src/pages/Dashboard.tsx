import { CalendarClock, CheckCircle2, Clock3, Hourglass } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, type Entry, type Goal, type Overview } from "../api";
import { fmtHours, longDate, shortDate, timeRange } from "../format";
import { Card, Dialog, Empty, ErrorNote, Loading, VerifyDialog, errorText, useApp, useLoad } from "../shared";
import { StatusBadge } from "./HoursLog";

export function Dashboard() {
  const { data, error, reload } = useLoad(api.overview);
  const { openEntry } = useApp();
  const [editingGoal, setEditingGoal] = useState(false);

  if (error && !data) return <ErrorNote message={error} retry={reload} />;
  if (!data) return <Loading />;
  const goalDialog = editingGoal && <GoalDialog goal={data.goal} onClose={() => setEditingGoal(false)} />;

  if (data.entryCount === 0 && data.opportunityCount === 0 && !data.goal) {
    return (
      <div className="card welcome">
        <h2>Welcome to Volunteer Planner</h2>
        <p className="muted">Keep your volunteer hours in one place, see what still needs signing off, and find your next opportunity.</p>
        <div className="button-row">
          <button type="button" className="btn primary" onClick={() => setEditingGoal(true)}>Set an hours goal</button>
          <button type="button" className="btn" onClick={() => openEntry()}>Log hours</button>
          <Link className="btn" to="/opportunities">Find opportunities</Link>
        </div>
        {goalDialog}
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="stat-grid">
        <Stat icon={<Clock3 size={18} />} label="Hours so far" value={fmtHours(data.hours.counted)} hint="Submitted and verified" />
        <Stat icon={<CheckCircle2 size={18} />} label="Verified" value={fmtHours(data.hours.verified)} hint="Confirmed by a supervisor" />
        <Stat icon={<Hourglass size={18} />} label="Awaiting sign-off" value={fmtHours(data.hours.submitted)} hint={`${data.awaitingSignoff.length} ${data.awaitingSignoff.length === 1 ? "entry" : "entries"}`} />
      </div>

      <Card title={data.goal ? data.goal.label : "Goal progress"} action={<button type="button" className="text-link as-button" onClick={() => setEditingGoal(true)}>{data.goal ? "Edit goal" : "Set a goal"}</button>}>
        <GoalProgress data={data} />
      </Card>

      <div className="two-col">
        <Card title="Next shift">
          {data.nextShift ? (
            <div>
              <p className="strong">{data.nextShift.title}</p>
              <p>{data.nextShift.organization}</p>
              <p className="muted small">
                <CalendarClock size={14} aria-hidden="true" /> {longDate(data.nextShift.date)}{data.nextShift.start ? `, ${timeRange(data.nextShift.start, data.nextShift.end)}` : ""}
              </p>
              {data.nextShift.location && <p className="muted small">{data.nextShift.location}</p>}
            </div>
          ) : (
            <Empty title="No shift coming up"><Link className="text-link" to="/opportunities">Find an opportunity</Link></Empty>
          )}
        </Card>
        <SignOff data={data} />
      </div>
      {goalDialog}
    </div>
  );
}

function GoalProgress({ data }: { data: Overview }) {
  if (!data.goal || !data.progress) return <p className="muted">Set a target to see how close you are.</p>;
  const { percent, verifiedPercent, remaining } = data.progress;
  return (
    <div>
      <div className="progress-track" role="img" aria-label={`${percent}% of goal, ${verifiedPercent}% verified`}>
        <div className="progress-pending" style={{ width: `${percent}%` }} />
        <div className="progress-verified" style={{ width: `${verifiedPercent}%` }} />
      </div>
      <p className="small muted progress-text">
        {fmtHours(data.hours.counted)} of {fmtHours(data.goal.hours)}. {remaining > 0 ? `${fmtHours(remaining)} to go` : "Goal reached"}
        {data.goal.deadline ? `, by ${shortDate(data.goal.deadline)}` : ""}. Dark shows verified hours.
      </p>
    </div>
  );
}

function SignOff({ data }: { data: Overview }) {
  const { refresh, notify } = useApp();
  const [verifying, setVerifying] = useState<Entry | null>(null);
  const items = [...data.drafts, ...data.awaitingSignoff];
  const submit = async (entry: Entry) => {
    try {
      await api.setStatus(entry.id, "submitted");
      refresh();
      notify("Submitted for sign-off");
    } catch (e) {
      notify(errorText(e));
    }
  };
  return (
    <Card title="Still needs sign-off" action={<Link to="/hours" className="text-link">All hours</Link>}>
      {items.length === 0 ? <Empty title="Everything is signed off" /> : (
        <ul className="row-list">
          {items.slice(0, 6).map((e) => (
            <li key={e.id} className="row">
              <div className="grow">
                <span className="strong">{e.organization}</span>
                <div className="muted small">{shortDate(e.date)} · {fmtHours(e.hours)}</div>
              </div>
              <StatusBadge status={e.status} />
              {e.status === "draft"
                ? <button type="button" className="btn small" onClick={() => submit(e)}>Submit</button>
                : <button type="button" className="btn small" onClick={() => setVerifying(e)}>Verify</button>}
            </li>
          ))}
        </ul>
      )}
      {verifying && <VerifyDialog entry={verifying} onClose={() => setVerifying(null)} />}
    </Card>
  );
}

function GoalDialog({ goal, onClose }: { goal: Goal | null; onClose: () => void }) {
  const { refresh, notify } = useApp();
  const [hours, setHours] = useState(goal ? String(goal.hours) : "");
  const [label, setLabel] = useState(goal?.label ?? "");
  const [deadline, setDeadline] = useState(goal?.deadline ?? "");
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.saveGoal({ hours: Number(hours), label, deadline: deadline || null });
      refresh();
      notify("Goal saved");
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };
  return (
    <Dialog title="Hours goal" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label>Target hours<input type="number" required min={1} max={5000} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} /></label>
        <label>Name (optional)<input maxLength={80} placeholder="My goal" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <label>Deadline (optional)<input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn primary">Save goal</button>
        </div>
      </form>
    </Dialog>
  );
}

function Stat({ icon, label, value, hint }: { icon: ReactNode; label: string; value: string; hint: string }) {
  return (
    <div className="stat">
      <div className="stat-label">{icon}<span>{label}</span></div>
      <div className="stat-value">{value}</div>
      <div className="muted small">{hint}</div>
    </div>
  );
}
