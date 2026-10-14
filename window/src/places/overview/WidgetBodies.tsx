// The bodies of the GitHub and Gmail cards, as the preview draws them (preview.html GitHub and Gmail widgets). Each
// number comes from the connector's search (connector-data.ts); a tile with no number says Coming, and so does a block
// the engine cannot compute yet (the contribution grid, streaks, mail by day, the mail summary).
import { LOCKDOWN_WHY } from "../../screens/approvals/AskCard";
import type { GitHubData, GmailData, Row } from "./connector-data";

/** One stat tile: its number, or Coming when the engine has no number for it. */
export function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="p34-stat">
      <small>{label}</small>
      {value === null ? <span className="pill idle">Coming</span> : <b>{value.toLocaleString("en-US")}</b>}
    </div>
  );
}

/** A block the engine cannot compute yet: its title and a Coming pill. */
function ComingBlock({ title }: { title: string }) {
  return (
    <div className="p34-block">
      <div className="p34-sub"><b>{title}</b></div>
      <span className="pill idle">Coming</span>
    </div>
  );
}

export function GitHubBody({ data, repo, onRepo, defaultName, onAsk }: {
  data: GitHubData | null; repo: string; onRepo: (repo: string) => void; defaultName: string; onAsk: (text: string) => void;
}) {
  const repos = data?.repos ?? [];
  const attention = [...(data?.requested ?? []).map(row => ({ kind: "Review requested", row })), ...(data?.mentioned ?? []).map(row => ({ kind: "You were mentioned", row }))];
  return (
    <div className="p34-body">
      <div className="p34-chips" role="group" aria-label="Repositories">
        <button type="button" aria-pressed={repo === ""} onClick={() => onRepo("")}>All repositories</button>
        {repos.map(r => <button key={r} type="button" aria-pressed={repo === r} onClick={() => onRepo(r)}>{r}</button>)}
      </div>
      <div className="p34-stats">
        <Stat label="Contributions" value={null} />
        <Stat label="Pull requests opened" value={data?.opened ?? null} />
        <Stat label="Pull requests merged" value={data?.merged ?? null} />
        <Stat label="Reviews" value={data?.reviews ?? null} />
      </div>
      <ComingBlock title="contributions in the last year" />
      <div className="p34-stats">
        <Stat label="Current streak" value={null} />
        <Stat label="Longest streak" value={null} />
        <Stat label="Most active month" value={null} />
        <Stat label="Most active day" value={null} />
      </div>
      <div className="p34-sub"><b>Needs your attention</b><span className="p34-count">{attention.length}</span></div>
      <div className="p34-list">
        {attention.map(({ kind, row }, i) => {
          const title = String(row.title ?? "");
          const where = [repoOfRow(row), row.number !== undefined ? `#${String(row.number)}` : ""].filter(Boolean).join(" ");
          return (
            <div className="p34-row" key={`${kind}-${i}`}>
              <span className="p34-grow"><b>{kind}</b><small>{[title, where].filter(Boolean).join(" · ")}</small></span>
              <button type="button" className="btn sm" onClick={() => onAsk(`${kind}: ${title}`)}>Ask {defaultName}</button>
            </div>
          );
        })}
        <div className="p34-row"><span className="p34-grow"><b>A check failed</b></span><span className="pill idle">Coming</span></div>
      </div>
    </div>
  );
}

function repoOfRow(row: Row): string {
  const repo = row.repository as Row | undefined;
  const full = String(repo?.full_name ?? row.repository_full_name ?? "");
  if (full) return full;
  const url = String(row.repository_url ?? row.html_url ?? "").split("/").filter(Boolean);
  return url.length >= 2 ? `${url[url.length - 2]}/${url[url.length - 1]}`.replace(/#.*$/, "") : "";
}

export function GmailBody({ data, onAsk, lockdown }: {
  data: GmailData | null; onAsk: (text: string) => void; lockdown?: boolean;
}) {
  const senders = data?.senders ?? [];
  const top = senders[0]?.[1] ?? 0;
  return (
    <div className="p34-body">
      <div className="p34-stats">
        <Stat label="Unread" value={data?.unread ?? null} />
        <Stat label="Needs a reply" value={data?.needs ?? null} />
        <Stat label="Important" value={data?.important ?? null} />
        <Stat label="Sent" value={data?.sent ?? null} />
      </div>
      <div className="p34-oneline"><b>Today’s mail in one line:</b> <span className="pill idle">Coming</span></div>
      <div className="p34-two">
        <ComingBlock title="Mail by day" />
        <div>
          <div className="p34-sub"><b>Top senders</b></div>
          {senders.length ? (
            <div className="p34-bars">
              {senders.map(([who, count]) => (
                <div className="p34-bar" key={who}><span>{who}</span><i style={{ width: `${top > 0 ? (count / top) * 100 : 0}%` }} /><small>{count}</small></div>
              ))}
            </div>
          ) : <span className="pill idle">Coming</span>}
        </div>
      </div>
      <div className="p34-sub"><b>Needs a reply</b><span className="p34-count">{data?.needsRows.length ?? 0}</span></div>
      <div className="p34-list">
        {(data?.needsRows ?? []).map((row, i) => {
          const from = String(row.from ?? row.sender ?? "");
          const subject = String(row.subject ?? row.snippet ?? "");
          return (
            <div className="p34-row" key={i}>
              <span className="p34-grow"><b>{from}</b><small>{subject}</small></span>
              <button type="button" className="btn sm" disabled={lockdown} title={lockdown ? LOCKDOWN_WHY : undefined} onClick={() => onAsk(`Draft a reply to ${from} about “${subject}”`)}>Draft a reply</button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
