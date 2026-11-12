import { effectiveEntries, isCountedPerformance, compareSetlistSongs } from "./domain";
import type { Dataset, Show } from "./model";

const prefectures = "北海道 青森 岩手 宮城 秋田 山形 福島 茨城 栃木 群馬 埼玉 千葉 東京 神奈川 新潟 富山 石川 福井 山梨 長野 岐阜 静岡 愛知 三重 滋賀 京都 大阪 兵庫 奈良 和歌山 鳥取 島根 岡山 広島 山口 徳島 香川 愛媛 高知 福岡 佐賀 長崎 熊本 大分 宮崎 鹿児島 沖縄".split(" ");
export function prefecture(region: string): string | null {
  const raw = region.trim();
  const name = prefectures.find((p) => raw === p || raw === p + (p === "北海道" ? "" : p === "東京" ? "都" : p === "大阪" || p === "京都" ? "府" : "県"));
  if (!name) return null;
  return name === "北海道" ? name : name + (name === "東京" ? "都" : name === "大阪" || name === "京都" ? "府" : "県");
}
/** Compact schematic of Japan. Coordinates are cartogram grid positions, not geographic boundaries. */
export const JAPAN_PREFECTURE_LAYOUT = [
  ["北海道",10,1],["青森",9,3],["岩手",9,4],["秋田",8,4],
  ["宮城",9,5],["山形",8,5],["福島",9,6],
  ["茨城",10,7],["栃木",9,7],["群馬",8,7],["埼玉",9,8],
  ["千葉",11,9],["東京",10,9],["神奈川",10,10],
  ["新潟",7,7],["富山",6,8],["石川",5,8],["福井",5,9],
  ["山梨",8,9],["長野",7,8],["岐阜",6,9],["静岡",8,10],["愛知",7,10],
  ["三重",6,11],["滋賀",5,10],["京都",4,10],["大阪",4,11],
  ["兵庫",3,11],["奈良",5,11],["和歌山",4,12],
  ["鳥取",2,10],["島根",1,10],["岡山",2,11],["広島",1,11],["山口",1,12],
  ["徳島",4,13],["香川",3,13],["愛媛",2,13],["高知",3,14],
  ["福岡",1,14],["佐賀",1,15],["長崎",1,16],["熊本",2,15],
  ["大分",3,15],["宮崎",3,16],["鹿児島",2,17],["沖縄",1,19],
] as const;

const group = (values: string[]) => Object.entries(values.reduce<Record<string, number>>((counts, key) => {
  counts[key] = (counts[key] ?? 0) + 1;
  return counts;
}, {})).sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b, "ja"));

