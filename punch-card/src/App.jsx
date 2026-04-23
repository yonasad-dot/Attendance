import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, update, serverTimestamp } from "firebase/database";

// ─────────────────────────────────────────────────────────────────────────────
// 🔥 FIREBASE CONFIG
// Replace these values with your own Firebase project config.
// How to get them:
//   1. Go to https://console.firebase.google.com
//   2. Create a new project (free)
//   3. Add a Web app
//   4. Copy the firebaseConfig object here
//   5. In Firebase console → Realtime Database → Create database (start in test mode)
// ─────────────────────────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyDwDsKhaGBS-lGXcAgm3tZXriMfjAE9XWU",
  authDomain:        "punch-card-9763d.firebaseapp.com",
  databaseURL:       "https://punch-card-9763d-default-rtdb.firebaseio.com",
  projectId:         "punch-card-9763d",
  storageBucket:     "punch-card-9763d.firebasestorage.app",
  messagingSenderId: "206611110812",
  appId:             "1:206611110812:web:fa60ce551595488578c659",
  measurementId: "G-Y0PYFXVCY9",
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getDatabase(firebaseApp);

// ─── Constants ───────────────────────────────────────────────────────────────
const START = new Date("2026-04-16");
const END   = new Date("2026-07-18");
const DAYS  = [];
for (let d = new Date(START); d <= END; d.setDate(d.getDate() + 1)) DAYS.push(new Date(d));

const DOW    = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const SEED = {
  0: { timeIn:"18:00",           timeOut:"00:00",   status:"😁", qs:"100",  notes:"",                             yonas:"",           rahel:"" },
  1: { timeIn:"18:00",           timeOut:"forfeit",  status:"😭", qs:"<100", notes:"100 questions overdue",         yonas:"",           rahel:"" },
  2: { timeIn:"Weekend mornings",timeOut:"forfeit",  status:"😭", qs:"<100", notes:"What's wrong with you, dummy?", yonas:"100 overdue",rahel:"20 questions overdue" },
  3: { timeIn:"Weekend mornings",timeOut:"forfeit",  status:"😭", qs:"<100", notes:"Still not making a progress?",  yonas:"40 overdue", rahel:"✅" },
  4: { timeIn:"18:00",           timeOut:"23:00",   status:"😭", qs:"<100", notes:"",                             yonas:"",           rahel:"" },
};

const PRESENCE_TTL = 10000; // 10 seconds

