export const CAUSES = ["Animals", "Community", "Education", "Environment", "Food and hunger", "Health", "Seniors", "Other"];

export type Status = "draft" | "submitted" | "verified";

export interface Entry {
  id: number;
  date: string;
  organization: string;
  activity: string;
  hours: number;
  note: string;
  status: Status;
  verifiedBy: string | null;
}

export type EntryInput = Pick<Entry, "date" | "organization" | "activity" | "hours" | "note">;

export interface Opportunity {
  id: number;
  organization: string;
  title: string;
  cause: string;
  date: string;
  start: string | null;
  end: string | null;
  location: string;
  distanceMiles: number | null;
  minAge: number | null;
  maxAge: number | null;
  details: string;
  source: "school" | "student";
  going: boolean;
}

export type OpportunityInput = Omit<Opportunity, "id" | "source" | "going">;

export interface Goal {
  hours: number;
  label: string;
  deadline: string | null;
}

export interface Overview {
  today: string;
  hours: { draft: number; submitted: number; verified: number; counted: number };
  goal: Goal | null;
  progress: { percent: number; verifiedPercent: number; remaining: number } | null;
  nextShift: Opportunity | null;
  awaitingSignoff: Entry[];
  drafts: Entry[];
  recent: Entry[];
  entryCount: number;
  opportunityCount: number;
}

export interface ImportResult {
  preview: boolean;
  new: Opportunity[];
  skippedDuplicates: number;
  errors: { row: number; error: string }[];
}

async function send<T>(method: string, path: string, body?: unknown, raw?: File): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers: {
        ...(method === "GET" ? {} : { "X-VOL-Request": "1" }),
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(raw ? { "Content-Type": "text/csv" } : {}),
      },
      body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new Error("Couldn't reach the app. Check that it's still running.");
  }
  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    // handled below
  }
  if (!response.ok) throw new Error((data as { error?: string } | null)?.error ?? "Something went wrong.");
  return data as T;
}

export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export const api = {
  overview: () => send<Overview>("GET", `/overview?today=${localToday()}`),
  entries: () => send<Entry[]>("GET", "/entries"),
  addEntry: (e: EntryInput) => send<Entry>("POST", "/entries", e),
  updateEntry: (id: number, e: EntryInput) => send<Entry>("PATCH", `/entries/${id}`, e),
  setStatus: (id: number, status: Status, verifiedBy?: string) =>
    send<Entry>("POST", `/entries/${id}/status`, { status, verifiedBy }),
  removeEntry: (id: number) => send("DELETE", `/entries/${id}`, { confirmed: true }),
  opportunities: () => send<Opportunity[]>("GET", "/opportunities"),
  addOpportunity: (o: OpportunityInput) => send<Opportunity>("POST", "/opportunities", o),
  updateOpportunity: (id: number, o: OpportunityInput) => send<Opportunity>("PATCH", `/opportunities/${id}`, o),
  setGoing: (id: number, going: boolean) => send<Opportunity>("POST", `/opportunities/${id}/going`, { going }),
  removeOpportunity: (id: number) => send("DELETE", `/opportunities/${id}`, { confirmed: true }),
  importList: (file: File, confirm: boolean) =>
    send<ImportResult>("POST", `/opportunities/import${confirm ? "?confirm=1" : ""}`, undefined, file),
  saveGoal: (g: Goal) => send<Goal>("PUT", "/goal", g),
};