export function attendanceStats(data: Dataset, mine: Show[], year?: string) {
  const sorted = [...mine].sort((a, b) => a.date.localeCompare(b.date));
  const knownPrefectures = mine.map((s) => prefecture(s.region)).filter((x): x is string => x !== null);
  const attendedIds = new Set(mine.map(s => s.id));
  const tourStats = data.tours.map((tour) => {
    const registered = data.shows.filter((s) => s.tourId === tour.id && (!year || s.date.startsWith(year + "-")));
    const attended = registered.filter((s) => attendedIds.has(s.id)).length;
    return {
      id: tour.id, name: tour.name, attended, total: registered.length,
      rate: registered.length ? attended / registered.length : null,
      shows: [...registered].sort((a,b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
        .map(s => ({id:s.id, date:s.date, venue:s.venue, attended:attendedIds.has(s.id)})),
    };
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
    standaloneCount: mine.filter(s => !s.tourId).length,
  };
}

/** Filter MY LIVE STATS by attended year, defaulting to the newest attended year.
 * "all" is the only unfiltered view; no stored records are modified.
 */
export function selectAttendancePeriod(data: Dataset, mine: Show[], requested: string | null) {
  const years = [...new Set(mine.map(s => s.date.slice(0, 4)))].sort((a, b) => b.localeCompare(a));
  const period = requested === "all" ? "all" : requested && years.includes(requested) ? requested : years[0] ?? "all";
  const allStats = attendanceStats(data, mine);
  const shows = period === "all" ? mine : mine.filter(s => s.date.startsWith(period + "-"));
  const stats = period === "all" ? allStats : attendanceStats(data, shows, period);
  return { years, period, shows, stats, allStats };
}

export function songArchive(data: Dataset, shows: Show[], ref: string) {
  const history = shows.flatMap((show) => {
    const entries = effectiveEntries(data, show);
    return entries === null ? [] : entries.flatMap((entry, index) => entry.songRef === ref && isCountedPerformance(entry) ? [{ show, entry, order: index + 1, total: entries.length }] : []);
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

/** Rare songs: only performed songs in the selected scope.
 * Unknown setlists never become a zero-performance observation.
 * Equal rates use the song reference as a stable tie-breaker.
 */
export function rareSongRanking<T extends { songRef: string; shows: number; rate: number | null }>(songs: readonly T[]): T[] {
  return songs.filter(song => song.shows > 0 && song.rate !== null)
    .sort((a,b) => (a.rate! - b.rate!) || a.shows - b.shows || a.songRef.localeCompare(b.songRef));
}

/** ALL LIVE timeline: tour accordions and one-off shows share the same descending date order.
 * Tour cards use their latest matching show as the placement date, not the tour's start date.
 * This changes only presentation; the underlying archive is untouched.
 */
export function allLiveTimeline(data: Dataset, visibleShows: readonly Show[]) {
  const tourById = new Map(data.tours.map(t=>[t.id,t]));
  const grouped = new Map<string, Show[]>();
  const singles: Show[] = [];
  for (const show of visibleShows) {
    if (show.tourId && tourById.has(show.tourId)) {
      const list = grouped.get(show.tourId) ?? [];
      list.push(show);
      grouped.set(show.tourId,list);
    } else singles.push(show);
  }
  const sections: ({kind:"tour";key:string;date:string;tour:Dataset["tours"][number];shows:Show[]} | {kind:"single";key:string;date:string;show:Show})[] = [];
  for (const [id,shows] of grouped) {
    const tour = tourById.get(id)!;
    const sorted = [...shows].sort((a,b)=>a.date.localeCompare(b.date)||a.slot.localeCompare(b.slot)||a.id.localeCompare(b.id));
    sections.push({kind:"tour",key:"tour:"+id,date:sorted[sorted.length-1].date,tour,shows:sorted});
  }
  for (const show of singles) sections.push({kind:"single",key:"show:"+show.id,date:show.date,show});
  return sections.sort((a,b)=>b.date.localeCompare(a.date)||a.key.localeCompare(b.key));
}

/** Group tour setlist differences by the actual *song set* change.
 * One difference pattern may apply to dozens of shows. No changes are written.
 * Missing setlists and non-performance game corners are excluded.
 */
export function groupedTourSetlistDifferences(data: Dataset, target: Show) {
  if (!target.tourId || !target.hasSavedSetlist) return [];
  const current = effectiveEntries(data,target);
  if (current === null) return [];
  const groups = new Map<string, {
    currentOnly: string[]; otherOnly: string[]; shows: Show[];
  }>();
  for (const other of data.shows) {
    if (other.id === target.id || other.tourId !== target.tourId || !other.hasSavedSetlist) continue;
    const otherEntries = effectiveEntries(data,other);
    if (otherEntries === null) continue;
    const differences = compareSetlistSongs(current,otherEntries);
    if (!differences.currentOnly.length && !differences.otherOnly.length) continue;
    const key = JSON.stringify([ [...differences.currentOnly].sort(), [...differences.otherOnly].sort() ]);
    const existing = groups.get(key);
    if (existing) existing.shows.push(other);
    else groups.set(key,{
      currentOnly:differences.currentOnly,
      otherOnly:differences.otherOnly,
      shows:[other],
    });
  }
  return [...groups.values()]
    .map(group=>({...group,shows:group.shows.sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id))}))
    .sort((a,b)=>b.shows.length-a.shows.length ||
      (b.shows[0]?.date ?? "").localeCompare(a.shows[0]?.date ?? ""));
}

/** Read-only comparison of two known setlists.
 * Duplicate song performances are paired by occurrence, never collapsed into one.
 * Order changes compare relative order of songs present in BOTH shows, so
 * adding one song does not misleadingly mark every following song as moved.
 */
export function compareDetailedSetlists(data: Dataset, currentShow: Show, otherShow: Show) {
  const current = effectiveEntries(data,currentShow);
  const other = effectiveEntries(data,otherShow);
  if (current === null || other === null) return null;
  type Row = {key:string;songRef:string;position:number;section:"MAIN"|"ENCORE";
    version:"FULL"|"SHORT"|null;medley:boolean;arrangement:"NORMAL"|"ARRANGED"};
  const rows = (entries: typeof current): Row[] => {
    const occurrences = new Map<string,number>();
    return entries.filter(isCountedPerformance).map((entry,i)=>{
      const occurrence = (occurrences.get(entry.songRef) ?? 0)+1;
      occurrences.set(entry.songRef,occurrence);
      return {key:JSON.stringify([entry.songRef,occurrence]),songRef:entry.songRef,
        position:i+1,section:entry.section,version:entry.version,
        medley:!!entry.medleyGroup,arrangement:entry.arrangement};
    });
  };
  const left = rows(current),right = rows(other);
  const leftKeys = new Set(left.map(r=>r.key)),rightKeys = new Set(right.map(r=>r.key));
  const removed = left.filter(r=>!rightKeys.has(r.key));
  const added = right.filter(r=>!leftKeys.has(r.key));
  const leftCommon = left.filter(r=>rightKeys.has(r.key));
  const rightCommon = right.filter(r=>leftKeys.has(r.key));
  const rightRanks = new Map(rightCommon.map((r,i)=>[r.key,i]));
  const rightByKey = new Map(right.map(r=>[r.key,r]));
  const pairs = leftCommon.map((from,i)=>({
    from,to:rightByKey.get(from.key)!,fromRank:i,toRank:rightRanks.get(from.key)!,
  }));
  const reordered = pairs.filter(p=>p.fromRank!==p.toRank);
  const sectionChanges = pairs.filter(p=>p.from.section!==p.to.section);
  const versionChanges = pairs.filter(p=>p.from.version!==p.to.version);
  const medleyChanges = pairs.filter(p=>p.from.medley!==p.to.medley);
  const arrangementChanges = pairs.filter(p=>p.from.arrangement!==p.to.arrangement);
  return {current:left,other:right,removed,added,reordered,sectionChanges,
    versionChanges,medleyChanges,arrangementChanges,
    identical:!removed.length&&!added.length&&!reordered.length&&!sectionChanges.length&&
      !versionChanges.length&&!medleyChanges.length&&!arrangementChanges.length};
}

/** Date-only BE:LIVE shows are scheduled in Japan; compare by Japan's calendar date. */
export function japanToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("sv-SE", {timeZone:"Asia/Tokyo",year:"numeric",month:"2-digit",day:"2-digit"}).format(now);
}

/** Future checked-in shows are plans, not completed concert memories. */
export function splitAttendanceByDate(registered: readonly Show[], today: string) {
  const past = registered.filter(s=>s.date<=today).sort((a,b)=>b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  const upcoming = registered.filter(s=>s.date>today).sort((a,b)=>a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  return {past,upcoming};
}

/** First time the user heard each song, based strictly on known past setlists. */
export function firstHeardSongs(data: Dataset, attendedPast: readonly Show[]) {
  const seen = new Set<string>();
  const first: {songRef:string;showId:string;date:string;venue:string}[] = [];
  for (const show of [...attendedPast].sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id))) {
    const entries = effectiveEntries(data,show);
    if (entries === null) continue;
    for (const entry of entries) {
      if (!isCountedPerformance(entry) || seen.has(entry.songRef)) continue;
      seen.add(entry.songRef);
      first.push({songRef:entry.songRef,showId:show.id,date:show.date,venue:show.venue});
    }
  }
  return first;
}

/** Add only explicitly selected attendance records. Never alter shows, setlists, or existing attended entries. */
export function addAttendanceRecords(data: Dataset, selectedShowIds: readonly string[], now: string): Dataset {
  if (!Number.isFinite(Date.parse(now))) throw Error("登録日時が不正です");
  const selected = new Set(selectedShowIds);
  if (selected.size !== selectedShowIds.length) throw Error("参戦公演が重複しています");
  const known = new Set(data.shows.map(show => show.id));
  if ([...selected].some(id => !known.has(id))) throw Error("存在しない公演が選択されています");
  const attendance = [...data.attendance];
  for (const showId of selected) {
    const index = attendance.findIndex(a => a.showId === showId);
    if (index >= 0) {
      if (attendance[index].attended) continue;
      attendance[index] = {...attendance[index], attended:true, updatedAt:now};
    } else {
      attendance.push({id:showId, revision:0, showId, attended:true, seat:"", note:"", createdAt:now, updatedAt:now});
    }
  }
  return {...data, attendance};
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
