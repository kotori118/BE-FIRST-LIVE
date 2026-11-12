import { effectiveEntries } from "./domain";
import type { Dataset, Show } from "./model";

const prefectures = "北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄".split(" ");
export function prefecture(region: string): string | null {
  const raw = region.trim();
  const name = prefectures.find((p) => raw === p || raw === p + (p === "北海道" ? "" : p === "東京" ? "都" : p === "大阪" || p === "京都" ? "府" : "県"));
  if (!name) return null;
  return name === "北海道" ? name : name + (name === "東京" ? "都" : name === "大阪" || name === "京都" ? "府" : "県");
}
const group = (values: string[]) => Object.entries(values.reduce<Record<string, number>>((counts, key) => {
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {})).sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b, "ja"));

export function attendanceStats(data: Dataset, mine: Show[], year?: string) {
  const sorted = [...mine].sort((a, b) => a.date.localeCompare(b.date));
  const knownPrefectures = mine.map((s) => prefecture(s.region)).filter((x): x is string => x !== null);
  const tourStats = data.tours.map((tour) => {
    const registered = data.shows.filter((s) => s.tourId === tour.id && (!year || s.date.startsWith(year + "-")));
    const attended = registered.filter((s) => mine.some((m) => m.id === s.id)).length;
    return { id: tour.id, name: tour.name, attended, total: registered.length, rate: registered.length ? attended / registered.length : null };
  }).filter((t) => t.attended).sort((a, b) => b.attended - a.attended || a.name.localeCompare(b.name, "ja"));
  return {
    total: mine.length,
    firstDate: sorted[0]?.date ?? null,
    lastDate: sorted.at(-1)?.date ?? null,
    distinctTours: new Set(mine.map(s => s.tourId ?? "single:" + s.id)).size,
    activeYears: new Set(mine.map(s => s.date.slice(0, 4))).size,
    timeline: sorted.map(s => ({ id: s.id, date: s.date, venue: s.venue, name: data.tours.find(t => t.id === s.tourId)?.name ?? s.name })),
    cumulative: sorted.reduce<{ date: string; total: number }[]>((acc, show) => {
      acc.push({ date: show.date, total: acc.length + 1 });
      return acc;
    }, []),
    peakYear: group(mine.map(s => s.date.slice(0, 4)))[0] ?? null,
    peakMonth: group(mine.map(s => s.date.slice(0, 7)))[0] ?? null,
    years: group(mine.map((s) => s.date.slice(0, 4))).sort(([a], [b]) => b.localeCompare(a)),
    months: group(mine.map((s) => s.date.slice(0, 7))).sort(([a], [b]) => b.localeCompare(a)),
    prefectures: group(knownPrefectures),
    unknownPrefectures: mine.length - knownPrefectures.length,
    venues: group(mine.map((s) => s.venue)),
    tourStats,
  };
}

/** Filter MY LIVE STATS by attended year, defaulting to the newest attended year.
 * "all" is the only unfiltered view; no stored records are modified.
 */
export function selectAttendancePeriod(data: Dataset, mine: Show[], requested: string | null) {
  const years = [...new Set(mine.map(s => s.date.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const period = requested === "all" ? "all" : requested && years.includes(requested) ? requested : years[0] ?? "all";
  const allStats = attendanceStats(data, mine);
  const stats = period === "all" ? allStats : attendanceStats(data, mine.filter(s => s.date.startsWith(period + "-")), period);
  return { years, period, stats, allStats };
}

export function songArchive(data: Dataset, shows: Show[], ref: string) {
  const history = shows.flatMap((show) => {
    const entries = effectiveEntries(data, show);
    return entries === null ? [] : entries.flatMap((entry, index) => entry.songRef === ref ? [{ show, entry, order: index + 1, total: entries.length }] : []);
  }).sort((a, b) => a.show.date.localeCompare(b.show.date) || a.show.id.localeCompare(b.show.id) || a.order - b.order);
  const uniqueShows = new Set(history.map((h) => h.show.id));
  const knownShows = shows.filter((s) => effectiveEntries(data, s) !== null).length;
  const yearly = group(history.map((h) => h.show.date.slice(0, 4))).sort(([a], [b]) => a.localeCompare(b));
  const tours = group(history.map((h) => data.tours.find((t) => t.id === h.show.tourId)?.name ?? h.show.name));
  const first = history[0]?.show.date ?? null;
  const last = history.at(-1)?.show.date ?? null;
  const averageOrder = history.length ? history.reduce((sum,h)=>sum+h.order,0)/history.length : null;
  const daysSinceLast = last ? Math.max(0, Math.floor((Date.now()-Date.parse(last+"T00:00:00Z"))/86400000)) : null;
  return {
    history, performances: history.length, shows: uniqueShows.size, knownShows,
    rate: knownShows ? uniqueShows.size / knownShows : null,
    first, last, yearly, tours, averageOrder, daysSinceLast,
    full: history.filter((h) => h.entry.version === "FULL").length,
    short: history.filter((h) => h.entry.version === "SHORT").length,
    medley: history.filter((h) => !!h.entry.medleyGroup).length,
    opening: history.filter((h) => h.order === 1).length,
    encore: history.filter((h) => h.entry.section === "ENCORE").length,
  };
}

/** Local-only CSV export. No network request or public data publication. */
export function exportShowsCsv(data: Dataset): string {
  const quote = (v: unknown) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  const rows = [["公演日","ライブ名","会場","都道府県","公演回","参戦","座席","感想","セトリ登録"]];
  for (const show of [...data.shows].sort((a,b)=>a.date.localeCompare(b.date))) {
    const a = data.attendance.find(x=>x.showId===show.id);
    rows.push([show.date, data.tours.find(t=>t.id===show.tourId)?.name ?? show.name, show.venue, prefecture(show.region) ?? "", show.slot, a?.attended ? "はい" : "いいえ", a?.seat ?? "", a?.note ?? "", show.hasSavedSetlist ? "はい" : "いいえ"]);
  }
  return "\uFEFF" + rows.map(row=>row.map(quote).join(",")).join("\r\n");
}
