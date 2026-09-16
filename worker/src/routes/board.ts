/**
 * GET /board/{contestId}?token=…        投影用畫面（不需登入），每 10 秒自動更新
 * GET /board/{contestId}?token=…&format=json   同一份資料的 JSON，頁面用它輪詢
 *
 * token 由超管在儀表板產生，存在 contests.dashboard.boardToken；重新產生即失效。
 * dashboard.visibility 為 organizer 時回「主辦單位尚未開放」。
 */
import { HttpError, type RequestContext } from "../context";
import { json } from "../index";

interface DashboardSnapshot {
  title?: string;
  accountCount?: number;
  submittedCount?: number;
  submissionCount?: number;
  averageScore?: number;
  ranking?: Array<{ rank: number; username: string; name: string; schoolName: string; totalScore: number; solvedCount: number; submitCount: number }>;
  problemStats?: Record<string, { solved: number; attempted: number }>;
  computedAtMs?: number;
}

export async function handleBoard(request: Request, ctx: RequestContext, contestId: string): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";
  const wantsJson = url.searchParams.get("format") === "json";

  const contest = await ctx.getContest(contestId);
  const dashboardSettings = (contest?.data as { dashboard?: { visibility?: string; showNames?: boolean; topN?: number; boardToken?: string } } | undefined)?.dashboard;
  if (!contest || !dashboardSettings?.boardToken || !token || token !== dashboardSettings.boardToken) {
    if (wantsJson) throw new HttpError(403, "forbidden", "投影連結無效");
    return html(page("投影連結無效", "<p class='muted'>請向主辦單位索取新的連結。</p>", ""), 403);
  }
  if ((dashboardSettings.visibility ?? "organizer") === "organizer") {
    if (wantsJson) return json({ ok: true, closed: true });
    return html(page(contest.data.title, "<p class='muted'>主辦單位尚未開放排行榜。</p>", refreshScript(url)));
  }

  const snapshot = (await ctx.db.getDoc<DashboardSnapshot>(`contestDashboards/${contestId}`))?.data ?? {};
  const problems = await ctx.db.query<{ problemId: string; title: string; order: number }>("contestProblems", {
    where: [{ field: "contestId", op: "EQUAL", value: contestId }],
  });
  const showNames = dashboardSettings.showNames === true;
  const topN = dashboardSettings.topN && dashboardSettings.topN > 0 ? dashboardSettings.topN : 20;
  const ranking = (snapshot.ranking ?? []).slice(0, topN).map((row) => ({
    rank: row.rank,
    label: showNames ? row.name : row.username,
    schoolName: row.schoolName,
    totalScore: row.totalScore,
    solvedCount: row.solvedCount,
  }));
  const problemRows = problems
    .map((doc) => doc.data)
    .sort((a, b) => a.order - b.order)
    .map((problem) => ({
      title: `${problem.order}. ${problem.title}`,
      solved: snapshot.problemStats?.[problem.problemId]?.solved ?? 0,
      attempted: snapshot.problemStats?.[problem.problemId]?.attempted ?? 0,
    }));
  const payload = {
    ok: true,
    closed: false,
    title: contest.data.title,
    submittedCount: snapshot.submittedCount ?? 0,
    submissionCount: snapshot.submissionCount ?? 0,
    accountCount: snapshot.accountCount ?? 0,
    computedAtMs: snapshot.computedAtMs ?? 0,
    ranking,
    problems: problemRows,
  };
  if (wantsJson) return json(payload);

  const rankingHtml =
    ranking.length === 0
      ? "<p class='muted'>尚無提交。</p>"
      : `<table><thead><tr><th>#</th><th>參賽者</th><th>學校</th><th>總分</th><th>完成</th></tr></thead><tbody>${ranking
          .map(
            (row) =>
              `<tr class="${row.rank <= 3 ? "top" : ""}"><td>${row.rank}</td><td>${esc(row.label)}</td><td>${esc(row.schoolName)}</td><td class="num">${row.totalScore}</td><td class="num">${row.solvedCount}</td></tr>`,
          )
          .join("")}</tbody></table>`;
  const problemsHtml =
    problemRows.length === 0
      ? ""
      : `<h2>各題完成人數</h2><div class="problems">${problemRows
          .map(
            (row) =>
              `<div class="problem"><span>${esc(row.title)}</span><strong>${row.solved}</strong><small>嘗試中 ${row.attempted}</small></div>`,
          )
          .join("")}</div>`;
  const body = `<div class="stats"><div><strong>${payload.submittedCount}</strong><span>已提交 / ${payload.accountCount} 人</span></div><div><strong>${payload.submissionCount}</strong><span>提交次數</span></div></div><div id="content">${rankingHtml}${problemsHtml}</div>`;
  return html(page(contest.data.title, body, refreshScript(url)));
}

function refreshScript(url: URL) {
  const jsonUrl = new URL(url.toString());
  jsonUrl.searchParams.set("format", "json");
  return `<script>setInterval(function(){fetch(${JSON.stringify(jsonUrl.toString())}).then(function(r){return r.json()}).then(function(d){if(!d||d.closed){location.reload();return;}location.reload();}).catch(function(){});},10000);</script>`;
}

function page(title: string, body: string, script: string) {
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} 排行榜</title><style>
  body{margin:0;font-family:"Noto Sans TC","Microsoft JhengHei",system-ui,sans-serif;background:#0f2a3a;color:#eaf4f8;padding:32px 40px}
  h1{margin:0 0 6px;font-size:40px}.sub{color:#9fc3d3;margin:0 0 24px;font-size:18px}
  .stats{display:flex;gap:32px;margin-bottom:20px}.stats div{display:flex;flex-direction:column}.stats strong{font-size:44px;line-height:1}.stats span{color:#9fc3d3}
  table{width:100%;border-collapse:collapse;font-size:26px}th{text-align:left;color:#9fc3d3;font-weight:500;padding:8px 12px;border-bottom:1px solid #2f5566}
  td{padding:10px 12px;border-bottom:1px solid #1e4152}td.num{text-align:right;font-variant-numeric:tabular-nums}tr.top td{color:#ffd166;font-weight:700}
  h2{font-size:22px;color:#9fc3d3;margin:28px 0 10px}.problems{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px}
  .problem{background:#163b4d;border-radius:10px;padding:10px 14px;display:grid;gap:2px}.problem strong{font-size:30px}.problem small{color:#9fc3d3}
  .muted{color:#9fc3d3;font-size:22px}
  </style></head><body><h1>${esc(title)}</h1><p class="sub">即時排行榜 · 每 10 秒更新</p>${body}${script}</body></html>`;
}

function html(markup: string, status = 200) {
  return new Response(markup, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

function esc(value: string) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}