// ─── Helpers ─────────────────────────────────────────────────────────────────
function fmtDate(d)   { return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`; }
function isWeekend(d) { return d.getDay() === 0 || d.getDay() === 6; }
function isToday(d)   { return d.toDateString() === new Date().toDateString(); }
function fmt12(t) {
  if (!t || t === "forfeit" || t === "Weekend mornings") return t;
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}
function buildInitial() {
  const obj = {};
  DAYS.forEach((_, i) => { obj[i] = SEED[i] ?? null; });
  return obj;
}

// ─── Styles ──────────────────────────────────────────────────────────────────
const globalCss = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg:#0d0f14; --surface:#161923; --surface2:#1e2330; --border:#2a3045;
    --accent:#e8c872; --accent2:#7eb8f7; --success:#6fcf97; --danger:#eb5757;
    --text:#e8eaf0; --muted:#6b7280; --yonas:#7eb8f7; --rahel:#f7a07e;
  }
  html, body { background:var(--bg); color:var(--text); font-family:'DM Sans',sans-serif; min-height:100vh; }
  @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes modalIn { from{opacity:0;transform:translateY(-10px) scale(0.97)} to{opacity:1;transform:none} }
  ::-webkit-scrollbar { width:5px; height:5px; }
  ::-webkit-scrollbar-track { background:var(--bg); }
  ::-webkit-scrollbar-thumb { background:var(--border); border-radius:99px; }
`;

// ─── Main Component ───────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser]               = useState(null);
  const [data, setData]               = useState(buildInitial());
  const [filter, setFilter]           = useState("all");
  const [editIdx, setEditIdx]         = useState(null);
  const [form, setForm]               = useState({});
  const [syncState, setSyncState]     = useState("connecting"); // connecting | live | saving | saved | error
  const [presence, setPresence]       = useState({});
  const [remoteEditing, setRemoteEditing] = useState({});
  const [conflictWarn, setConflictWarn]   = useState(false);
  const [initialized, setInitialized]    = useState(false);
  const sessionId = useRef(`${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const presenceInterval = useRef(null);

  // ── Wire up Firebase live listener once user picks identity ──
  useEffect(() => {
    if (!user) return;

    setSyncState("connecting");

    // Listen to attendance data
    const dataRef = ref(db, "attendance");
    const unsub = onValue(dataRef, (snap) => {
      const val = snap.val();
      if (val) {
        setData(val);
      } else {
        // First ever load — seed the database
        set(dataRef, buildInitial());
      }
      setSyncState("live");
      setInitialized(true);
    }, (err) => {
      console.error(err);
      setSyncState("error");
    });

    // Listen to presence
    const presRef = ref(db, "presence");
    const unsubPres = onValue(presRef, (snap) => {
      const val = snap.val() || {};
      const now = Date.now();
      const alive = {};
      Object.entries(val).forEach(([k, v]) => {
        if (now - v.ts < PRESENCE_TTL) alive[k] = v;
      });
      setPresence(alive);

      // Extract who is editing which row (from other user)
      const editing = {};
      Object.entries(val).forEach(([u, v]) => {
        if (u !== user && v.editingIdx != null && now - v.ts < PRESENCE_TTL) {
          editing[v.editingIdx] = u;
        }
      });
      setRemoteEditing(editing);
    });

    // Heartbeat presence every 4s
    const pingPresence = (editingIdx = null) => {
      const presUserRef = ref(db, `presence/${user}`);
      set(presUserRef, { ts: Date.now(), session: sessionId.current, editingIdx });
    };
    pingPresence();
    presenceInterval.current = setInterval(() => pingPresence(), 4000);

    return () => {
      unsub();
      unsubPres();
      clearInterval(presenceInterval.current);
      // Clear own presence on unmount
      set(ref(db, `presence/${user}`), null);
    };
  }, [user]);

  // ── Save a single day record ──
  const saveRecord = useCallback(async (idx, rec) => {
    setSyncState("saving");
    try {
      await set(ref(db, `attendance/${idx}`), rec);
      setSyncState("saved");
      setTimeout(() => setSyncState("live"), 2000);
    } catch (e) {
      console.error(e);
      setSyncState("error");
    }
  }, []);

  // ── Presence: announce editing row ──
  const announceEditing = useCallback((idx) => {
    set(ref(db, `presence/${user}`), {
      ts: Date.now(), session: sessionId.current, editingIdx: idx,
    });
  }, [user]);

  const clearEditingPresence = useCallback(() => {
    set(ref(db, `presence/${user}`), {
      ts: Date.now(), session: sessionId.current, editingIdx: null,
    });
  }, [user]);

  // ── Stats ──
  const stats = (() => {
    let present = 0, absent = 0, totalQ = 0, totalMin = 0;
    const today = new Date();
    DAYS.forEach((d, i) => {
      if (d > today) return;
      const rec = data[i];
      if (!rec) { absent++; return; }
      if (rec.status === "😁" || rec.status === "😭") present++; else absent++;
      if (rec.qs === "100") totalQ += 100;
      if (rec.timeIn && rec.timeOut && rec.timeIn !== "Weekend mornings" && rec.timeOut !== "forfeit") {
        const [ih, im] = rec.timeIn.split(":").map(Number);
        const [oh, om] = rec.timeOut.split(":").map(Number);
        let diff = (oh * 60 + om) - (ih * 60 + im);
        if (diff < 0) diff += 1440;
        totalMin += diff;
      }
    });
    const daysPassed = DAYS.filter(d => d <= today).length;
    const pct = Math.round((daysPassed / DAYS.length) * 100);
    return { present, absent, totalQ, hrs: Math.floor(totalMin / 60), mins: totalMin % 60, daysPassed, pct };
  })();

  // ── Modal open/close ──
  const openModal = (idx) => {
    const rec = data[idx] || {};
    setForm({
      status:  rec.timeOut === "forfeit" ? "forfeit" : (rec.status || ""),
      timeIn:  (rec.timeIn  && rec.timeIn  !== "Weekend mornings") ? rec.timeIn  : "",
      timeOut: (rec.timeOut && rec.timeOut !== "forfeit")           ? rec.timeOut : "",
      qs:      rec.qs    || "",
      notes:   rec.notes || "",
      yonas:   rec.yonas || "",
      rahel:   rec.rahel || "",
    });
    setConflictWarn(false);
    setEditIdx(idx);
    announceEditing(idx);
  };

  const closeModal = () => {
    clearEditingPresence();
    setEditIdx(null);
    setConflictWarn(false);
  };

  const handleSave = async () => {
    if (editIdx === null) return;
    const rec = {
      timeIn:  form.timeIn || (isWeekend(DAYS[editIdx]) ? "Weekend mornings" : ""),
      timeOut: form.status === "forfeit" ? "forfeit" : form.timeOut,
      status:  form.status !== "forfeit" ? form.status : "😭",
      qs:      form.qs,
      notes:   form.notes,
      yonas:   form.yonas,
      rahel:   form.rahel,
    };
    const isEmpty = !rec.timeIn && !rec.timeOut && !rec.status && !rec.qs && !rec.notes && !rec.yonas && !rec.rahel;
    await saveRecord(editIdx, isEmpty ? null : rec);
    clearEditingPresence();
    setEditIdx(null);
    setConflictWarn(false);
  };

  const handleClear = async () => {
    if (editIdx === null) return;
    await saveRecord(editIdx, null);
    clearEditingPresence();
    setEditIdx(null);
  };

  // ── Filtered rows ──
  const filteredRows = DAYS.map((d, i) => ({ d, i })).filter(({ d, i }) => {
    const rec = data[i];
    const today = new Date();
    if (filter === "logged"  && !rec)            return false;
    if (filter === "pending" && (rec || d > today)) return false;
    if (filter === "weekday" && isWeekend(d))    return false;
    if (filter === "weekend" && !isWeekend(d))   return false;
    return true;
  });

  const onlineUsers = Object.entries(presence)
    .filter(([, v]) => Date.now() - v.ts < PRESENCE_TTL)
    .map(([k]) => k);

  // ── Identity screen ──
  if (!user) return (
    <>
      <style>{globalCss}</style>
      <div style={S.identityScreen}>
        <div style={S.identityCard}>
          <h1 style={S.idH1}>Step 2 | 3 Punch Card</h1>
          <div style={S.idSub}>APR 16 – JUL 18, 2026</div>
          <div style={S.idWhoLabel}>Who are you?</div>
          <div style={S.idBtns}>
            {["yonas","rahel"].map(u => (
              <button key={u} style={S.idBtn} onMouseEnter={e => {
                e.currentTarget.style.borderColor = u === "yonas" ? "var(--yonas)" : "var(--rahel)";
                e.currentTarget.style.color = u === "yonas" ? "var(--yonas)" : "var(--rahel)";
                e.currentTarget.style.transform = "translateY(-2px)";
              }} onMouseLeave={e => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.color = "var(--text)";
                e.currentTarget.style.transform = "none";
              }} onClick={() => setUser(u)}>
                {u === "yonas" ? "Yonas" : "Rahel"}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );

  // ── Main app ──
  const syncColor = syncState === "saving" ? "var(--accent)" : syncState === "error" ? "var(--danger)" : syncState === "connecting" ? "var(--muted)" : "var(--success)";
  const syncIcon  = syncState === "saving" ? "⟳" : syncState === "saved" ? "✓" : syncState === "error" ? "✗" : syncState === "connecting" ? "…" : "●";
  const syncLabel = syncState === "saving" ? "saving" : syncState === "saved" ? "saved" : syncState === "error" ? "error" : syncState === "connecting" ? "connecting" : "live";

  return (
    <>
      <style>{globalCss}</style>
      <div style={{ minHeight:"100vh", background:"var(--bg)" }}>

        {/* ── HEADER ── */}
        <div style={S.header}>
          <div style={S.headerInner}>
            <div>
              <h1 style={S.h1}>Step 2 | 3 Punch Card</h1>
              <div style={S.subtitle}>APR 16 – JUL 18, 2026 · YONAS &amp; RAHEL</div>
            </div>
            <div style={S.headerRight}>
              {/* Presence pill */}
              <div style={S.presencePill}>
                {onlineUsers.length === 0
                  ? <span style={{ color:"var(--muted)" }}>no one online</span>
                  : onlineUsers.map(u => (
                    <span key={u} style={{ display:"flex", alignItems:"center", gap:5 }}>
                      <span style={{ ...S.dot, background: u==="yonas"?"var(--yonas)":"var(--rahel)", boxShadow:`0 0 6px ${u==="yonas"?"var(--yonas)":"var(--rahel)"}` }} />
                      <span style={{ color: u==="yonas"?"var(--yonas)":"var(--rahel)" }}>{u==="yonas"?"Yonas":"Rahel"}</span>
                    </span>
                  ))
                }
              </div>
              {/* Sync */}
              <div style={{ ...S.syncBadge, color: syncColor }}>
                <span style={syncState==="saving"?{display:"inline-block",animation:"spin 1s linear infinite"}:{}}>{syncIcon}</span>
                {syncLabel}
              </div>
              {/* You badge */}
              <div style={{ ...S.youBadge, ...(user==="yonas" ? S.youBadgeY : S.youBadgeR) }}>
                You: {user==="yonas"?"Yonas":"Rahel"}
              </div>
              <button style={S.switchBtn} onClick={() => setUser(null)}
                onMouseEnter={e=>e.currentTarget.style.color="var(--text)"}
                onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>
                switch
              </button>
            </div>
          </div>

          {/* Stats */}
          <div style={S.statsRow}>
            {[
              { val: stats.present, lbl: "Present", color: "var(--accent)" },
              { val: stats.absent,  lbl: "Missed",  color: "var(--danger)" },
              { val: stats.totalQ,  lbl: "Qs Done", color: "var(--accent2)" },
              { val: `${stats.hrs}h${stats.mins>0?stats.mins+"m":""}`, lbl: "Hours", color: "var(--accent)" },
              { val: stats.daysPassed, lbl: "Days In", color: "var(--muted)" },
            ].map(({ val, lbl, color }) => (
              <div key={lbl} style={S.stat}>
                <div style={{ ...S.statVal, color }}>{val}</div>
                <div style={S.statLbl}>{lbl}</div>
              </div>
            ))}
          </div>

          {/* Progress */}
          <div style={S.progressWrap}>
            <div style={S.progressLabel}>
              <span>Day {stats.daysPassed} of {DAYS.length}</span>
              <span>{stats.pct}%</span>
            </div>
            <div style={S.progressTrack}>
              <div style={{ ...S.progressFill, width: `${stats.pct}%` }} />
            </div>
          </div>
        </div>

        {/* ── MAIN ── */}
        <div style={S.main}>
          {/* Filters */}
          <div style={S.controls}>
            <span style={S.clabel}>Filter:</span>
            {[["all","All days"],["logged","Logged"],["pending","Pending"],["weekday","Weekdays"],["weekend","Weekends"]].map(([f, label]) => (
              <button key={f} style={filter===f ? {...S.chip,...S.chipActive} : S.chip}
                onClick={() => setFilter(f)}
                onMouseEnter={e=>{ if(filter!==f){ e.currentTarget.style.borderColor="var(--accent)"; e.currentTarget.style.color="var(--text)"; }}}
                onMouseLeave={e=>{ if(filter!==f){ e.currentTarget.style.borderColor="var(--border)"; e.currentTarget.style.color="var(--muted)"; }}}>
                {label}
              </button>
            ))}
          </div>
          <div style={S.hint}>Click any row to log or edit · Changes sync live with {user==="yonas"?"Rahel":"Yonas"}</div>

          {/* Table */}
          <div style={S.tableWrap}>
            {!initialized
              ? <div style={{ padding:"40px", textAlign:"center", color:"var(--muted)", fontFamily:"'DM Mono',monospace", fontSize:"0.8rem" }}>Connecting to database…</div>
              : <table style={S.table}>
                  <thead>
                    <tr>
                      {["#","Date","Day","Time In (PST)","Time Out","Status","Qs","Notes"].map(h => (
                        <th key={h} style={S.th}>{h}</th>
                      ))}
                      <th style={{...S.th, color:"var(--yonas)"}}>Yonas Inbox</th>
                      <th style={{...S.th, color:"var(--rahel)"}}>Rahel Inbox</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRows.map(({ d, i }) => {
                      const rec = data[i];
                      const todayRow = isToday(d);
                      const weekend  = isWeekend(d);
                      const editingUser = remoteEditing[i];

                      return (
                        <tr key={i}
                          style={{ ...S.tr, ...(todayRow ? S.trToday : {}), ...(weekend ? S.trWeekend : {}) }}
                          onMouseEnter={e => e.currentTarget.style.background = "var(--surface2)"}
                          onMouseLeave={e => e.currentTarget.style.background = todayRow ? "rgba(232,200,114,0.05)" : "transparent"}
                          onClick={() => openModal(i)}>
                          <td style={{...S.td,...S.tdNum}}>{i+1}</td>
                          <td style={{...S.td,...S.tdDate}}>
                            {fmtDate(d)}
                            {todayRow && <span style={S.todayBadge}>TODAY</span>}
                            {editingUser && (
                              <span title={`${editingUser==="yonas"?"Yonas":"Rahel"} is editing`}
                                style={{ ...S.editingDot, background: editingUser==="yonas"?"var(--yonas)":"var(--rahel)" }} />
                            )}
                          </td>
                          <td style={{...S.td,...S.tdDay}}>{DOW[d.getDay()]}</td>
                          <td style={{...S.td,...S.tdMono}}>{rec?.timeIn ? fmt12(rec.timeIn) : <span style={S.empty}>—</span>}</td>
                          <td style={{...S.td,...S.tdMono}}>{rec?.timeOut ? (rec.timeOut==="forfeit"?"—":fmt12(rec.timeOut)) : <span style={S.empty}>—</span>}</td>
                          <td style={{...S.td, textAlign:"center", fontSize:"1.05rem"}}>
                            {rec
                              ? rec.timeOut==="forfeit"
                                ? <span style={S.forfeit}>FORFEIT</span>
                                : <span>{rec.status}</span>
                              : <span style={S.empty}>—</span>}
                          </td>
                          <td style={{...S.td,...S.tdMono, textAlign:"right"}}>{rec?.qs || <span style={S.empty}>—</span>}</td>
                          <td style={{...S.td,...S.tdNotes}}>{rec?.notes || <span style={S.empty}>—</span>}</td>
                          <td style={{...S.td,...S.tdInbox, color:"var(--yonas)"}}>{rec?.yonas || <span style={S.empty}>—</span>}</td>
                          <td style={{...S.td,...S.tdInbox, color:"var(--rahel)"}}>{rec?.rahel || <span style={S.empty}>—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
            }
          </div>
        </div>

        {/* ── MODAL ── */}
        {editIdx !== null && (
          <div style={S.overlay} onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
            <div style={S.modal}>
              <div style={S.modalHead}>
                <div>
                  <h2 style={{ fontFamily:"'DM Serif Display',serif", fontSize:"1.25rem", color:"var(--accent)" }}>Day {editIdx+1}</h2>
                  <div style={{ fontFamily:"'DM Mono',monospace", fontSize:"0.73rem", color:"var(--muted)" }}>
                    {DOW[DAYS[editIdx].getDay()]}, {fmtDate(DAYS[editIdx])}
                  </div>
                </div>
                <button style={S.closeBtn} onClick={closeModal}
                  onMouseEnter={e=>e.currentTarget.style.color="var(--text)"}
                  onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>✕</button>
              </div>

              {conflictWarn && (
                <div style={S.conflictBanner}>⚠ Someone edited this sheet while you had it open.</div>
              )}

              <div style={S.formGrid}>
                {/* Status */}
                <div style={{...S.field, gridColumn:"1/-1"}}>
                  <label style={S.fieldLabel}>Status</label>
                  <div style={{ display:"flex", gap:8 }}>
                    {[["😁","😁 Present"],["😭","😭 Late/Short"],["forfeit","🚫 Forfeit"]].map(([v, label]) => (
                      <button key={v} style={form.status===v ? {...S.sbtn,...S.sbtnSel} : S.sbtn}
                        onClick={() => setForm(f => ({ ...f, status: v }))}>{label}</button>
                    ))}
                  </div>
                </div>
                {/* Time In */}
                <div style={S.field}>
                  <label style={S.fieldLabel}>Time In (PST)</label>
                  <input style={S.input} type="time" value={form.timeIn||""} onChange={e=>setForm(f=>({...f,timeIn:e.target.value}))} />
                </div>
                {/* Time Out */}
                <div style={S.field}>
                  <label style={S.fieldLabel}>Time Out</label>
                  <input style={S.input} type="time" value={form.timeOut||""} onChange={e=>setForm(f=>({...f,timeOut:e.target.value}))} />
                </div>
                {/* Qs */}
                <div style={S.field}>
                  <label style={S.fieldLabel}>Number of Qs</label>
                  <select style={S.input} value={form.qs||""} onChange={e=>setForm(f=>({...f,qs:e.target.value}))}>
                    <option value="">—</option>
                    <option value="100">100</option>
                    <option value="<100">&lt;100</option>
                  </select>
                </div>
                <div style={S.field} />
                {/* Notes */}
                <div style={{...S.field, gridColumn:"1/-1"}}>
                  <label style={S.fieldLabel}>Notes</label>
                  <textarea style={{...S.input, minHeight:54, resize:"vertical", fontFamily:"'DM Sans',sans-serif"}}
                    value={form.notes||""} onChange={e=>setForm(f=>({...f,notes:e.target.value}))} placeholder="General notes…" />
                </div>
                {/* Yonas inbox */}
                <div style={{...S.field, gridColumn:"1/-1"}}>
                  <label style={{...S.fieldLabel, color:"var(--yonas)"}}>Yonas Inbox</label>
                  <textarea style={{...S.input, minHeight:54, resize:"vertical", fontFamily:"'DM Sans',sans-serif"}}
                    value={form.yonas||""} onChange={e=>setForm(f=>({...f,yonas:e.target.value}))} placeholder="Yonas's notes…" />
                </div>
                {/* Rahel inbox */}
                <div style={{...S.field, gridColumn:"1/-1"}}>
                  <label style={{...S.fieldLabel, color:"var(--rahel)"}}>Rahel Inbox</label>
                  <textarea style={{...S.input, minHeight:54, resize:"vertical", fontFamily:"'DM Sans',sans-serif"}}
                    value={form.rahel||""} onChange={e=>setForm(f=>({...f,rahel:e.target.value}))} placeholder="Rahel's notes…" />
                </div>
              </div>

              <div style={S.modalFoot}>
                <button style={S.btnGhost} onClick={handleClear}
                  onMouseEnter={e=>e.currentTarget.style.color="var(--text)"}
                  onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>Clear</button>
                <button style={S.btnGhost} onClick={closeModal}
                  onMouseEnter={e=>e.currentTarget.style.color="var(--text)"}
                  onMouseLeave={e=>e.currentTarget.style.color="var(--muted)"}>Cancel</button>
                <button style={S.btnPrimary} onClick={handleSave}
                  onMouseEnter={e=>e.currentTarget.style.background="#f0d48a"}
                  onMouseLeave={e=>e.currentTarget.style.background="var(--accent)"}>Save</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─── Style objects ────────────────────────────────────────────────────────────
const S = {
  identityScreen: { minHeight:"100vh", display:"flex", alignItems:"center", justifyContent:"center", background:"radial-gradient(ellipse at 50% 30%, #1a1f2e 0%, #0d0f14 70%)" },
  identityCard:   { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:20, padding:"44px 48px", textAlign:"center", maxWidth:400, width:"90vw", boxShadow:"0 32px 80px rgba(0,0,0,0.6)" },
  idH1:           { fontFamily:"'DM Serif Display',serif", fontSize:"1.9rem", color:"var(--accent)", marginBottom:6 },
  idSub:          { fontFamily:"'DM Mono',monospace", fontSize:"0.72rem", color:"var(--muted)", letterSpacing:"0.07em", marginBottom:32 },
  idWhoLabel:     { fontSize:"0.75rem", color:"var(--muted)", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.07em", marginBottom:14 },
  idBtns:         { display:"flex", gap:12 },
  idBtn:          { flex:1, padding:14, borderRadius:12, border:"2px solid var(--border)", background:"var(--surface2)", color:"var(--text)", fontFamily:"'DM Serif Display',serif", fontSize:"1.15rem", cursor:"pointer", transition:"all 0.18s" },
  header:         { background:"linear-gradient(135deg,#0d0f14 0%,#161923 100%)", borderBottom:"1px solid var(--border)", padding:"22px 32px 18px", position:"sticky", top:0, zIndex:100, backdropFilter:"blur(12px)" },
  headerInner:    { maxWidth:1200, margin:"0 auto", display:"flex", alignItems:"flex-end", justifyContent:"space-between", flexWrap:"wrap", gap:14 },
  h1:             { fontFamily:"'DM Serif Display',serif", fontSize:"1.9rem", color:"var(--accent)", letterSpacing:"-0.5px", lineHeight:1 },
  subtitle:       { fontSize:"0.76rem", color:"var(--muted)", fontFamily:"'DM Mono',monospace", marginTop:4, letterSpacing:"0.05em" },
  headerRight:    { display:"flex", alignItems:"center", gap:14, flexWrap:"wrap" },
  presencePill:   { display:"flex", alignItems:"center", gap:8, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:99, padding:"6px 14px", fontFamily:"'DM Mono',monospace", fontSize:"0.72rem" },
  dot:            { width:7, height:7, borderRadius:"50%", display:"inline-block", animation:"pulse 2s infinite" },
  syncBadge:      { fontFamily:"'DM Mono',monospace", fontSize:"0.68rem", display:"flex", alignItems:"center", gap:5 },
  youBadge:       { padding:"5px 12px", borderRadius:99, fontFamily:"'DM Mono',monospace", fontSize:"0.7rem", fontWeight:500, textTransform:"uppercase", letterSpacing:"0.05em" },
  youBadgeY:      { background:"rgba(126,184,247,0.15)", color:"var(--yonas)", border:"1px solid rgba(126,184,247,0.3)" },
  youBadgeR:      { background:"rgba(247,160,126,0.15)", color:"var(--rahel)", border:"1px solid rgba(247,160,126,0.3)" },
  switchBtn:      { padding:"5px 12px", borderRadius:99, fontFamily:"'DM Mono',monospace", fontSize:"0.7rem", background:"var(--surface2)", border:"1px solid var(--border)", color:"var(--muted)", cursor:"pointer", transition:"color 0.15s" },
  statsRow:       { maxWidth:1200, margin:"14px auto 0", padding:"0 32px", display:"flex", gap:14, flexWrap:"wrap" },
  stat:           { textAlign:"center", background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:10, padding:"8px 16px", minWidth:72 },
  statVal:        { fontFamily:"'DM Mono',monospace", fontSize:"1.3rem", fontWeight:500, lineHeight:1 },
  statLbl:        { fontSize:"0.64rem", color:"var(--muted)", marginTop:3, textTransform:"uppercase", letterSpacing:"0.06em" },
  progressWrap:   { maxWidth:1200, margin:"16px auto 0", padding:"0 32px" },
  progressLabel:  { display:"flex", justifyContent:"space-between", fontSize:"0.7rem", color:"var(--muted)", fontFamily:"'DM Mono',monospace", marginBottom:5 },
  progressTrack:  { height:5, background:"var(--surface2)", borderRadius:99, overflow:"hidden" },
  progressFill:   { height:"100%", background:"linear-gradient(90deg,var(--accent),var(--accent2))", borderRadius:99, transition:"width 0.6s ease" },
  main:           { maxWidth:1200, margin:"0 auto", padding:"24px 32px 60px" },
  controls:       { display:"flex", gap:8, marginBottom:20, flexWrap:"wrap", alignItems:"center" },
  clabel:         { fontSize:"0.72rem", color:"var(--muted)", fontFamily:"'DM Mono',monospace", textTransform:"uppercase", letterSpacing:"0.06em" },
  chip:           { padding:"5px 13px", borderRadius:99, border:"1px solid var(--border)", background:"var(--surface)", color:"var(--muted)", fontSize:"0.75rem", fontFamily:"'DM Mono',monospace", cursor:"pointer", transition:"all 0.15s" },
  chipActive:     { background:"var(--accent)", color:"#0d0f14", borderColor:"var(--accent)", fontWeight:600 },
  hint:           { fontSize:"0.71rem", color:"var(--muted)", fontFamily:"'DM Mono',monospace", marginBottom:10 },
  tableWrap:      { overflowX:"auto", borderRadius:14, border:"1px solid var(--border)" },
  table:          { width:"100%", borderCollapse:"collapse", fontSize:"0.84rem" },
  th:             { background:"var(--surface2)", padding:"12px 14px", textAlign:"left", fontFamily:"'DM Mono',monospace", fontSize:"0.67rem", textTransform:"uppercase", letterSpacing:"0.08em", color:"var(--muted)", borderBottom:"1px solid var(--border)", whiteSpace:"nowrap", fontWeight:500 },
  tr:             { borderBottom:"1px solid var(--border)", cursor:"pointer", transition:"background 0.1s" },
  trToday:        { background:"rgba(232,200,114,0.05)", borderLeft:"3px solid var(--accent)" },
  trWeekend:      { opacity:0.65 },
  td:             { padding:"10px 14px", verticalAlign:"middle", whiteSpace:"nowrap" },
  tdNum:          { fontFamily:"'DM Mono',monospace", color:"var(--muted)", fontSize:"0.73rem" },
  tdDate:         { fontWeight:500 },
  tdDay:          { color:"var(--muted)", fontSize:"0.78rem" },
  tdMono:         { fontFamily:"'DM Mono',monospace", fontSize:"0.78rem" },
  tdNotes:        { color:"var(--muted)", fontSize:"0.78rem", maxWidth:180, overflow:"hidden", textOverflow:"ellipsis" },
  tdInbox:        { fontSize:"0.76rem", maxWidth:130, overflow:"hidden", textOverflow:"ellipsis" },
  todayBadge:     { background:"var(--accent)", color:"#0d0f14", fontSize:"0.58rem", fontFamily:"'DM Mono',monospace", fontWeight:700, padding:"2px 6px", borderRadius:99, verticalAlign:"middle", marginLeft:6, letterSpacing:"0.04em" },
  editingDot:     { width:7, height:7, borderRadius:"50%", display:"inline-block", marginLeft:6, verticalAlign:"middle", animation:"pulse 1.5s infinite" },
  empty:          { color:"var(--border)", fontFamily:"'DM Mono',monospace" },
  forfeit:        { color:"var(--danger)", fontFamily:"'DM Mono',monospace", fontSize:"0.68rem", fontWeight:600, letterSpacing:"0.04em" },
  overlay:        { position:"fixed", inset:0, background:"rgba(0,0,0,0.72)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", backdropFilter:"blur(5px)" },
  modal:          { background:"var(--surface)", border:"1px solid var(--border)", borderRadius:18, width:540, maxWidth:"96vw", padding:28, boxShadow:"0 28px 70px rgba(0,0,0,0.55)", animation:"modalIn 0.18s ease" },
  modalHead:      { display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:20 },
  closeBtn:       { background:"none", border:"none", color:"var(--muted)", fontSize:"1.2rem", cursor:"pointer", padding:4, transition:"color 0.15s", lineHeight:1 },
  conflictBanner: { background:"rgba(235,87,87,0.1)", border:"1px solid rgba(235,87,87,0.3)", borderRadius:8, padding:"8px 12px", fontSize:"0.76rem", color:"var(--danger)", fontFamily:"'DM Mono',monospace", marginBottom:12 },
  formGrid:       { display:"grid", gridTemplateColumns:"1fr 1fr", gap:13 },
  field:          { display:"flex", flexDirection:"column", gap:5 },
  fieldLabel:     { fontSize:"0.69rem", textTransform:"uppercase", letterSpacing:"0.07em", color:"var(--muted)", fontFamily:"'DM Mono',monospace" },
  input:          { background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8, color:"var(--text)", fontFamily:"'DM Mono',monospace", fontSize:"0.83rem", padding:"8px 11px", outline:"none", width:"100%" },
  sbtn:           { flex:1, background:"var(--surface2)", border:"1px solid var(--border)", borderRadius:8, color:"var(--text)", fontSize:"0.8rem", padding:"8px 4px", cursor:"pointer", transition:"all 0.15s", textAlign:"center" },
  sbtnSel:        { borderColor:"var(--accent)", background:"rgba(232,200,114,0.1)" },
  modalFoot:      { display:"flex", justifyContent:"flex-end", gap:9, marginTop:20, paddingTop:16, borderTop:"1px solid var(--border)" },
  btnGhost:       { padding:"8px 20px", borderRadius:8, fontSize:"0.83rem", fontWeight:500, cursor:"pointer", border:"1px solid var(--border)", background:"transparent", color:"var(--muted)", transition:"all 0.15s", fontFamily:"'DM Sans',sans-serif" },
  btnPrimary:     { padding:"8px 20px", borderRadius:8, fontSize:"0.83rem", fontWeight:700, cursor:"pointer", border:"none", background:"var(--accent)", color:"#0d0f14", transition:"background 0.15s", fontFamily:"'DM Sans',sans-serif" },
};
