import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { onAuthStateChanged } from "firebase/auth";
import {
  House,
  Disc3,
  Ticket,
  ChartNoAxesCombined,
  Settings,
  ArrowLeft,
  Check,
  LogOut,
  Download,
  Upload,
  RefreshCw,
  RotateCcw,
  Link2,
  Scissors,
  Sparkles,
  CircleHelp,
  Pencil,
  X,
} from "lucide-react";
import {
  auth,
  configured,
  login,
  logout,
  invoke,
  watchState,
  type State,
} from "./firebase";
import {
  effectiveEntries,
  isCountedPerformance,
  analyze,
  unheard,
  parseBackup,
  exportJson,
  validateDataset,
  deriveOverrides,
} from "../shared/domain";
import { mergeCandidates } from "../shared/universe";
import {
  type Dataset,
  type Entry,
  type Show,
  type Collection,
  type Song,
} from "../shared/model";
import { trialDataset, trialSongs } from "../fixtures/dome2024";
import "./styles.css";
import { LibraryEditor, EntryEditor } from "./LibraryEditor";
import { selectAttendancePeriod, songArchive, exportShowsCsv, prefecture, JAPAN_PREFECTURE_LAYOUT } from "../shared/insights";

const preview = import.meta.env.VITE_PREVIEW === "true" || new URLSearchParams(location.search).get("trial")==="1";
const fixture: State = {
  control: { activeDatasetId: "preview", previousDatasetId: null, revision: 0 },
  data: trialDataset(),
  songs: trialSongs,
  syncedAt: null,
};
type Tab = "HOME" | "LIVE" | "ANALYSIS" | "SETTINGS";
const tabs = [
  ["HOME", House],
  ["LIVE", Disc3],
  ["ANALYSIS", ChartNoAxesCombined],
] as const;
const formatLabel = (f: string) => ({ARENA:"アリーナ",DOME:"ドーム",STADIUM:"スタジアム",FANMEETING:"ファンミーティング",OTHER:"その他"} as Record<string,string>)[f] ?? f;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const copy = <T,>(v: T) => structuredClone(v);
function App() {
  const [state, setState] = useState<State | null>(preview ? fixture : null),
    [tab, setTab] = useState<Tab>("HOME"),
    [showId, setShowId] = useState<string | null>(null),
    [error, setError] = useState(""),
    [syncError, setSyncError] = useState(""),
    [syncing,setSyncing]=useState(false),
    [busy, setBusy] = useState(false),
    [online, setOnline] = useState(navigator.onLine),
    [query, setQuery] = useState(""),
    [scope, setScope] = useState("mine"),
    [year, setYear] = useState(""),
    [format, setFormat] = useState(""),
    [tourFilter, setTourFilter] = useState(""),
    [category, setCategory] = useState(""),
    [liveMode, setLiveMode] = useState<"mine" | "all">("mine"),
    [liveStatsOpen, setLiveStatsOpen] = useState(false),
    [statsPeriod, setStatsPeriod] = useState<string | null>(null),
    [selectedPrefecture, setSelectedPrefecture] = useState<string | null>(null),
    [venuesExpanded, setVenuesExpanded] = useState(false),
    [toursExpanded, setToursExpanded] = useState(false),
    [songDetail, setSongDetail] = useState<string | null>(null),
    [attendanceEdit, setAttendanceEdit] = useState<{showId:string;attended:boolean;seat:string;note:string} | null>(null),
    [expanded, setExpanded] = useState<string | null>(
      sessionStorage.getItem("lastTour"),
    ),
    [edit, setEdit] = useState<{
      show: Show;
      entries: Entry[];
      seat: string;
      note: string;
      facts: Dataset["entryFacts"];
    } | null>(null),
    [backup, setBackup] = useState<Dataset | null>(null),
    [trialImport, setTrialImport] = useState<{data:Dataset;songs:Song[]|null} | null>(null),
    [trialLoaded, setTrialLoaded] = useState(false),
    [libraryDirty, setLibraryDirty] = useState(false),
    [draftConflicted, setDraftConflicted] = useState(false);
  const stateRef = useRef(state),
    stop = useRef<() => void>(() => {}),
    generation = useRef(0),
    refreshSeq = useRef(0),
    baseline = useRef<State | null>(null),
    libraryBase = useRef<State | null>(null),
    attendanceEditorRef = useRef<HTMLElement | null>(null);
  stateRef.current = state;
  useEffect(() => {
    if (attendanceEdit?.showId) attendanceEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [attendanceEdit?.showId]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!auth || preview) return;
    return onAuthStateChanged(auth, async (user) => {
      stop.current();
      generation.current++;
      const gen = generation.current;
      setState(null);
      setEdit(null);
      if (!user) return;
      setBusy(true);
      setError("");
      const refresh = async () => {
        const seq = ++refreshSeq.current;
        try {
          const next = await invoke<State>("getState");
          if (gen === generation.current && seq === refreshSeq.current) {
            setState(next);
            if (
              baseline.current &&
              baseline.current.control.revision !== next.control.revision
            )
              setDraftConflicted(true);
          }
        } catch (e) {
          if (gen === generation.current) setError(message(e));
        }
      };
      try {
        await invoke("bootstrap");
        if (gen !== generation.current) return;
        stop.current = watchState(
          user.uid,
          () => void refresh(),
          (e) => setError(e.message),
        );
        await refresh();
        setBusy(false);
        setSyncing(true);
        try {
          await invoke("syncUniverse");
          if (gen === generation.current) {
            setSyncError("");
            await refresh();
          }
        } catch (e) {
          if (gen === generation.current)
            setSyncError(
              "楽曲を同期できませんでした。同期済みのデータがある場合は前回値を表示します。" +
                message(e),
            );
        }
      } catch (e) {
        setError(message(e));
      } finally {
        if (gen === generation.current) {setBusy(false);setSyncing(false);}
      }
    });
  }, []);
  useEffect(() => () => stop.current(), []);
  const dirty = !!edit || libraryDirty || !!attendanceEdit;
  useEffect(() => {
    const guard = (e: BeforeUnloadEvent) => {
      if (dirty) {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", guard);
    const back = () => {
      if (
        dirty &&
        !window.confirm("保存していない変更があります。破棄しますか？")
      ) {
        history.pushState(null, "");
        return;
      }
      setEdit(null);
      setAttendanceEdit(null);
      setLibraryDirty(false);
      setShowId(null);
      setSongDetail(null);
      setTab("HOME");
    };
    window.addEventListener("popstate", back);
    return () => {
      window.removeEventListener("beforeunload", guard);
      window.removeEventListener("popstate", back);
    };
  }, [dirty]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const navigate = (next: Tab) => {
    if (busy) return;
    if (dirty && !confirm("保存していない変更があります。破棄しますか？"))
      return;
    setEdit(null);
    setAttendanceEdit(null);
    setLibraryDirty(false);
    setShowId(null);
    setSongDetail(null);
    setTab(next);
  };
  const refresh = async () => {
    if (!preview) setState(await invoke<State>("getState"));
  };
  const save = async (
    collection: Collection,
    entity: { id: string; revision: number },
    baseState = stateRef.current,
  ) => {
    if (!baseState) throw new Error("データを読み込んでください");
    const existing = baseState.data[collection].find((x) => x.id === entity.id);
    if (preview) {
      const next = copy(stateRef.current!);
      (next.data[collection] as unknown[]) = [
        ...next.data[collection].filter((x) => x.id !== entity.id),
        { ...entity, revision: (existing?.revision ?? -1) + 1 },
      ];
      validateDataset(next.data);
      next.control.revision++;
      setState(next);
      return;
    }
    await invoke("saveEntity", {
      collection,
      entity,
      expectedEntityRevision: existing?.revision ?? null,
      expected: {
        datasetId: baseState.control.activeDatasetId,
        revision: baseState.control.revision,
      },
    });
    await refresh();
  };
  const atomicSave = async (
    data: Dataset,
    baseState: State,
    deletedShowIds: string[] = [],
  ) => {
    validateDataset(data);
    if (preview) {
      setState({
        ...stateRef.current!,
        data,
        control: {
          ...baseState.control,
          revision: baseState.control.revision + 1,
        },
      });
      return;
    }
    await invoke("saveDatasetChanges", {
      data,
      expected: {
        datasetId: baseState.control.activeDatasetId,
        revision: baseState.control.revision,
      },
      confirmedDeletedShowIds: deletedShowIds,
    });
    await refresh();
  };
  const startAttendance = (show: Show) => {
    if (attendanceEdit?.showId === show.id) {
      attendanceEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    const a = stateRef.current?.data.attendance.find((x) => x.showId === show.id);
    setAttendanceEdit({ showId: show.id, attended: a?.attended ?? true, seat: a?.seat ?? "", note: a?.note ?? "" });
  };
  const saveAttendance = () => void run(async () => {
    if (!state || !attendanceEdit) return;
    const current = state.data.attendance.find((x) => x.showId === attendanceEdit.showId);
    if (current?.attended && !attendanceEdit.attended && !confirm("参戦記録を解除しますか？")) return;
    const now = new Date().toISOString();
    await save("attendance", {
      id: attendanceEdit.showId, revision: current?.revision ?? 0,
      showId: attendanceEdit.showId, attended: attendanceEdit.attended,
      seat: attendanceEdit.seat, note: attendanceEdit.note,
      createdAt: current?.createdAt ?? now, updatedAt: now,
    } as Dataset["attendance"][number]);
    setAttendanceEdit(null);
  });
  const download = (name: string, text: string, type = "application/json") => {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const startEdit = (show: Show) => {
    if (!state) return;
    baseline.current = copy(state);
    setDraftConflicted(false);
    const a = state.data.attendance.find((x) => x.showId === show.id);
    setAttendanceEdit(null);
    setEdit({
      show: copy(show),
      entries: copy(effectiveEntries(state.data, show) ?? []),
      seat: a?.seat ?? "",
      note: a?.note ?? "",
      facts: copy(state.data.entryFacts.filter((f) => f.showId === show.id)),
    });
  };
  const saveEdit = () =>
    void run(async () => {
      if (!state || !edit || !baseline.current) return;
      if (draftConflicted)
        throw new Error(
          "他の端末の変更があります。「最新を読み直す」で保存する内容を確認してください",
        );
      const data = copy(baseline.current.data),
        s = edit.show,
        entries = edit.entries;
      if(s.tourId && !s.templateId && entries.length) throw new Error("ツアー公演のセトリを入力するには、ライブ管理で基本セトリを作成してください");
      data.entryFacts = [
        ...data.entryFacts.filter((f) => f.showId !== s.id),
        ...edit.facts,
      ];
      const orphanFacts = data.entryFacts.filter(
        (f) => f.showId === s.id && !entries.some((e) => e.id === f.entryKey),
      );
      if (
        orphanFacts.length &&
        !confirm("削除した曲に紐づく披露事実も削除しますか？")
      )
        return;
      data.entryFacts = data.entryFacts.filter(
        (f) => !orphanFacts.some((o) => o.id === f.id),
      );
      s.hasSavedSetlist = !!(s.hasSavedSetlist || s.templateId || entries.length);
      if (s.templateId) {
        const template = data.templates.find((t) => t.id === s.templateId)!;
        const ops = deriveOverrides(template.entries, entries);
        const o = data.overrides.find((o) => o.showId === s.id);
        data.overrides = data.overrides.filter((o) => o.showId !== s.id);
        data.overrides.push({
          id: s.id,
          revision: (o?.revision ?? -1) + 1,
          showId: s.id,
          templateId: s.templateId,
          operations: ops,
        });
      } else if (!s.tourId && s.hasSavedSetlist) {
        const old = data.directEntries.find((x) => x.showId === s.id);
        data.directEntries = data.directEntries.filter(
          (x) => x.showId !== s.id,
        );
        data.directEntries.push({
          id: s.id,
          revision: (old?.revision ?? -1) + 1,
          showId: s.id,
          entries,
        });
      }
      data.shows = data.shows.map((x) =>
        x.id === s.id ? { ...s, revision: x.revision + 1 } : x,
      );
      const a = data.attendance.find((x) => x.showId === s.id);
      const now = new Date().toISOString();
      data.attendance = data.attendance.filter((x) => x.showId !== s.id);
      data.attendance.push({
        id: s.id,
        revision: (a?.revision ?? -1) + 1,
        showId: s.id,
        attended: a?.attended ?? false,
        seat: edit.seat,
        note: edit.note,
        createdAt: a?.createdAt ?? now,
        updatedAt: now,
      });
      await atomicSave(data, baseline.current);
      baseline.current = null;
      setEdit(null);
    });
  const allSongs: Song[] = state
    ? [
        ...state.songs,
        ...state.data.localSongs.map((s) => ({
          ref: "L:" + s.id,
          title: s.title,
          artist: s.artist,
          releaseDate: null,
          form: null,
          cdTitle: null,
          isTitleTrack: false,
          available: true,
        })),
      ]
    : [];
  const title = (ref: string) =>
    allSongs.find((s) => s.ref === ref)?.title ?? ref;
  if (!state)
    return (
      <div className="login">
        <div className="wordmark">
          <img src={import.meta.env.BASE_URL + "be-live-logo.svg"} alt="BE:LIVE" className="brand-logo" />
        </div>
        <div className="glass login-card">
          <Disc3 size={44} />
          <h1>BE:LIVE</h1>
          {configured ? (
            <button
              className="primary"
              onClick={() => void run(login)}
              disabled={busy}
            >
              Googleでログイン
            </button>
          ) : (
            <p>接続テストページでFirebase設定を保存してください</p>
          )}
          {auth?.currentUser && (
            <>
              <p>ログインUID: {auth.currentUser.uid}</p>
              <button onClick={() => void run(logout)}>ログアウト</button>
            </>
          )}
          <a href="../index.html">接続設定・Firestoreルール</a>
          {busy && <p role="status">読み込み中…</p>}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  const data = state.data,
    mine = data.shows.filter((s) =>
      data.attendance.some((a) => a.showId === s.id && a.attended),
    ),
    myStats = analyze(data, mine),
    statsPeriodView = selectAttendancePeriod(data, mine, statsPeriod),
    liveStats = statsPeriodView.stats,
    allLiveStats = statsPeriodView.allStats,
    heard = new Set(myStats.map((s) => s.songRef)),
    missing = unheard(state.songs, heard),
    latest = [...mine].sort((a, b) => b.date.localeCompare(a.date))[0],
    show = data.shows.find((s) => s.id === showId),
    shownShows = data.shows.filter(
      (s) =>
        (scope === "all" || mine.some((m) => m.id === s.id)) &&
        (!year || s.date.startsWith(year)) &&
        (!format || s.format === format) &&
        (!tourFilter || s.tourId === tourFilter),
    ),
    stats = analyze(data, shownShows).filter(
      (s) =>
        (!category ||
          (category === "UNRELEASED"
            ? data.songMetadata.find((m) => m.songRef === s.songRef)?.unreleased
            : data.songMetadata.find((m) => m.songRef === s.songRef)
                ?.category === category ||
              (category === "ORIGINAL" &&
                s.songRef.startsWith("U:") &&
                !data.songMetadata.some((m) => m.songRef === s.songRef)))),
    ),
    searchShows = data.shows.filter((s) =>
      [
        s.date,
        s.venue,
        data.tours.find((t) => t.id === s.tourId)?.name ?? s.name,
      ].some((x) => x.toLowerCase().includes(query.toLowerCase())),
    );
  const openShow = (s: Show) => {
    history.pushState(null, "");
    setShowId(s.id);
  };
  const CheckIn = ({ s }: { s: Show }) => mine.some((m) => m.id === s.id) ? <span className="attended-badge"><Check size={13} /> 参戦済み</span> : null;
  const ShowCard = ({ s }: { s: Show }) => (
    <div className="show-row">
      <button className="show-open" onClick={() => openShow(s)}>
        <span className="eyebrow">{s.date.replaceAll("-", ".")} · {s.region || "地域未登録"}</span>
        <strong>{s.venue}</strong>
        <small>{data.tours.find((t) => t.id === s.tourId)?.name ?? s.name}</small>
        <small>{s.hasSavedSetlist ? `${effectiveEntries(data, s)?.filter(isCountedPerformance).length ?? 0}曲` : "セトリ未登録"}</small>
      </button>
      <CheckIn s={s} />
    </div>
  );
  return (
    <div className="app">
      <header>
        <button className="brand" aria-label="BE:LIVE - HOMEへ" onClick={() => navigate("HOME")}>
          <img src={import.meta.env.BASE_URL + "be-live-logo.svg"} alt="BE:LIVE" className="brand-logo" />
        </button>
        <button
          className="icon"
          aria-label="設定"
          onClick={() => navigate("SETTINGS")}
        >
          <Settings size={20} />
        </button>
      </header>
      {preview && (
        <div className="preview">試験表示 · {trialLoaded ? "初期データ検証中" : "サンプルデータ"} · 保存はこの画面内のみ（再読み込みでリセット）</div>
      )}
      {!online && (
        <div className="error" role="alert">
          インターネットに接続してください。データ操作は停止しています。
        </div>
      )}
      {syncError && (
        <div className="error" role="alert">
          {syncError}
          <button
            onClick={() =>
              void run(async () => {
                await invoke("syncUniverse");
                setSyncError("");
                await refresh();
              })
            }
          >
            再同期
          </button>
        </div>
      )}
      {error && (
        <div className="error" role="alert">
          {error}
          <button
            className="icon"
            aria-label="エラーを閉じる"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {syncing && <p className="loading" role="status">更新確認中</p>}
      {busy && (
        <div className="loading" role="status">
          読み込み中…
        </div>
      )}
      <main>
        {edit ? (
          <>
            <div className="page-title">
              <h1>ライブを編集</h1>
              <button
                onClick={() => {
                  if (confirm("保存していない変更を破棄しますか？")) {
                    setEdit(null);
                    baseline.current = null;
                  }
                }}
              >
                キャンセル
              </button>
            </div>
            {draftConflicted && (
              <div className="error">
                他の端末で更新されました。入力内容は保持しています。
                <button
                  onClick={() => {
                    if (
                      confirm("最新データを読み直し、この編集を破棄しますか？")
                    ) {
                      const s = state.data.shows.find(
                        (x) => x.id === edit.show.id,
                      );
                      if (s) startEdit(s);
                    }
                  }}
                >
                  最新を読み直す
                </button>
                <button
                  onClick={() => {
                    if (
                      confirm(
                        "他の端末のこの公演への変更を、現在の編集中の内容で置き換えます。保存する内容を確認しましたか？",
                      )
                    ) {
                      baseline.current = copy(state);
                      setDraftConflicted(false);
                    }
                  }}
                >
                  自分の編集を選ぶ
                </button>
              </div>
            )}
            <section className="card fields">
              <label>
                公演名
                <input
                  value={edit.show.name}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: { ...edit.show, name: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                会場
                <input
                  value={edit.show.venue}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: { ...edit.show, venue: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                日付
                <input
                  type="date"
                  value={edit.show.date}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: { ...edit.show, date: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                公演回
                <input
                  value={edit.show.slot}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: { ...edit.show, slot: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                開演時刻（任意）
                <input
                  type="time"
                  value={edit.show.startsAt?.slice(11, 16) ?? ""}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: {
                        ...edit.show,
                        startsAt: e.target.value
                          ? edit.show.date + "T" + e.target.value + ":00+09:00"
                          : null,
                      },
                    })
                  }
                />
              </label>
              <label>
                基本セトリ
                <select
                  value={edit.show.templateId ?? ""}
                  onChange={(e) => {
                    if (!confirm("選択した基本セトリの曲順を読み込みますか？"))
                      return;
                    const template = data.templates.find(
                      (t) => t.id === e.target.value,
                    );
                    setEdit({
                      ...edit,
                      show: { ...edit.show, templateId: template?.id ?? null },
                      entries: copy(template?.entries ?? edit.entries),
                    });
                  }}
                >
                  <option value="">直接入力</option>
                  {data.templates
                    .filter((t) => t.tourId === edit.show.tourId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                座席
                <input
                  value={edit.seat}
                  onChange={(e) => setEdit({ ...edit, seat: e.target.value })}
                />
              </label>
              <label>
                感想
                <textarea
                  value={edit.note}
                  onChange={(e) => setEdit({ ...edit, note: e.target.value })}
                />
              </label>
              <label>
                公演メモ
                <textarea
                  value={edit.show.note}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: { ...edit.show, note: e.target.value },
                    })
                  }
                />
              </label>
              <label>
                未発表新曲の確認
                <select
                  value={edit.show.surpriseReview}
                  onChange={(e) =>
                    setEdit({
                      ...edit,
                      show: {
                        ...edit.show,
                        surpriseReview: e.target
                          .value as Show["surpriseReview"],
                      },
                    })
                  }
                >
                  <option value="UNREVIEWED">未確認</option>
                  <option value="NONE">未発表新曲なし</option>
                  <option value="REVIEWED">確認した</option>
                </select>
              </label>
            </section>
            <section className="card">
              <h2>セットリスト</h2>
              <EntryEditor
                entries={edit.entries}
                songs={allSongs}
                onChange={(entries) => setEdit({ ...edit, entries })}
              />
              <details>
                <summary>公演固有の披露事実</summary>
                {edit.entries.map((entry) => {
                  const fact = edit.facts.find((f) => f.entryKey === entry.id);
                  const change = (
                    key: "unpublishedBeforeShow" | "firstPerformedAtShow",
                    value: boolean,
                  ) => {
                    const next = fact ?? {
                      id: crypto.randomUUID(),
                      revision: 0,
                      showId: edit.show.id,
                      entryKey: entry.id,
                      unpublishedBeforeShow: false,
                      firstPerformedAtShow: false,
                      note: "",
                    };
                    setEdit({
                      ...edit,
                      facts: [
                        ...edit.facts.filter((f) => f.entryKey !== entry.id),
                        { ...next, [key]: value },
                      ],
                    });
                  };
                  return (
                    <div className="fields edit-entry" key={entry.id}>
                      <strong>{title(entry.songRef)}</strong>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={fact?.unpublishedBeforeShow ?? false}
                          onChange={(e) =>
                            change("unpublishedBeforeShow", e.target.checked)
                          }
                        />
                        公演前まで未発表
                      </label>
                      <label className="inline-check">
                        <input
                          type="checkbox"
                          checked={fact?.firstPerformedAtShow ?? false}
                          onChange={(e) =>
                            change("firstPerformedAtShow", e.target.checked)
                          }
                        />
                        この公演で初披露
                      </label>
                    </div>
                  );
                })}
              </details>
              <button
                className="primary"
                disabled={busy || !online || draftConflicted}
                onClick={saveEdit}
              >
                変更を保存
              </button>
            </section>
          </>
        ) : show ? (
          <>
            <button className="back-link" onClick={() => { setShowId(null); setAttendanceEdit(null); }}><ArrowLeft size={16} /> {tab === "ANALYSIS" ? "分析に戻る" : "ライブ一覧へ"}</button>
            <section className="glass hero">
              <p className="eyebrow">
                {show.date.replaceAll("-", ".")} · {formatLabel(show.format)}
              </p>
              <h1>{show.venue}</h1>
              <p>
                {data.tours.find((t) => t.id === show.tourId)?.name ??
                  show.name}
              </p>
              <div className="actions">
                <CheckIn s={show} />
                <button className="subtle-button" disabled={busy || !online} aria-expanded={attendanceEdit?.showId === show.id} aria-controls="attendance-entry-form" onClick={() => startAttendance(show)}><Ticket size={16} /> {mine.some((m) => m.id === show.id) ? "参戦記録を編集" : "参戦を記録"}</button>
                <button className="subtle-button"
                  disabled={busy || !online}
                  onClick={() => startEdit(show)}
                >
                  <Pencil size={16} />
                  編集
                </button>
              </div>
            </section>
            {attendanceEdit?.showId === show.id && (
              <section id="attendance-entry-form" ref={attendanceEditorRef} className="card fields attendance-editor" aria-label="参戦記録の入力">
                <h2>{mine.some(m => m.id === show.id) ? "参戦記録を編集" : "参戦を記録"}</h2>
                <label className="inline-check"><input type="checkbox" checked={attendanceEdit.attended} onChange={(e) => setAttendanceEdit({...attendanceEdit, attended:e.target.checked})}/> このライブに参戦した</label>
                <label>座席（任意）<input value={attendanceEdit.seat} onChange={(e) => setAttendanceEdit({...attendanceEdit, seat:e.target.value})}/></label>
                <label>感想（任意）<textarea value={attendanceEdit.note} onChange={(e) => setAttendanceEdit({...attendanceEdit, note:e.target.value})}/></label>
                <div className="actions"><button className="primary" disabled={busy || !online} onClick={saveAttendance}>保存</button><button onClick={() => setAttendanceEdit(null)}>キャンセル</button></div>
              </section>
            )}
            <section className="card setlist-compact">
              <h2>セットリスト</h2>
              {show.hasSavedSetlist && (
                <div className="setlist-legend" aria-label="セトリ記号の説明">
                  <span><RotateCcw size={13} aria-hidden="true" /> アンコール</span>
                  <span><Link2 size={13} aria-hidden="true" /> メドレー</span>
                  <span><Scissors size={13} aria-hidden="true" /> SHORT</span>
                  <span className="track-flag-arranged">アレンジ</span>
                </div>
              )}
              {!show.hasSavedSetlist ? (
                <p className="empty">セトリ未登録</p>
              ) : (
                effectiveEntries(data, show)?.map((entry, i) => (
                  <div className="track" key={entry.id}>
                    <span className="order">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="track-content">
                      <strong>{title(entry.songRef)}</strong>
                      {entry.note && <small className="track-note">{entry.note}</small>}
                      <span className="track-flags">
                        {entry.arrangement === "ARRANGED" && <span className="track-flag-arranged">アレンジ</span>}
                        {!isCountedPerformance(entry) && <span className="track-flag-corner">企画・披露回数対象外</span>}
                        {entry.section === "ENCORE" && (
                          <span className="track-flag" role="img" aria-label="アンコール" title="アンコール">
                            <RotateCcw size={15} aria-hidden="true" />
                          </span>
                        )}
                        {entry.medleyGroup && (
                          <span className="track-flag" role="img" aria-label="メドレー" title="メドレー">
                            <Link2 size={15} aria-hidden="true" />
                          </span>
                        )}
                        {entry.version === "SHORT" && (
                          <span className="track-flag" role="img" aria-label="SHORT" title="SHORT">
                            <Scissors size={15} aria-hidden="true" />
                          </span>
                        )}
                        {entry.version === null && (
                          <span className="track-flag" role="img" aria-label="披露バージョン未設定" title="披露バージョン未設定">
                            <CircleHelp size={15} aria-hidden="true" />
                          </span>
                        )}
                        {data.entryFacts.some(
                          (f) =>
                            f.showId === show.id &&
                            f.entryKey === entry.id &&
                            f.unpublishedBeforeShow &&
                            f.firstPerformedAtShow,
                        ) && (
                          <span className="track-flag track-flag-debut" role="img" aria-label="未発表新曲の初披露" title="未発表新曲の初披露">
                            <Sparkles size={15} aria-hidden="true" />
                          </span>
                        )}
                      </span>
                    </div>
                    {data.songMetadata.find((m) => m.songRef === entry.songRef)
                      ?.appleMusicUrl && (
                      <a
                        href={
                          data.songMetadata.find(
                            (m) => m.songRef === entry.songRef,
                          )!.appleMusicUrl!
                        }
                        target="_blank"
                        rel="noreferrer"
                      >
                        聴く
                      </a>
                    )}
                  </div>
                ))
              )}
            </section>
            <section className="card">
              <h2>参戦記録</h2>
              <p>
                {data.attendance.find((a) => a.showId === show.id)?.seat ||
                  "座席 —"}
              </p>
              <p>
                {data.attendance.find((a) => a.showId === show.id)?.note ||
                  "感想 —"}
              </p>
            </section>
            <section className="card">
              <h2>他公演との差分</h2>
              {data.shows
                .filter(
                  (s) =>
                    s.id !== show.id &&
                    s.tourId === show.tourId &&
                    s.hasSavedSetlist,
                )
                .map((s) => {
                  const current = effectiveEntries(data, show),
                    other = effectiveEntries(data, s)!;
                  return (
                    <p key={s.id}>
                      {s.date} ·{" "}
                      {current
                        ? `${
                            other
                              .filter(
                                (e) =>
                                  !current.some((x) => x.songRef === e.songRef),
                              )
                              .map((e) => title(e.songRef))
                              .join("、") || "追加曲なし"
                          }`
                        : "セトリ未登録"}
                    </p>
                  );
                })}
              {!data.shows.some(
                (s) =>
                  s.id !== show.id &&
                  s.tourId === show.tourId &&
                  s.hasSavedSetlist,
              ) && <p className="empty">比較できるセトリがありません</p>}
            </section>
          </>
        ) : (
          <>
            {tab === "HOME" && (
              <>
                <div className="page-title">
                  <h1>HOME</h1>
                  <span className="eyebrow">MY ARCHIVE</span>
                </div>
                <div className="metrics">
                  <div className="glass metric">
                    <span>ライブ数</span>
                    <strong>
                      {mine.length}
                      <small>公演</small>
                    </strong>
                  </div>
                  <div className="glass metric">
                    <span>聴いた曲</span>
                    <strong>
                      {heard.size}
                      <small>曲</small>
                    </strong>
                  </div>
                </div>
                <section>
                  <h2>最近参加したライブ</h2>
                  {latest ? (
                    <div
                      className="glass latest"
                      onClick={() => openShow(latest)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") openShow(latest);
                      }}
                    >
                      <span className="eyebrow">
                        {latest.date.replaceAll("-", ".")}
                      </span>
                      <h2>{latest.venue}</h2>
                      <p>
                        {data.tours.find((t) => t.id === latest.tourId)?.name ??
                          latest.name}
                      </p>
                      <span className="aqua">公演を見る →</span>
                    </div>
                  ) : (
                    <div className="card empty">
                      参加したライブはまだありません
                      <button onClick={() => navigate("LIVE")}>
                        ライブ一覧へ
                      </button>
                    </div>
                  )}
                </section>
                <section className="card shortcut">
                  <ChartNoAxesCombined size={22} />
                  <div>
                    <h2>楽曲ランキング</h2>
                    <p>{myStats[0] ? title(myStats[0].songRef) : "—"}</p>
                  </div>
                  <button onClick={() => navigate("ANALYSIS")}>見る →</button>
                </section>
              </>
            )}
            {tab === "LIVE" && (
              <>
                <div className="page-title"><h1>LIVE</h1><span>{liveMode === "mine" ? mine.length : data.shows.length}公演</span></div>
                <div className="segmented">
                  <button className={liveMode === "mine" ? "selected" : ""} onClick={() => {setLiveMode("mine");setLiveStatsOpen(false);}}>MY LIVE</button>
                  <button className={liveMode === "all" ? "selected" : ""} onClick={() => {setLiveMode("all");setLiveStatsOpen(false);}}>ALL LIVE</button>
                </div>
                {liveMode === "mine" ? liveStatsOpen ? (
                  <>
                    <div className="page-title live-stats-heading">
                      <h2>MY LIVE STATS</h2>
                      <button className="subtle-button" onClick={() => setLiveStatsOpen(false)}>ライブ履歴へ</button>
                    </div>
                    <div className="live-stats-period">
                      <label htmlFor="stats-period">集計期間</label>
                      <select id="stats-period" aria-label="集計期間" value={statsPeriodView.period} onChange={(e) => setStatsPeriod(e.target.value)}>
                        {statsPeriodView.years.map(y => <option value={y} key={y}>{y}年</option>)}
                        <option value="all">全期間</option>
                      </select>
                    </div>
                    <div className="live-stats-grid">
                      {[
                        ["参戦公演", liveStats.total, "公演"],
                        ["訪問会場", liveStats.venues.length, "か所"],
                        ["都道府県", liveStats.prefectures.length, "か所"],
                        ["ライブ・ツアー", liveStats.distinctTours, "件"],
                      ].map(([label, value, unit]) => (
                        <div className="glass live-stat-tile" key={label}>
                          <span>{label}</span><strong>{value}<small>{unit}</small></strong>
                        </div>
                      ))}
                    </div>
                    <section className="card live-stats-milestones">
                      <h2>{statsPeriodView.period === "all" ? "MY LIVE STORY" : statsPeriodView.period + "年のハイライト"}</h2>
                      {liveStats.total ? (
                        <div className="live-stats-milestone-grid">
                          <div><small>{statsPeriodView.period === "all" ? "初参戦" : "その年の初参戦"}</small><strong>{liveStats.firstDate}</strong></div>
                          <div><small>{statsPeriodView.period === "all" ? "最新参戦" : "その年の最終参戦"}</small><strong>{liveStats.lastDate}</strong></div>
                          {statsPeriodView.period === "all" ? (
                            <>
                              <div><small>参戦した年</small><strong>{liveStats.activeYears}年</strong></div>
                              <div><small>最多参戦年</small><strong>{liveStats.peakYear?.[0] ?? "—"} <small>{liveStats.peakYear?.[1] ?? 0}公演</small></strong></div>
                            </>
                          ) : (
                            <>
                              <div><small>最多参戦月</small><strong>{liveStats.peakMonth ? Number(liveStats.peakMonth[0].slice(5)) + "月" : "—"} <small>{liveStats.peakMonth?.[1] ?? 0}公演</small></strong></div>
                              <div><small>最多訪問会場</small><strong>{liveStats.venues[0]?.[0] ?? "—"}</strong></div>
                            </>
                          )}
                        </div>
                      ) : <p className="muted">参戦記録を追加すると、ここにライブの思い出が育っていくよ。</p>}
                    </section>
                    <section className="card live-stats-chart">
                      <h2>参戦の軌跡</h2>
                      {statsPeriodView.period === "all" ? (
                        <>
                          <p className="muted">年別の参戦数</p>
                          {allLiveStats.years.length ? (
                            <div className="live-stats-bars">
                              {[...allLiveStats.years].reverse().map(([year, count]) => {
                                const previous = allLiveStats.years.find(([y]) => y === String(Number(year) - 1));
                                const max = Math.max(1, ...allLiveStats.years.map(([, n]) => n));
                                return <div className="live-stats-bar-row" key={year}>
                                  <span>{year}</span>
                                  <div className="live-stats-bar-track"><div style={{ width: (100 * count / max) + "%" }} /></div>
                                  <strong>{count}<small>公演</small></strong>
                                  <small className="live-stats-year-delta">{previous ? "前年比 " + (count - previous[1] > 0 ? "+" : "") + (count - previous[1]) : "—"}</small>
                                </div>;
                              })}
                            </div>
                          ) : <p className="muted">参戦記録がまだありません。</p>}
                        </>
                      ) : (
                        <>
                          <p className="muted">{statsPeriodView.period}年・月別参戦数</p>
                          <div className="live-stats-month-chart" aria-label={statsPeriodView.period + "年の月別参戦数"}>
                            {Array.from({length:12}, (_,i) => {
                              const month = String(i+1).padStart(2,"0");
                              const count = liveStats.months.find(([key]) => key === statsPeriodView.period + "-" + month)?.[1] ?? 0;
                              const max = Math.max(1, ...liveStats.months.map(([,n])=>n));
                              return <div className="live-stats-month-column" key={month} title={i+1+"月: "+count+"公演"}>
                                <span className="live-stats-month-count">{count || ""}</span>
                                <div className="live-stats-month-bar-area">{count > 0 && <div className="live-stats-month-bar" style={{height:(count/max*100)+"%"}} />}</div>
                                <small>{i+1}</small>
                              </div>;
                            })}
                          </div>
                          <p className="muted">横軸：月　縦軸：参戦公演数（数字は公演数）</p>
                        </>
                      )}
                    </section>
                    <section className="card live-stats-tours">
                      <div className="live-stats-section-head">
                        <h2>ツアー参戦率</h2>
                        <span className="muted">{liveStats.tourStats.length}ツアー</span>
                      </div>
                      <p className="muted">表示期間に登録されている公演を基準に集計</p>
                      {liveStats.tourStats.slice(0, toursExpanded ? undefined : 5).map(t => (
                        <details className="live-stats-tour" key={t.id}>
                          <summary>
                            <span className="live-stats-tour-summary">
                              <strong>{t.name}</strong>
                              <span className="live-stats-progress-track">
                                <span style={{width: ((t.rate ?? 0)*100)+"%"}} />
                              </span>
                            </span>
                            <span className="live-stats-tour-rate">
                              <strong>{t.attended}/{t.total}</strong>
                              <small>{t.rate === null ? "—" : (t.rate*100).toFixed(0)+"%"}</small>
                            </span>
                          </summary>
                          <div className="live-stats-tour-shows">
                            {t.shows.map(item => (
                              <button key={item.id} className="live-stats-tour-show" onClick={() => {
                                const target = data.shows.find(s => s.id === item.id);
                                if (target) openShow(target);
                              }}>
                                <span className={item.attended ? "live-stats-attended" : "live-stats-not-attended"}>
                                  {item.attended ? <Check size={14} /> : "—"}
                                </span>
                                <span>{item.date} · {item.venue}</span>
                              </button>
                            ))}
                          </div>
                        </details>
                      ))}
                      {liveStats.tourStats.length > 5 && <button className="live-stats-more" onClick={() => setToursExpanded(v => !v)}>{toursExpanded ? "閉じる" : "すべてのツアーを見る（"+liveStats.tourStats.length+"）"}</button>}
                      {liveStats.standaloneCount > 0 && <p className="muted">ツアーに属さない公演：{liveStats.standaloneCount}公演</p>}
                      {!liveStats.tourStats.length && !liveStats.standaloneCount && <p className="muted">この期間のツアー参戦記録はまだありません。</p>}
                    </section>
                    <section className="card live-stats-venues">
                      <div className="live-stats-section-head">
                        <h2>会場ランキング</h2>
                        <span className="muted">{liveStats.venues.length}会場</span>
                      </div>
                      {liveStats.venues.slice(0, venuesExpanded ? undefined : 5).map(([venue,count], index) => {
                        const max = liveStats.venues[0]?.[1] ?? 1;
                        return <div className="live-stats-venue" key={venue}>
                          <span className="live-stats-venue-rank">{String(index+1).padStart(2,"0")}</span>
                          <div className="live-stats-venue-body">
                            <div className="live-stats-venue-title"><strong>{venue}</strong><span>{count}公演</span></div>
                            <div className="live-stats-progress-track"><span style={{width:(count/max*100)+"%"}} /></div>
                          </div>
                        </div>;
                      })}
                      {liveStats.venues.length > 5 && <button className="live-stats-more" onClick={() => setVenuesExpanded(v => !v)}>{venuesExpanded ? "閉じる" : "すべての会場を見る（"+liveStats.venues.length+"）"}</button>}
                      {!liveStats.venues.length && <p className="muted">この期間の会場記録はまだありません。</p>}
                    </section>
                    <section className="card live-stats-travel">
                      <div className="live-stats-section-head">
                        <h2>遠征マップ</h2>
                        <span className="muted">{liveStats.prefectures.length}/47 都道府県</span>
                      </div>
                      <p className="muted">訪れた都道府県をタップすると、公演を確認できるよ。</p>
                      <div className="travel-map-wrap">
                        <div className="travel-map" role="group" aria-label="都道府県の簡易配置マップ">
                          {JAPAN_PREFECTURE_LAYOUT.map(([name,col,row]) => {
                            const full = prefecture(name) ?? name;
                            const count = liveStats.prefectures.find(([p]) => p === full)?.[1] ?? 0;
                            return <button
                              key={name}
                              type="button"
                              className={"travel-map-tile "+(count>=3 ? "level-3" : count===2 ? "level-2" : count===1 ? "level-1" : "level-0")+(selectedPrefecture===full ? " is-selected" : "")}
                              style={{gridColumn:col,gridRow:row}}
                              aria-label={full+" "+count+"公演"}
                              aria-pressed={selectedPrefecture===full}
                              title={full+" · "+count+"公演"}
                              onClick={() => setSelectedPrefecture(selectedPrefecture===full ? null : full)}
                            >{name.slice(0,2)}</button>;
                          })}
                        </div>
                      </div>
                      <div className="travel-map-legend">
                        <span><i className="level-0" />未参戦</span>
                        <span><i className="level-1" />1公演</span>
                        <span><i className="level-2" />2公演</span>
                        <span><i className="level-3" />3公演以上</span>
                      </div>
                      <p className="travel-map-caption">※ 地理的な形状・距離は正確ではない簡易配置図です。</p>
                      {selectedPrefecture && (() => {
                        const regional = statsPeriodView.shows.filter(s => prefecture(s.region) === selectedPrefecture)
                          .sort((a,b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
                        return <div className="travel-map-detail">
                          <div className="live-stats-section-head">
                            <h3>{selectedPrefecture}</h3><span>{regional.length}公演</span>
                          </div>
                          {regional.length ? <div className="travel-map-shows">
                            {regional.map(s => <button className="travel-map-show" key={s.id} onClick={() => openShow(s)}>
                              <span>{s.date} · {s.venue}</span><span>›</span>
                            </button>)}
                          </div> : <p className="muted">この期間の参戦記録はありません。</p>}
                        </div>;
                      })()}
                      {liveStats.unknownPrefectures > 0 && <p className="muted">都道府県が未登録・判定できない公演：{liveStats.unknownPrefectures}公演</p>}
                    </section>
                  </>
                ) : (
                  <>
                    <div className="page-title"><h2>ライブ履歴</h2><button className="subtle-button" onClick={() => setLiveStatsOpen(true)}>MY LIVE STATS →</button></div>
                    {[...mine].sort((a,b) => b.date.localeCompare(a.date)).map(s => <section className="card live-memory" key={s.id}><ShowCard s={s} /></section>)}
                    {!mine.length && <div className="card empty">参戦したライブはまだありません<button onClick={() => setLiveMode("all")}>ALL LIVEを見る</button></div>}
                  </>
                ) : (
                  <>
                    <input className="search" aria-label="公演を検索" placeholder="ツアー名・日付・会場で検索" value={query} onChange={(e) => setQuery(e.target.value)}/>
                    {[...data.tours].sort((a,b) => b.startDate.localeCompare(a.startDate)).map(t => {
                      const list = searchShows.filter(s => s.tourId === t.id);
                      return list.length ? <section className="card tour" key={t.id}>
                        <button className="tour-title" aria-expanded={expanded === t.id} onClick={() => {const next = expanded === t.id ? null : t.id;setExpanded(next);if(next)sessionStorage.setItem("lastTour",next);}}>
                          <span><span className="eyebrow">{t.startDate.slice(0,4)} · {list.length}公演</span><strong>{t.name}</strong></span><span>{expanded === t.id ? "−" : "＋"}</span>
                        </button>
                        {expanded === t.id && [...list].sort((a,b)=>a.date.localeCompare(b.date)).map(s => <ShowCard key={s.id} s={s}/>)}
                      </section> : null;
                    })}
                    {searchShows.filter(s => !s.tourId).sort((a,b)=>b.date.localeCompare(a.date)).map(s => <section className="card" key={s.id}><ShowCard s={s}/></section>)}
                    {!searchShows.length && <p className="empty">公演がありません</p>}
                  </>
                )}
              </>
            )}
            {tab === "ANALYSIS" && (
              <>
                <div className="page-title"><h1>{songDetail ? "SONG ARCHIVE" : "ANALYSIS"}</h1>{songDetail && <button className="subtle-button" onClick={() => setSongDetail(null)}>ランキングへ</button>}</div>
                <div className="segmented">
                  <button className={scope === "mine" ? "selected" : ""} onClick={() => setScope("mine")}>参戦公演</button>
                  <button className={scope === "all" ? "selected" : ""} onClick={() => setScope("all")}>全公演</button>
                </div>
                <section className="card filters">
                  <select aria-label="年" value={year} onChange={e => setYear(e.target.value)}>
                    <option value="">すべての年</option>
                    {[...new Set(data.shows.map(s => s.date.slice(0,4)))].sort().reverse().map(y => <option key={y}>{y}</option>)}
                  </select>
                  <select aria-label="ツアー" value={tourFilter} onChange={e => setTourFilter(e.target.value)}>
                    <option value="">すべてのツアー</option>
                    {data.tours.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <select aria-label="ライブ形式" value={format} onChange={e => setFormat(e.target.value)}>
                    <option value="">すべてのライブ形式</option>
                    {["ARENA","DOME","STADIUM","FANMEETING","OTHER"].map(f => <option key={f} value={f}>{formatLabel(f)}</option>)}
                  </select>
                  <select aria-label="楽曲区分" value={category} onChange={e => setCategory(e.target.value)}>
                    <option value="">全楽曲</option><option value="ORIGINAL">オリジナル</option><option value="COVER">カバー</option><option value="UNRELEASED">未音源化</option>
                  </select>
                </section>
                {songDetail ? (() => {
                  const detail = songArchive(data, shownShows, songDetail);
                  return <>
                    <section className="glass song-hero"><p className="eyebrow">SONG ARCHIVE</p><h2>{title(songDetail)}</h2><div className="song-metrics"><span><strong>{detail.performances}</strong>披露回数</span><span><strong>{detail.shows}</strong>披露公演数</span><span><strong>{detail.rate === null ? "—" : (detail.rate*100).toFixed(1)+"%"}</strong>披露率</span></div><p>最初の記録：{detail.first ?? "—"} ／ 最新：{detail.last ?? "—"}{detail.daysSinceLast !== null && detail.daysSinceLast >= 365 ? ` ／ 最終披露から約${(detail.daysSinceLast/365.25).toFixed(1)}年` : ""}</p></section>
                    <section className="card"><h2>披露の傾向</h2><div className="stats-row"><span>FULL / SHORT</span><strong>{detail.full} / {detail.short}</strong></div><div className="stats-row"><span>メドレー内</span><strong>{detail.medley}回</strong></div><div className="stats-row"><span>平均曲順</span><strong>{detail.averageOrder === null ? "—" : detail.averageOrder.toFixed(1)+"曲目"}</strong></div><div className="stats-row"><span>オープニング</span><strong>{detail.opening}回</strong></div><div className="stats-row"><span>アンコール</span><strong>{detail.encore}回</strong></div></section>
                    <section className="card"><h2>年別の披露回数</h2>{detail.yearly.map(([y,n]) => <div className="stats-row" key={y}><span>{y}年</span><strong>{n}回 <small>FULL {detail.history.filter(h=>h.show.date.startsWith(y)&&h.entry.version==="FULL").length} / SHORT {detail.history.filter(h=>h.show.date.startsWith(y)&&h.entry.version==="SHORT").length}</small></strong></div>)}</section>
                    <section className="card"><h2>ライブ別の披露回数</h2>{detail.tours.map(([t,n]) => <div className="stats-row" key={t}><span>{t}</span><strong>{n}回</strong></div>)}</section>
                    <section className="card"><h2>披露された公演</h2>{[...detail.history].reverse().map((h,i) => <button className="history-row" key={h.show.id+":"+h.entry.id+":"+i} onClick={() => openShow(h.show)}><span><strong>{h.show.date} · {h.show.venue}</strong><small>{data.tours.find(t => t.id === h.show.tourId)?.name ?? h.show.name}</small></span><span>{h.order}/{h.total}曲目 · {h.entry.version ?? "—"}{h.entry.section === "ENCORE" ? " · アンコール" : ""}</span></button>)}{!detail.history.length && <p className="empty">対象範囲に披露記録がありません</p>}</section>
                  </>;
                })() : <>
                  <section className="card ranking">
                    <h2>楽曲ランキング</h2>
                    {stats.map((song,i) => <button className="rank-row rank-button" key={song.songRef} onClick={() => setSongDetail(song.songRef)}>
                      <span className="order">{String(i+1).padStart(2,"0")}</span><div><strong>{title(song.songRef)}</strong><small>披露 {song.performances}回 · FULL {song.full} / SHORT {song.short}</small></div><strong className="aqua">{song.shows}<small>公演</small></strong>
                    </button>)}
                    {!stats.length && <p className="empty">集計できるセトリがありません</p>}
                  </section>
                  <section className="card"><h2>レア曲分析</h2>{[...stats].filter(song=>song.rate!==null).sort((a,b)=>(a.rate??0)-(b.rate??0)).map(song=><button className="rare rare-button" key={song.songRef} onClick={()=>setSongDetail(song.songRef)}><span>{title(song.songRef)}</span><strong>{song.rate===null?"—":(song.rate*100).toFixed(1)+"%"}</strong></button>)}{!stats.length&&<p className="empty">—</p>}</section>
                  <details className="card"><summary>まだ聴いていない曲（{missing.length}曲）</summary><p className="muted">UniverseのBE:FIRST楽曲・登録済みセトリの範囲</p>{missing.map(song => <div className="stats-row" key={song.ref}>{song.title}</div>)}</details>
                </>}
              </>
            )}
            {tab === "SETTINGS" && (
              <>
                <h1>設定</h1>
                {preview && (
                  <section className="card fields trial-import">
                    <h2>初期データの試験読み込み</h2>
                    <p>曲名表示まで検証するなら「試験表示用データ（JSON）」を選んでね。通常の初期登録JSONも読み込めます。</p>
                    <p>この画面は試験専用。読み込んだ内容はブラウザーのメモリ内だけで表示し、Firestoreには一切送信しません。再読み込みでサンプルに戻ります。</p>
                    <label className="file-button">
                      <Upload size={16} /> 初期登録用JSONを選ぶ
                      <input type="file" accept="application/json,.json" disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void run(async () => {
                            if (file.size > 8000000) throw new Error("8MBを超えるJSONです");
                            const raw = JSON.parse(await file.text());
                            const data = parseBackup(JSON.stringify(raw.data ?? raw));
                            let songs: Song[] | null = null;
                            if (raw.data && raw.songs !== undefined) {
                              if (!Array.isArray(raw.songs) || raw.songs.some((x: unknown) =>
                                !x || typeof x !== "object" || typeof (x as Song).ref !== "string" ||
                                !/^[UL]:[A-Za-z0-9_-]{1,120}$/.test((x as Song).ref) ||
                                typeof (x as Song).title !== "string" ||
                                typeof (x as Song).available !== "boolean"))
                                throw new Error("試験用楽曲一覧の形式が正しくありません");
                              songs = raw.songs as Song[];
                            }
                            setTrialImport({data,songs});
                          });
                          e.target.value = "";
                        }} />
                    </label>
                    {trialImport && (() => {
                      const withSetlist = trialImport.data.shows.filter(s => s.hasSavedSetlist);
                      const rows = withSetlist.flatMap(s => effectiveEntries(trialImport.data, s) ?? []);
                      const games = rows.filter(e => e.arrangement === "ARRANGED" && !isCountedPerformance(e));
                      return (
                        <div className="restore trial-import-preview">
                          <h3>検証用データの内容</h3>
                          <div className="stats-row"><span>公演</span><strong>{trialImport.data.shows.length}件</strong></div>
                          <div className="stats-row"><span>セトリ登録済み</span><strong>{withSetlist.length}公演</strong></div>
                          <div className="stats-row"><span>セトリ表示行</span><strong>{rows.length}件</strong></div>
                          <div className="stats-row"><span>通常の披露回数に含める行</span><strong>{rows.filter(isCountedPerformance).length}件</strong></div>
                          <div className="stats-row"><span>アレンジ・披露集計対象外</span><strong>{games.length}件</strong></div>
                          <div className="stats-row"><span>曲名表示用データ</span><strong>{trialImport.songs?.length ?? 0}曲</strong></div>
                          <div className="stats-row"><span>セトリ未登録</span><strong>{trialImport.data.shows.length - withSetlist.length}公演</strong></div>
                          <p>読み込み後は「ALL LIVE」から全公演・曲順・歌割り変更ゲームを確認できるよ。試験モードでの変更は本番に反映されません。</p>
                          <div className="actions">
                            <button className="primary" disabled={busy} onClick={() => {
                              setState({ ...stateRef.current!, data: copy(trialImport.data), songs: trialImport.songs ? copy(trialImport.songs) : stateRef.current!.songs, control: {
                                ...stateRef.current!.control, revision: stateRef.current!.control.revision + 1,
                              }});
                              setTrialLoaded(true);
                              setTrialImport(null);
                              setShowId(null);
                              setSongDetail(null);
                              setLiveMode("all");
                              setTab("LIVE");
                            }}>このデータで試験表示</button>
                            <button disabled={busy} onClick={() => setTrialImport(null)}>キャンセル</button>
                          </div>
                        </div>
                      );
                    })()}
                    {trialLoaded && <button disabled={busy} onClick={() => {
                      if (!confirm("試験中の変更を破棄してサンプルに戻しますか？")) return;
                      setState(copy(fixture)); setTrialLoaded(false); setTrialImport(null);
                      setShowId(null); setSongDetail(null); setTab("HOME");
                    }}>サンプルデータに戻す</button>}
                  </section>
                )}
                <LibraryEditor
                  data={data}
                  songs={allSongs}
                  onOpenShow={openShow}
                  disabled={busy || !online}
                  onDirty={(dirty) => {
                    if (dirty) libraryBase.current = copy(stateRef.current!);
                    else libraryBase.current = null;
                    setLibraryDirty(dirty);
                  }}
                  onSave={async (next, deleted) => {
                    const base = libraryBase.current!;
                    await atomicSave(next, base, deleted);
                  }}
                />
                <section className="card fields">
                  <h2>楽曲</h2>
                  <p>
                    {state.songs.filter((s) => s.available).length}曲 ·{" "}
                    {state.syncedAt
                      ? new Date(state.syncedAt).toLocaleString("ja-JP")
                      : "未同期"}
                  </p>
                  <button
                    disabled={busy || !online || preview}
                    onClick={() =>
                      void run(async () => {
                        await invoke("syncUniverse");
                        setSyncError("");
                        await refresh();
                      })
                    }
                  >
                    <RefreshCw size={16} />
                    Universeから同期
                  </button>
                  <button
                    disabled={busy || !online}
                    onClick={() =>
                      void run(async () => {
                        const name = prompt("LIVE限定曲の曲名");
                        if (!name?.trim()) return;
                        await save("localSongs", {
                          id: crypto.randomUUID(),
                          revision: 0,
                          title: name.trim(),
                          artist: "BE:FIRST",
                        } as Dataset["localSongs"][number]);
                      })
                    }
                  >
                    LIVE限定曲を追加
                  </button>
                  {mergeCandidates(data.localSongs, state.songs).map((c) => (
                    <div key={c.localRef + c.universeRef}>
                      <p>{c.title} · 統合候補</p>
                      <button
                        disabled={preview || busy}
                        onClick={() =>
                          void run(async () => {
                            if (
                              !confirm(
                                "このLIVE限定曲のすべての参照をUniverse曲へ統合しますか？",
                              )
                            )
                              return;
                            await invoke("confirmSongMerge", {
                              ...c,
                              confirmed: true,
                              expected: {
                                datasetId: state.control.activeDatasetId,
                                revision: state.control.revision,
                              },
                            });
                            await refresh();
                          })
                        }
                      >
                        確認して統合
                      </button>
                    </div>
                  ))}
                </section>
                <section className="card fields">
                  <h2>バックアップ</h2>
                  <button
                    disabled={busy || !online}
                    onClick={() =>
                      download("be-live.json", exportJson(data))
                    }
                  >
                    <Download size={16} />
                    JSONを書き出す
                  </button>
                  <button disabled={busy || !online} onClick={() => download("be-live-shows.csv", exportShowsCsv(data), "text/csv;charset=utf-8")}><Download size={16}/> 公演・参戦記録をCSVで書き出す</button>
                  <label className="file-button">
                    <Upload size={16} />
                    JSONから復元
                    <input
                      type="file"
                      accept="application/json,.json"
                      disabled={busy || !online}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void run(async () => {
                            if (file.size > 8000000)
                              throw new Error("8MBを超えるバックアップです");
                            setBackup(parseBackup(await file.text()));
                          });
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {backup && (
                    <div className="restore">
                      <p>
                        公演 {backup.shows.length}件 / 基本セトリ{" "}
                        {backup.templates.length}件 / 参戦{" "}
                        {backup.attendance.filter((x) => x.attended).length}件
                      </p>
                      <p>現在のLIVEデータを全件置換します。</p>
                      <button
                        className="primary"
                        disabled={busy || !online}
                        onClick={() =>
                          void run(async () => {
                            if (
                              !confirm(
                                "内容を確認しました。現在のデータを全件置換しますか？",
                              )
                            )
                              return;
                            if (preview) {
                              setState({ ...state, data: backup });
                            } else {
                              await invoke("restoreBackup", {
                                data: backup,
                                expected: {
                                  datasetId: state.control.activeDatasetId,
                                  revision: state.control.revision,
                                },
                                confirmed: true,
                              });
                              await refresh();
                            }
                            setBackup(null);
                          })
                        }
                      >
                        確認して復元
                      </button>
                      <button onClick={() => setBackup(null)}>
                        キャンセル
                      </button>
                    </div>
                  )}
                  <button
                    disabled={
                      !state.control.previousDatasetId ||
                      busy ||
                      preview ||
                      !online
                    }
                    onClick={() =>
                      void run(async () => {
                        if (
                          !confirm(
                            "復元後に編集した内容は失われます。直前のデータへ戻しますか？",
                          )
                        )
                          return;
                        await invoke("rollbackRestore", {
                          expected: {
                            datasetId: state.control.activeDatasetId,
                            revision: state.control.revision,
                          },
                          confirmedLossOfEdits: true,
                        });
                        await refresh();
                      })
                    }
                  >
                    復元前に戻す
                  </button>
                </section>
                <button
                  disabled={busy || dirty}
                  onClick={() => void run(logout)}
                >
                  <LogOut size={16} />
                  ログアウト
                </button>
              </>
            )}
          </>
        )}
      </main>
      <nav aria-label="メインナビゲーション">
        {tabs.map(([name, Icon]) => (
          <button
            key={name}
            className={tab === name ? "active" : ""}
            onClick={() => navigate(name)}
          >
            <Icon size={21} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
