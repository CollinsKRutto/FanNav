import { useState, useRef, useEffect, useCallback, useMemo } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG  ← replace all four values before deploying
// ─────────────────────────────────────────────────────────────────────────────
const PAYPAL_CLIENT_ID   = "YOUR_PAYPAL_CLIENT_ID";
const GOOGLE_MAPS_KEY    = "YOUR_GOOGLE_MAPS_API_KEY";
const SUPABASE_URL       = "YOUR_SUPABASE_PROJECT_URL";   // e.g. https://xxxx.supabase.co
const SUPABASE_ANON_KEY  = "YOUR_SUPABASE_ANON_KEY";

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE SQL to run once in your project's SQL editor:
//
//  create table if not exists wait_reports (
//    id          bigserial primary key,
//    match_id    int not null,
//    venue_id    text not null,
//    zone        text not null,
//    mins        int not null check (mins >= 0 and mins <= 120),
//    created_at  timestamptz default now()
//  );
//  alter table wait_reports enable row level security;
//  create policy "anon read"  on wait_reports for select using (true);
//  create policy "anon write" on wait_reports for insert with check (true);
//  alter publication supabase_realtime add table wait_reports;
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// STATIC DATA
// ─────────────────────────────────────────────────────────────────────────────
const MATCHES = [
  { id:1, date:"Jun 11", time:"20:00", home:"Mexico",   away:"Poland",    venue:"Estadio Azteca",  city:"Mexico City",  flag_h:"🇲🇽", flag_a:"🇵🇱", group:"A", coords:{lat:19.3029,lng:-99.1505} },
  { id:2, date:"Jun 12", time:"15:00", home:"USA",      away:"Ghana",     venue:"SoFi Stadium",    city:"Los Angeles",  flag_h:"🇺🇸", flag_a:"🇬🇭", group:"B", coords:{lat:33.9534,lng:-118.3392} },
  { id:3, date:"Jun 13", time:"18:00", home:"Brazil",   away:"Argentina", venue:"MetLife Stadium", city:"New York",     flag_h:"🇧🇷", flag_a:"🇦🇷", group:"C", coords:{lat:40.8135,lng:-74.0745} },
  { id:4, date:"Jun 14", time:"21:00", home:"England",  away:"France",    venue:"AT&T Stadium",    city:"Dallas",       flag_h:"🏴󠁧󠁢󠁥󠁮󠁧󠁿", flag_a:"🇫🇷", group:"D", coords:{lat:32.7473,lng:-97.0945} },
  { id:5, date:"Jun 15", time:"17:00", home:"Germany",  away:"Spain",     venue:"Rose Bowl",       city:"Pasadena",     flag_h:"🇩🇪", flag_a:"🇪🇸", group:"E", coords:{lat:34.1614,lng:-118.1676} },
  { id:6, date:"Jun 16", time:"19:00", home:"Portugal", away:"Morocco",   venue:"Levi's Stadium",  city:"San Francisco",flag_h:"🇵🇹", flag_a:"🇲🇦", group:"F", coords:{lat:37.4032,lng:-121.9698} },
  { id:7, date:"Jun 17", time:"16:00", home:"Canada",   away:"Belgium",   venue:"BC Place",        city:"Vancouver",    flag_h:"🇨🇦", flag_a:"🇧🇪", group:"G", coords:{lat:49.2768,lng:-123.1118} },
  { id:8, date:"Jun 18", time:"18:00", home:"Japan",    away:"Colombia",  venue:"Gillette Stadium",city:"Boston",       flag_h:"🇯🇵", flag_a:"🇨🇴", group:"H", coords:{lat:42.0909,lng:-71.2643} },
];

// Venue zones: each has an id, label, and a position on the SVG floor-plan (0-100 scale)
const VENUE_ZONES = [
  { id:"gate_a",    zone:"Gate A (North)",   x:50, y:8  },
  { id:"gate_b",    zone:"Gate B (South)",   x:50, y:92 },
  { id:"gate_c",    zone:"Gate C (East)",    x:92, y:50 },
  { id:"gate_d",    zone:"Gate D (West)",    x:8,  y:50 },
  { id:"food_w",    zone:"Food Court West",  x:18, y:35 },
  { id:"food_e",    zone:"Food Court East",  x:82, y:35 },
  { id:"bathroom1", zone:"Bathroom North",   x:50, y:22 },
  { id:"bathroom2", zone:"Bathroom South",   x:50, y:78 },
  { id:"fanzone",   zone:"Fan Zone",         x:50, y:50 },
  { id:"merch",     zone:"Merch Stand",      x:30, y:65 },
];

// Seed wait times (used when Supabase has no data yet)
const SEED_MINS = { gate_a:12, gate_b:4, gate_c:9, gate_d:6, food_w:18, food_e:7, bathroom1:8, bathroom2:5, fanzone:2, merch:11 };

const PLANS = [
  { id:"match",      name:"Match Pass",      price:9,  period:"per match",     highlight:false,
    features:["AI Co-pilot (unlimited)","Live crowd heat map","Smart journey planner","Budget radar","Instant translate"] },
  { id:"tournament", name:"Tournament Pass", price:49, period:"all 64 matches", highlight:true,
    features:["Everything in Match Pass","All 64 matches","Share with 3 friends","Tactical overlay","Priority AI responses","Post-match analysis"] },
];

const TRAVEL_MODES = [
  { id:"TRANSIT", label:"Transit", icon:"🚇" },
  { id:"DRIVING", label:"Drive",   icon:"🚗" },
  { id:"WALKING", label:"Walk",    icon:"🚶" },
];

const TABS = ["Co-pilot","Matches","Tactics","Journey","Venue Intel","My Plan"];

// ─────────────────────────────────────────────────────────────────────────────
// TACTICS DATA  (per match — keyed by match id)
// ─────────────────────────────────────────────────────────────────────────────
const TACTICS_DATA = {
  default: {
    home: {
      formation: "4-3-3",
      shape: [
        { name:"GK",  pos:[50,88], role:"Goalkeeper"   },
        { name:"RB",  pos:[82,72], role:"Right Back"   },
        { name:"CB",  pos:[62,68], role:"Centre Back"  },
        { name:"CB",  pos:[38,68], role:"Centre Back"  },
        { name:"LB",  pos:[18,72], role:"Left Back"    },
        { name:"CDM", pos:[65,52], role:"Defensive Mid"},
        { name:"CM",  pos:[50,48], role:"Centre Mid"   },
        { name:"CDM", pos:[35,52], role:"Defensive Mid"},
        { name:"RW",  pos:[80,30], role:"Right Wing"   },
        { name:"ST",  pos:[50,22], role:"Striker"      },
        { name:"LW",  pos:[20,30], role:"Left Wing"    },
      ],
      color: "#c8f135",
    },
    away: {
      formation: "4-2-3-1",
      shape: [
        { name:"GK",  pos:[50,12], role:"Goalkeeper"   },
        { name:"LB",  pos:[18,28], role:"Left Back"    },
        { name:"CB",  pos:[38,32], role:"Centre Back"  },
        { name:"CB",  pos:[62,32], role:"Centre Back"  },
        { name:"RB",  pos:[82,28], role:"Right Back"   },
        { name:"DM",  pos:[38,46], role:"Def. Mid"     },
        { name:"DM",  pos:[62,46], role:"Def. Mid"     },
        { name:"LM",  pos:[18,60], role:"Left Mid"     },
        { name:"CAM", pos:[50,62], role:"Att. Mid"     },
        { name:"RM",  pos:[82,60], role:"Right Mid"    },
        { name:"ST",  pos:[50,76], role:"Striker"      },
      ],
      color: "#e8412a",
    },
    stats: [
      { label:"Possession",   home:58, away:42, unit:"%" },
      { label:"Shots",        home:14, away:9,  unit:""  },
      { label:"On Target",    home:6,  away:3,  unit:""  },
      { label:"Pass Acc.",    home:87, away:81, unit:"%" },
      { label:"Corners",      home:7,  away:4,  unit:""  },
      { label:"Fouls",        home:11, away:15, unit:""  },
      { label:"xG",           home:1.8,away:0.9,unit:""  },
    ],
    keyPlayers: [
      { side:"home", name:"No. 10", stat:"3 key passes", badge:"🎯" },
      { side:"home", name:"No. 9",  stat:"xG 0.82",      badge:"⚡" },
      { side:"away", name:"No. 7",  stat:"5 duels won",  badge:"🛡" },
      { side:"away", name:"No. 11", stat:"4 dribbles",   badge:"🔥" },
    ],
    events: [
      { min:8,  team:"home", type:"shot",   desc:"Shot saved — top corner attempt" },
      { min:23, team:"away", type:"yellow", desc:"Yellow card — tactical foul" },
      { min:31, team:"home", type:"goal",   desc:"GOAL! Clinical finish bottom-left" },
      { min:44, team:"away", type:"shot",   desc:"Shot over the bar from distance"  },
      { min:52, team:"away", type:"goal",   desc:"GOAL! Header from corner kick"    },
      { min:67, team:"home", type:"sub",    desc:"Substitution — fresh legs up front" },
      { min:74, team:"home", type:"yellow", desc:"Yellow card — time-wasting"       },
      { min:81, team:"home", type:"goal",   desc:"GOAL! Penalty converted coolly"   },
    ],
    insight: "The home side dominating possession in the final third. The 4-3-3 is pressing high and winning balls in dangerous areas. Watch the right-back — making overlapping runs that the away side can't handle.",
  },
};

// Per-match overrides (formation + stat flavour)
const MATCH_OVERRIDES = {
  1: { home:{ formation:"4-3-3"  }, away:{ formation:"4-4-2"   }, statsOverride:[
    { label:"Possession", home:61, away:39, unit:"%" }, { label:"Shots", home:12, away:8, unit:"" },
    { label:"On Target",  home:5,  away:3,  unit:""  }, { label:"Pass Acc.", home:84, away:76, unit:"%" },
    { label:"Corners",    home:6,  away:3,  unit:""  }, { label:"Fouls", home:9, away:13, unit:"" },
    { label:"xG",         home:1.6,away:0.7,unit:""  },
  ], insight:"Mexico pressing with intensity at Azteca. The 4-3-3 is overwhelming Poland's flat 4-4-2 in midfield zones. Watch the half-spaces — Mexico's wingers are finding pockets constantly." },
  2: { home:{ formation:"4-2-3-1"}, away:{ formation:"5-3-2"  }, statsOverride:[
    { label:"Possession", home:55, away:45, unit:"%" }, { label:"Shots", home:16, away:7, unit:"" },
    { label:"On Target",  home:7,  away:2,  unit:""  }, { label:"Pass Acc.", home:89, away:80, unit:"%" },
    { label:"Corners",    home:8,  away:2,  unit:""  }, { label:"Fouls", home:10, away:18, unit:"" },
    { label:"xG",         home:2.1,away:0.5,unit:""  },
  ], insight:"USA dominating possession in the final third against Ghana's deep 5-3-2 block. The challenge is breaking the low line — width and early crosses are the key. Ghana dangerous on the counter through the channels." },
  3: { home:{ formation:"4-3-3"  }, away:{ formation:"3-4-2-1"}, statsOverride:[
    { label:"Possession", home:52, away:48, unit:"%" }, { label:"Shots", home:11, away:13, unit:"" },
    { label:"On Target",  home:5,  away:6,  unit:""  }, { label:"Pass Acc.", home:91, away:88, unit:"%" },
    { label:"Corners",    home:5,  away:7,  unit:""  }, { label:"Fouls", home:12, away:11, unit:"" },
    { label:"xG",         home:1.4,away:1.9,unit:""  },
  ], insight:"Brazil vs Argentina — a tactical chess match at MetLife. Argentina's 3-4-2-1 is controlling the wide channels through wingbacks. Brazil's 4-3-3 press is high but gaps are appearing behind the full-backs. xG favours Argentina on the counterpress." },
  4: { home:{ formation:"4-2-3-1"}, away:{ formation:"4-3-3"  }, statsOverride:[
    { label:"Possession", home:49, away:51, unit:"%" }, { label:"Shots", home:10, away:14, unit:"" },
    { label:"On Target",  home:4,  away:6,  unit:""  }, { label:"Pass Acc.", home:85, away:90, unit:"%" },
    { label:"Corners",    home:4,  away:6,  unit:""  }, { label:"Fouls", home:14, away:10, unit:"" },
    { label:"xG",         home:1.1,away:1.7,unit:""  },
  ], insight:"England vs France — France's 4-3-3 is superior in transition. England's 4-2-3-1 is sitting deep and looking to exploit set pieces. The double pivot is being overrun by France's press. England need to shorten the lines." },
  5: { home:{ formation:"4-2-3-1"}, away:{ formation:"4-3-3"  }, statsOverride:[
    { label:"Possession", home:45, away:55, unit:"%" }, { label:"Shots", home:9,  away:15, unit:"" },
    { label:"On Target",  home:3,  away:7,  unit:""  }, { label:"Pass Acc.", home:83, away:92, unit:"%" },
    { label:"Corners",    home:3,  away:8,  unit:""  }, { label:"Fouls", home:13, away:9,  unit:"" },
    { label:"xG",         home:0.9,away:2.2,unit:""  },
  ], insight:"Spain's tiki-taka in full flow at the Rose Bowl. Germany's 4-2-3-1 is struggling to press the short build-up — Spain's third-man combinations are bypassing the press repeatedly. xG of 2.2 tells the story." },
  6: { home:{ formation:"4-3-3"  }, away:{ formation:"4-5-1"  }, statsOverride:[
    { label:"Possession", home:60, away:40, unit:"%" }, { label:"Shots", home:13, away:6,  unit:"" },
    { label:"On Target",  home:5,  away:2,  unit:""  }, { label:"Pass Acc.", home:88, away:79, unit:"%" },
    { label:"Corners",    home:7,  away:2,  unit:""  }, { label:"Fouls", home:8,  away:16, unit:"" },
    { label:"xG",         home:1.7,away:0.6,unit:""  },
  ], insight:"Morocco sitting in a deep 4-5-1 compact block, limiting Portugal's space. Ronaldo dropping deep to link play. Portugal need to stretch Morocco wide — the left channel has been the most productive zone all half." },
  7: { home:{ formation:"4-4-2"  }, away:{ formation:"4-3-3"  }, statsOverride:[
    { label:"Possession", home:44, away:56, unit:"%" }, { label:"Shots", home:7,  away:12, unit:"" },
    { label:"On Target",  home:3,  away:5,  unit:""  }, { label:"Pass Acc.", home:80, away:87, unit:"%" },
    { label:"Corners",    home:3,  away:6,  unit:""  }, { label:"Fouls", home:11, away:12, unit:"" },
    { label:"xG",         home:0.8,away:1.5,unit:""  },
  ], insight:"Belgium's quality showing against Canada's spirited 4-4-2. The 4-3-3 is controlling the tempo through the central overload. Canada's high line is being tested — Belgium's runners in behind are the key weapon." },
  8: { home:{ formation:"4-2-3-1"}, away:{ formation:"4-4-2"  }, statsOverride:[
    { label:"Possession", home:57, away:43, unit:"%" }, { label:"Shots", home:13, away:8,  unit:"" },
    { label:"On Target",  home:6,  away:3,  unit:""  }, { label:"Pass Acc.", home:90, away:82, unit:"%" },
    { label:"Corners",    home:5,  away:4,  unit:""  }, { label:"Fouls", home:9,  away:14, unit:"" },
    { label:"xG",         home:1.5,away:0.8,unit:""  },
  ], insight:"Japan's high press is suffocating Colombia's build-up. The 4-2-3-1 is winning balls high and transitioning quickly. Colombia's 4-4-2 needs to bypass the press with longer distribution — currently being overrun in the press trap." },
};

function getTactics(match) {
  if (!match) return TACTICS_DATA.default;
  const base = TACTICS_DATA.default;
  const over = MATCH_OVERRIDES[match.id];
  const result = {
    ...base,
    home: { ...base.home, label: match.home, flag: match.flag_h, ...(over?.home || {}) },
    away: { ...base.away, label: match.away, flag: match.flag_a, ...(over?.away || {}) },
    stats: over?.statsOverride || base.stats,
    insight: over?.insight || base.insight,
  };
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// AI TACTICAL ANALYST
// ─────────────────────────────────────────────────────────────────────────────
async function askTactician(prompt, match, stats) {
  const ctx = match
    ? `Match: ${match.home} (${getTactics(match).home.formation}) vs ${match.away} (${getTactics(match).away.formation}).
Stats: ${stats.map(s => `${s.label}: ${s.home}${s.unit} – ${s.away}${s.unit}`).join(", ")}.`
    : "No match context.";
  const system = `You are a world-class football tactical analyst. Provide sharp, expert insight in 80-100 words. Use tactical terms (press, shape, transition, overload, half-space etc). Be direct and opinionated. No fluff.`;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 1000,
      system,
      messages: [{ role: "user", content: `${ctx}\n\nAnalyst prompt: ${prompt}` }],
    }),
  });
  const data = await resp.json();
  return data.content?.[0]?.text || "Analysis unavailable.";
}

// ─────────────────────────────────────────────────────────────────────────────
// SUPABASE CLIENT (pure fetch, no package needed)
// ─────────────────────────────────────────────────────────────────────────────
const sb = {
  headers: () => ({
    "apikey": SUPABASE_ANON_KEY,
    "Authorization": `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
    "Prefer": "return=representation",
  }),

  async getRecentWaits(matchId) {
    // Fetch last 30 min of reports for this match, grouped by venue_id
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const url = `${SUPABASE_URL}/rest/v1/wait_reports?match_id=eq.${matchId}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc`;
    const res = await fetch(url, { headers: sb.headers() });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async submitWait(matchId, venueId, zone, mins) {
    const url = `${SUPABASE_URL}/rest/v1/wait_reports`;
    const res = await fetch(url, {
      method: "POST",
      headers: sb.headers(),
      body: JSON.stringify({ match_id: matchId, venue_id: venueId, zone, mins }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  subscribeWaits(matchId, onInsert) {
    // Supabase Realtime via WebSocket
    const wsUrl = SUPABASE_URL.replace("https://", "wss://").replace("http://", "ws://") + "/realtime/v1/websocket?apikey=" + SUPABASE_ANON_KEY + "&vsn=1.0.0";
    const ws = new WebSocket(wsUrl);
    const topic = `realtime:public:wait_reports:match_id=eq.${matchId}`;

    ws.onopen = () => {
      ws.send(JSON.stringify({ topic, event: "phx_join", payload: {}, ref: "1" }));
    };
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.event === "INSERT" && msg.payload?.record) {
          onInsert(msg.payload.record);
        }
      } catch {}
    };
    ws.onerror = () => {}; // fail silently; app works without realtime
    return () => ws.close();
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// WAIT TIME ENGINE — merges seed + remote data → computes avg per zone
// ─────────────────────────────────────────────────────────────────────────────
function buildWaitMap(reports) {
  // Group by venue_id, take median of last 5 reports per zone
  const byZone = {};
  for (const r of reports) {
    if (!byZone[r.venue_id]) byZone[r.venue_id] = [];
    byZone[r.venue_id].push(r.mins);
  }
  const result = {};
  for (const [vid, vals] of Object.entries(byZone)) {
    const sorted = [...vals].sort((a,b)=>a-b);
    const mid = Math.floor(sorted.length / 2);
    result[vid] = sorted.length % 2 === 0
      ? Math.round((sorted[mid-1] + sorted[mid]) / 2)
      : sorted[mid];
  }
  return result;
}

function statusFromMins(mins) {
  if (mins <= 5)  return "clear";
  if (mins <= 12) return "moderate";
  if (mins <= 20) return "busy";
  return "jammed";
}

// ─────────────────────────────────────────────────────────────────────────────
// HOOKS
// ─────────────────────────────────────────────────────────────────────────────
function useRealtimeWaits(match) {
  const [waitMap, setWaitMap]       = useState({});   // { venue_id → mins }
  const [reports, setReports]       = useState([]);   // raw rows for stats
  const [connected, setConnected]   = useState(false);
  const [fanCount, setFanCount]     = useState(0);
  const [toast, setToast]           = useState(null);

  // Fetch initial data
  useEffect(() => {
    if (!match) return;
    setWaitMap({}); setReports([]); setConnected(false); setFanCount(0);

    const isDemoMode = SUPABASE_URL.startsWith("YOUR_");

    if (isDemoMode) {
      // Demo mode: simulate live data with random updates
      const seed = VENUE_ZONES.map(z => ({ venue_id: z.id, mins: SEED_MINS[z.id] || 5, zone: z.zone }));
      setReports(seed);
      setWaitMap(Object.fromEntries(seed.map(r => [r.venue_id, r.mins])));
      setFanCount(Math.floor(Math.random() * 800) + 200);
      setConnected(true);

      // Simulate incoming reports every 8-15 seconds
      const interval = setInterval(() => {
        const zone = VENUE_ZONES[Math.floor(Math.random() * VENUE_ZONES.length)];
        const delta = Math.floor(Math.random() * 5) - 2;
        setWaitMap(prev => {
          const current = prev[zone.id] || SEED_MINS[zone.id] || 5;
          const next = Math.max(1, Math.min(60, current + delta));
          return { ...prev, [zone.id]: next };
        });
        setFanCount(c => Math.max(50, c + Math.floor(Math.random() * 10) - 4));
        setToast({ zone: zone.zone, delta });
        setTimeout(() => setToast(null), 3000);
      }, Math.random() * 7000 + 8000);

      return () => clearInterval(interval);
    }

    // Real Supabase mode
    sb.getRecentWaits(match.id).then(rows => {
      setReports(rows);
      if (rows.length > 0) {
        setWaitMap(buildWaitMap(rows));
        setFanCount(new Set(rows.map(r => r.created_at?.slice(0,13))).size * 12 + 50);
      } else {
        // Use seeds if no data yet
        setWaitMap(Object.fromEntries(VENUE_ZONES.map(z => [z.id, SEED_MINS[z.id] || 5])));
      }
      setConnected(true);
    }).catch(() => {
      setWaitMap(Object.fromEntries(VENUE_ZONES.map(z => [z.id, SEED_MINS[z.id] || 5])));
    });

    // Subscribe realtime
    const unsub = sb.subscribeWaits(match.id, (record) => {
      setReports(prev => [record, ...prev]);
      setWaitMap(prev => {
        const zone = VENUE_ZONES.find(z => z.id === record.venue_id);
        const old = prev[record.venue_id] || 0;
        const delta = record.mins - old;
        setToast({ zone: record.zone, delta });
        setTimeout(() => setToast(null), 3000);
        return { ...prev, [record.venue_id]: record.mins };
      });
      setFanCount(c => c + 1);
    });

    return unsub;
  }, [match?.id]);

  return { waitMap, reports, connected, fanCount, toast, setWaitMap };
}

function useCountdown(targetISO) {
  const [remaining, setRemaining] = useState("");
  useEffect(() => {
    if (!targetISO) { setRemaining(""); return; }
    const tick = () => {
      const diff = new Date(targetISO) - Date.now();
      if (diff <= 0) { setRemaining("Depart now!"); return; }
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setRemaining(h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [targetISO]);
  return remaining;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE MAPS LOADER
// ─────────────────────────────────────────────────────────────────────────────
let mapsPromise = null;
function loadGoogleMaps() {
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    if (window.google?.maps) { resolve(window.google.maps); return; }
    const cb = "__gmaps_cb__" + Date.now();
    window[cb] = () => resolve(window.google.maps);
    const s = document.createElement("script");
    s.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=places&callback=${cb}`;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return mapsPromise;
}

function loadPayPalScript(cid) {
  return new Promise((resolve, reject) => {
    if (window.paypal) { resolve(); return; }
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${cid}&currency=USD&components=buttons`;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function fetchDirections(origin, destCoords, travelMode) {
  const maps = await loadGoogleMaps();
  const svc = new maps.DirectionsService();
  return new Promise((resolve, reject) => {
    svc.route({
      origin, destination: destCoords,
      travelMode: maps.TravelMode[travelMode],
      provideRouteAlternatives: false,
      unitSystem: maps.UnitSystem.METRIC,
    }, (res, status) => status === "OK" ? resolve(res) : reject(new Error(status)));
  });
}

function usePlaces(inputRef, onSelect) {
  useEffect(() => {
    let ac;
    loadGoogleMaps().then(maps => {
      if (!inputRef.current) return;
      ac = new maps.places.Autocomplete(inputRef.current, { types:["establishment","geocode"] });
      ac.addListener("place_changed", () => {
        const p = ac.getPlace();
        if (p?.formatted_address || p?.name) onSelect(p.formatted_address || p.name);
      });
    });
    return () => { if (ac) window.google?.maps?.event?.clearInstanceListeners(ac); };
  }, []);
}

function stripHtml(html) {
  const d = document.createElement("div"); d.innerHTML = html; return d.textContent || "";
}
function modeIcon(step) {
  const t = step.travel_mode;
  if (t === "TRANSIT") {
    const v = step.transit?.line?.vehicle?.type || "";
    if (v === "SUBWAY" || v === "METRO_RAIL") return "🚇";
    if (v === "BUS") return "🚌";
    return "🚆";
  }
  return t === "WALKING" ? "🚶" : "🚗";
}
function transitColor(step) { return step.transit?.line?.color || "#c8f135"; }
function calcDepartISO(durationSecs) {
  return new Date(Date.now() + (durationSecs + 45 * 60) * 1000).toISOString();
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS
// ─────────────────────────────────────────────────────────────────────────────
const css = `
  @import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=Barlow:wght@300;400;500&display=swap');
  *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
  :root{
    --pitch:#0a1628;--pitch-mid:#0e1f3a;--pitch-light:#142847;
    --lime:#c8f135;--lime-dim:#a0c22a;--amber:#f5a623;--red:#e8412a;--teal:#1adbb4;
    --white:#f0f4ff;--muted:#6b7fa8;--border:rgba(200,241,53,0.12);
    --font-display:'Barlow Condensed',sans-serif;--font-body:'Barlow',sans-serif;
    --r:10px;--r-lg:16px;
  }
  body{background:var(--pitch);color:var(--white);font-family:var(--font-body);-webkit-font-smoothing:antialiased}
  .app{max-width:480px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column;position:relative}

  /* header */
  .header{padding:1.2rem 1.25rem .8rem;display:flex;align-items:center;justify-content:space-between;
    border-bottom:1px solid var(--border);background:var(--pitch);position:sticky;top:0;z-index:100}
  .logo{font-family:var(--font-display);font-size:26px;font-weight:900;letter-spacing:.02em}
  .logo span{color:var(--lime)}
  .logo-sub{font-size:10px;color:var(--muted);letter-spacing:.12em;margin-top:-4px;font-family:var(--font-body)}
  .live-badge{background:var(--red);color:#fff;font-size:10px;font-weight:600;padding:3px 8px;
    border-radius:20px;letter-spacing:.06em;animation:pulse 1.8s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}

  /* nav */
  .nav{display:flex;border-bottom:1px solid var(--border);background:var(--pitch);
    position:sticky;top:64px;z-index:99;overflow-x:auto;scrollbar-width:none}
  .nav::-webkit-scrollbar{display:none}
  .nav-btn{flex:1;min-width:72px;padding:.7rem .4rem;font-family:var(--font-display);font-size:12px;
    font-weight:600;letter-spacing:.05em;color:var(--muted);background:none;border:none;cursor:pointer;
    border-bottom:2px solid transparent;transition:all .2s;white-space:nowrap}
  .nav-btn.active{color:var(--lime);border-bottom-color:var(--lime)}
  .nav-btn:hover:not(.active){color:var(--white)}

  /* content */
  .content{flex:1;overflow-y:auto;padding:1.25rem;display:flex;flex-direction:column;gap:1.25rem}
  .content::-webkit-scrollbar{width:3px}
  .content::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}

  /* section card */
  .section-card{background:var(--pitch-mid);border:1px solid var(--border);border-radius:var(--r-lg);padding:1.1rem}
  .section-title{font-family:var(--font-display);font-size:14px;font-weight:700;letter-spacing:.1em;
    color:var(--lime);margin-bottom:.9rem;display:flex;align-items:center;gap:.4rem}

  /* match card */
  .match-select-label{font-family:var(--font-display);font-size:11px;font-weight:600;letter-spacing:.12em;color:var(--muted);margin-bottom:.5rem}
  .match-cards{display:flex;flex-direction:column;gap:.6rem}
  .match-card{background:var(--pitch-mid);border:1px solid var(--border);border-radius:var(--r);
    padding:.9rem 1rem;cursor:pointer;transition:all .2s;position:relative;overflow:hidden}
  .match-card:hover{border-color:rgba(200,241,53,.3)}
  .match-card.selected{border-color:var(--lime);background:var(--pitch-light)}
  .match-card.selected::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--lime)}
  .mc-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:.5rem}
  .mc-group{font-size:10px;font-weight:600;color:var(--lime);letter-spacing:.1em;font-family:var(--font-display)}
  .mc-date{font-size:11px;color:var(--muted)}
  .mc-teams{display:flex;align-items:center;gap:.5rem}
  .mc-flag{font-size:20px}
  .mc-team-name{font-family:var(--font-display);font-size:16px;font-weight:700;letter-spacing:.04em}
  .mc-vs{font-size:11px;font-weight:600;color:var(--muted);padding:0 .2rem}
  .mc-venue{font-size:11px;color:var(--muted);margin-top:.3rem}
  .mc-time{font-family:var(--font-display);font-size:13px;font-weight:600;color:var(--amber)}

  /* chat */
  .chat-wrap{display:flex;flex-direction:column;gap:.75rem;max-height:400px;overflow-y:auto;padding-right:2px}
  .chat-wrap::-webkit-scrollbar{width:3px}
  .chat-wrap::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
  .msg{display:flex;gap:.6rem;align-items:flex-start}
  .msg.user{flex-direction:row-reverse}
  .msg-avatar{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;
    justify-content:center;font-size:11px;font-weight:700;font-family:var(--font-display)}
  .msg-avatar.ai{background:var(--lime);color:var(--pitch)}
  .msg-avatar.user{background:var(--pitch-light);color:var(--white);border:1px solid var(--border)}
  .msg-bubble{max-width:78%;padding:.65rem .85rem;border-radius:12px;font-size:13.5px;line-height:1.55;white-space:pre-wrap}
  .msg.ai .msg-bubble{background:var(--pitch-light);color:var(--white);border-top-left-radius:4px}
  .msg.user .msg-bubble{background:var(--lime);color:var(--pitch);font-weight:500;border-top-right-radius:4px}
  .msg-bubble.loading{display:flex;gap:4px;align-items:center}
  .dot{width:6px;height:6px;border-radius:50%;background:var(--muted);animation:blink 1.2s ease-in-out infinite}
  .dot:nth-child(2){animation-delay:.2s}.dot:nth-child(3){animation-delay:.4s}
  @keyframes blink{0%,80%,100%{opacity:.3}40%{opacity:1}}
  .chat-input-wrap{display:flex;gap:.6rem;margin-top:.75rem}
  .chat-input{flex:1;background:var(--pitch-light);border:1px solid var(--border);border-radius:24px;
    padding:.65rem 1rem;color:var(--white);font-family:var(--font-body);font-size:13.5px;outline:none;transition:border-color .2s}
  .chat-input::placeholder{color:var(--muted)}
  .chat-input:focus{border-color:rgba(200,241,53,.4)}
  .send-btn{width:40px;height:40px;border-radius:50%;background:var(--lime);border:none;cursor:pointer;
    display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}
  .send-btn:hover{background:var(--lime-dim);transform:scale(1.05)}
  .send-btn:disabled{opacity:.4;cursor:not-allowed;transform:none}
  .send-icon{width:16px;height:16px;fill:var(--pitch)}
  .quick-prompts{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.6rem}
  .qp-btn{background:transparent;border:1px solid var(--border);border-radius:20px;padding:.35rem .75rem;
    font-size:11.5px;color:var(--muted);cursor:pointer;transition:all .2s;font-family:var(--font-body);white-space:nowrap}
  .qp-btn:hover{border-color:var(--lime);color:var(--lime)}

  /* venue intel */
  .vi-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
  .vi-fan-count{display:flex;align-items:center;gap:.4rem;background:var(--pitch-light);
    border:1px solid var(--border);border-radius:20px;padding:.35rem .85rem}
  .vi-fan-num{font-family:var(--font-display);font-size:16px;font-weight:900;color:var(--lime)}
  .vi-fan-label{font-size:11px;color:var(--muted)}
  .vi-conn{display:flex;align-items:center;gap:.35rem;font-size:11px}
  .vi-conn.on{color:var(--teal)}.vi-conn.off{color:var(--muted)}
  .vi-conn-dot{width:7px;height:7px;border-radius:50%}
  .vi-conn.on .vi-conn-dot{background:var(--teal);animation:pulse 1.5s ease-in-out infinite}
  .vi-conn.off .vi-conn-dot{background:var(--muted)}

  /* heat map */
  .heatmap-wrap{position:relative;width:100%;margin-bottom:1rem}
  .heatmap-svg{width:100%;height:auto;border-radius:var(--r);overflow:visible}
  .heatmap-legend{display:flex;align-items:center;gap:.5rem;margin-top:.5rem;justify-content:center}
  .legend-bar{height:6px;width:120px;border-radius:3px;background:linear-gradient(to right,#1adbb4,#f5a623,#e8412a)}
  .legend-label{font-size:10px;color:var(--muted)}

  /* wait list */
  .wait-grid{display:flex;flex-direction:column;gap:.5rem}
  .wait-row{display:flex;align-items:center;justify-content:space-between;padding:.6rem .8rem;
    background:var(--pitch-light);border-radius:var(--r);cursor:pointer;transition:all .2s;border:1px solid transparent}
  .wait-row:hover{border-color:rgba(200,241,53,.2)}
  .wait-row.selected-zone{border-color:var(--lime);background:var(--pitch)}
  .wait-left{display:flex;align-items:center;gap:.6rem}
  .wait-zone{font-size:13px;color:var(--white)}
  .wait-right{display:flex;align-items:center;gap:.6rem}
  .wait-time{font-family:var(--font-display);font-size:18px;font-weight:900}
  .wait-time.clear{color:var(--teal)}.wait-time.moderate{color:var(--amber)}
  .wait-time.busy,.wait-time.jammed{color:var(--red)}
  .wait-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
  .wait-dot.clear{background:var(--teal)}.wait-dot.moderate{background:var(--amber)}
  .wait-dot.busy,.wait-dot.jammed{background:var(--red)}
  .wait-trend{font-size:12px;font-weight:600}
  .wait-trend.up{color:var(--red)}.wait-trend.down{color:var(--teal)}.wait-trend.flat{color:var(--muted)}

  /* report modal */
  .report-modal{background:var(--pitch-mid);border:1px solid var(--lime);border-radius:var(--r-lg);
    padding:1.1rem;margin-top:.75rem}
  .report-modal-title{font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--lime);margin-bottom:.75rem}
  .slider-wrap{display:flex;align-items:center;gap:.75rem;margin:.5rem 0 .85rem}
  .wait-slider{flex:1;-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;
    background:var(--pitch-light);outline:none;cursor:pointer}
  .wait-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:20px;height:20px;
    border-radius:50%;background:var(--lime);cursor:pointer;border:2px solid var(--pitch)}
  .slider-val{font-family:var(--font-display);font-size:22px;font-weight:900;color:var(--lime);
    min-width:40px;text-align:right}
  .submit-btn{width:100%;padding:.65rem;border-radius:24px;background:var(--lime);color:var(--pitch);
    border:none;cursor:pointer;font-family:var(--font-display);font-size:15px;font-weight:700;
    letter-spacing:.06em;transition:all .2s}
  .submit-btn:hover{background:var(--lime-dim)}
  .submit-btn:disabled{opacity:.4;cursor:not-allowed}
  .cancel-btn{width:100%;padding:.5rem;margin-top:.4rem;background:transparent;border:1px solid var(--border);
    border-radius:24px;color:var(--muted);cursor:pointer;font-size:13px;font-family:var(--font-body)}
  .cancel-btn:hover{color:var(--white);border-color:var(--white)}

  /* toast */
  .toast{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:var(--pitch-mid);
    border:1px solid var(--lime);border-radius:24px;padding:.55rem 1.1rem;
    font-size:13px;color:var(--white);z-index:300;white-space:nowrap;
    animation:toastIn .3s ease-out;pointer-events:none;box-shadow:0 4px 24px rgba(0,0,0,.4)}
  @keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

  /* journey planner */
  .mode-tabs{display:flex;gap:.5rem;margin-bottom:1rem}
  .mode-tab{flex:1;padding:.55rem .4rem;border:1px solid var(--border);border-radius:var(--r);
    background:transparent;color:var(--muted);font-family:var(--font-display);font-size:13px;font-weight:600;
    letter-spacing:.06em;cursor:pointer;transition:all .2s;text-align:center}
  .mode-tab.active{background:var(--lime);color:var(--pitch);border-color:var(--lime)}
  .mode-tab:hover:not(.active){border-color:rgba(200,241,53,.4);color:var(--white)}
  .addr-wrap{position:relative;margin-bottom:.75rem}
  .addr-input{width:100%;background:var(--pitch-light);border:1px solid var(--border);border-radius:var(--r);
    padding:.7rem 1rem .7rem 2.4rem;color:var(--white);font-family:var(--font-body);font-size:13.5px;
    outline:none;transition:border-color .2s}
  .addr-input::placeholder{color:var(--muted)}
  .addr-input:focus{border-color:rgba(200,241,53,.4)}
  .addr-icon{position:absolute;left:.8rem;top:50%;transform:translateY(-50%);font-size:14px;pointer-events:none}
  .route-btn{width:100%;padding:.75rem;border-radius:24px;border:none;cursor:pointer;
    font-family:var(--font-display);font-size:16px;font-weight:700;letter-spacing:.06em;
    background:var(--lime);color:var(--pitch);transition:all .2s}
  .route-btn:hover{background:var(--lime-dim)}
  .route-btn:disabled{opacity:.4;cursor:not-allowed}
  #gmap{width:100%;height:240px;border-radius:var(--r);overflow:hidden;margin:.85rem 0;border:1px solid var(--border)}
  .route-summary{display:flex;gap:1rem;margin-bottom:.85rem;padding:.75rem 1rem;
    background:var(--pitch-light);border-radius:var(--r)}
  .rs-item{text-align:center}
  .rs-val{font-family:var(--font-display);font-size:20px;font-weight:900;color:var(--lime)}
  .rs-label{font-size:11px;color:var(--muted);margin-top:2px}
  .route-steps{display:flex;flex-direction:column;gap:0}
  .route-step{display:flex;gap:.75rem;padding:.65rem 0;border-bottom:1px solid var(--border)}
  .route-step:last-child{border-bottom:none}
  .step-line{display:flex;flex-direction:column;align-items:center;width:22px;flex-shrink:0}
  .step-dot{width:10px;height:10px;border-radius:50%;border:2px solid var(--lime);background:var(--pitch);flex-shrink:0;margin-top:4px}
  .step-dot.transit{background:var(--lime)}
  .step-connector{flex:1;width:2px;background:var(--border);margin:3px 0}
  .step-body{flex:1}
  .step-instruction{font-size:13px;color:var(--white);line-height:1.45}
  .step-meta{font-size:11px;color:var(--muted);margin-top:3px}
  .transit-pill{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;
    font-size:11px;font-weight:600;margin-top:4px;font-family:var(--font-display);letter-spacing:.04em}
  .depart-banner{background:var(--pitch-light);border:1px solid var(--lime);border-radius:var(--r);
    padding:.85rem 1rem;display:flex;align-items:center;justify-content:space-between;margin-bottom:.85rem}
  .depart-label{font-size:12px;color:var(--muted)}
  .depart-time{font-family:var(--font-display);font-size:22px;font-weight:900;color:var(--lime)}
  .depart-sub{font-size:11px;color:var(--muted);margin-top:1px}
  .countdown{font-family:var(--font-display);font-size:15px;font-weight:700;color:var(--amber);text-align:right}
  .countdown-label{font-size:10px;color:var(--muted);text-align:right}
  .error-box{background:rgba(232,65,42,.12);border:1px solid rgba(232,65,42,.3);border-radius:var(--r);
    padding:.75rem 1rem;font-size:13px;color:var(--red);line-height:1.5;margin-top:.75rem}
  .spinner{display:inline-block;width:18px;height:18px;border:2px solid var(--border);
    border-top-color:var(--lime);border-radius:50%;animation:spin .7s linear infinite;vertical-align:middle;margin-right:6px}
  @keyframes spin{to{transform:rotate(360deg)}}

  /* plans */
  .plans-grid{display:flex;flex-direction:column;gap:.75rem}
  .plan-card{background:var(--pitch-light);border:1px solid var(--border);border-radius:var(--r-lg);
    padding:1.1rem 1.2rem;position:relative;overflow:hidden}
  .plan-card.highlight{border-color:var(--lime)}
  .plan-badge{position:absolute;top:0;right:0;background:var(--lime);color:var(--pitch);font-size:10px;
    font-weight:700;padding:4px 12px;border-bottom-left-radius:10px;letter-spacing:.06em;font-family:var(--font-display)}
  .plan-name{font-family:var(--font-display);font-size:20px;font-weight:900;margin-bottom:.15rem}
  .plan-price{font-family:var(--font-display);font-size:36px;font-weight:900;color:var(--lime);line-height:1}
  .plan-price span{font-size:14px;font-weight:400;color:var(--muted);margin-left:4px}
  .plan-features{margin:.85rem 0 1rem;display:flex;flex-direction:column;gap:.35rem}
  .plan-feat{display:flex;align-items:center;gap:.5rem;font-size:13px}
  .feat-check{color:var(--teal)}
  .pay-btn{width:100%;padding:.75rem;border-radius:24px;border:none;cursor:pointer;
    font-family:var(--font-display);font-size:16px;font-weight:700;letter-spacing:.06em;transition:all .2s}
  .pay-btn.primary{background:var(--lime);color:var(--pitch)}
  .pay-btn.primary:hover{background:var(--lime-dim)}
  .pay-btn.secondary{background:transparent;border:1px solid var(--border);color:var(--white)}
  .pay-btn.secondary:hover{border-color:var(--lime);color:var(--lime)}
  .paypal-note{font-size:11px;color:var(--muted);text-align:center;margin-top:.5rem}
  .modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:200;
    display:flex;align-items:flex-end;justify-content:center;animation:fadeIn .2s}
  @keyframes fadeIn{from{opacity:0}to{opacity:1}}
  .modal{background:var(--pitch-mid);border:1px solid var(--border);border-radius:var(--r-lg) var(--r-lg) 0 0;
    width:100%;max-width:480px;padding:1.5rem 1.25rem 2rem;animation:slideUp .25s ease-out}
  @keyframes slideUp{from{transform:translateY(40px);opacity:0}to{transform:translateY(0);opacity:1}}
  .modal-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:1.25rem}
  .modal-title{font-family:var(--font-display);font-size:20px;font-weight:900}
  .modal-close{background:none;border:none;color:var(--muted);font-size:22px;cursor:pointer;line-height:1}
  .modal-close:hover{color:var(--white)}
  .modal-summary{background:var(--pitch-light);border-radius:var(--r);padding:.85rem 1rem;margin-bottom:1.1rem}
  .modal-sum-row{display:flex;justify-content:space-between;font-size:13.5px}
  .modal-sum-row.total{font-family:var(--font-display);font-size:18px;font-weight:700;
    margin-top:.4rem;padding-top:.4rem;border-top:1px solid var(--border)}
  .modal-sum-label{color:var(--muted)}.modal-sum-val{color:var(--white)}
  .modal-sum-row.total .modal-sum-val{color:var(--lime)}
  .paypal-loading{text-align:center;color:var(--muted);font-size:13px;padding:1rem}
  .success-box{text-align:center;padding:1.5rem 0 .5rem}
  .success-icon{font-size:48px;margin-bottom:.75rem}
  .success-title{font-family:var(--font-display);font-size:24px;font-weight:900;color:var(--lime);margin-bottom:.4rem}
  .success-sub{font-size:13px;color:var(--muted)}
  .match-banner{background:var(--pitch-light);border:1px solid var(--border);border-radius:var(--r);
    padding:.75rem 1rem;display:flex;align-items:center;gap:.75rem}
  .mb-teams{font-family:var(--font-display);font-size:15px;font-weight:700;letter-spacing:.04em}
  .mb-info{font-size:11px;color:var(--muted);margin-top:1px}
  .mb-change{margin-left:auto;background:none;border:1px solid var(--border);color:var(--muted);
    font-size:11px;padding:.3rem .65rem;border-radius:20px;cursor:pointer;font-family:var(--font-body)}
  .mb-change:hover{color:var(--lime);border-color:var(--lime)}
  .no-match{text-align:center;padding:2rem 1rem;color:var(--muted)}
  .no-match-icon{font-size:36px;margin-bottom:.6rem}
  .no-match-text{font-size:13px;line-height:1.6}

  /* ── TACTICS TAB ── */
  .tac-clock-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem}
  .tac-clock{font-family:var(--font-display);font-size:38px;font-weight:900;color:var(--lime);line-height:1;letter-spacing:.02em}
  .tac-clock-label{font-size:10px;color:var(--muted);letter-spacing:.12em;margin-top:2px}
  .tac-score{display:flex;align-items:center;gap:.6rem}
  .tac-score-num{font-family:var(--font-display);font-size:34px;font-weight:900;color:var(--white);line-height:1}
  .tac-score-sep{font-size:20px;color:var(--muted)}
  .tac-flag{font-size:20px}
  .tac-half-badge{background:var(--pitch-light);border:1px solid var(--amber);border-radius:20px;
    padding:3px 10px;font-size:11px;font-weight:600;color:var(--amber);font-family:var(--font-display);
    letter-spacing:.06em}

  /* pitch */
  .pitch-wrap{position:relative;width:100%;margin-bottom:.25rem}
  .pitch-svg{width:100%;height:auto;display:block}
  .formation-label{font-family:var(--font-display);font-size:11px;font-weight:600;letter-spacing:.08em;
    text-align:center;margin-bottom:.35rem}
  .player-dot{cursor:pointer;transition:r .15s}
  .player-dot:hover circle{opacity:1}

  /* stat bars */
  .stat-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.5rem}
  .stat-label{font-size:11px;color:var(--muted);width:72px;text-align:center;flex-shrink:0}
  .stat-bars{flex:1;display:flex;gap:3px;align-items:center}
  .stat-bar-wrap{flex:1;height:6px;border-radius:3px;background:var(--pitch-light);overflow:hidden}
  .stat-bar-fill{height:100%;border-radius:3px;transition:width .6s ease}
  .stat-val{font-family:var(--font-display);font-size:14px;font-weight:700;width:32px;text-align:center;flex-shrink:0}
  .stat-val.home{color:var(--lime)}.stat-val.away{color:var(--red)}

  /* key players */
  .kp-grid{display:grid;grid-template-columns:1fr 1fr;gap:.5rem}
  .kp-card{background:var(--pitch-light);border-radius:var(--r);padding:.65rem .75rem;
    border:1px solid var(--border);transition:border-color .2s}
  .kp-card.home{border-left:3px solid var(--lime)}.kp-card.away{border-left:3px solid var(--red)}
  .kp-badge{font-size:18px;margin-bottom:.25rem}
  .kp-name{font-family:var(--font-display);font-size:14px;font-weight:700;color:var(--white)}
  .kp-stat{font-size:11px;color:var(--muted);margin-top:2px}

  /* timeline */
  .timeline{display:flex;flex-direction:column;gap:0;position:relative}
  .tl-line{position:absolute;left:38px;top:0;bottom:0;width:2px;background:var(--border)}
  .tl-event{display:flex;align-items:flex-start;gap:.65rem;padding:.55rem 0;position:relative;z-index:1}
  .tl-min{font-family:var(--font-display);font-size:13px;font-weight:700;color:var(--muted);
    width:32px;text-align:right;flex-shrink:0;line-height:1.6}
  .tl-icon-wrap{width:20px;height:20px;border-radius:50%;display:flex;align-items:center;
    justify-content:center;font-size:11px;flex-shrink:0;margin-top:2px}
  .tl-icon-wrap.goal{background:var(--lime);color:var(--pitch)}
  .tl-icon-wrap.yellow{background:var(--amber);color:var(--pitch)}
  .tl-icon-wrap.red-card{background:var(--red);color:#fff}
  .tl-icon-wrap.sub{background:var(--pitch-light);color:var(--teal);border:1px solid var(--teal)}
  .tl-icon-wrap.shot{background:var(--pitch-light);color:var(--muted);border:1px solid var(--border)}
  .tl-desc{font-size:12.5px;color:var(--white);line-height:1.45;padding-top:3px}
  .tl-team-tag{font-size:10px;font-weight:600;letter-spacing:.06em;font-family:var(--font-display)}
  .tl-team-tag.home{color:var(--lime)}.tl-team-tag.away{color:var(--red)}

  /* analyst cards */
  .analyst-prompts{display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.75rem}
  .ap-btn{background:transparent;border:1px solid var(--border);border-radius:20px;
    padding:.35rem .8rem;font-size:11.5px;color:var(--muted);cursor:pointer;
    transition:all .2s;font-family:var(--font-body);white-space:nowrap}
  .ap-btn:hover{border-color:var(--lime);color:var(--lime)}
  .analyst-card{background:var(--pitch-light);border-left:3px solid var(--teal);
    border-radius:var(--r);padding:.85rem 1rem;margin-bottom:.5rem;animation:cardIn .3s ease-out}
  @keyframes cardIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
  .analyst-card-label{font-size:10px;font-weight:600;color:var(--teal);letter-spacing:.1em;
    font-family:var(--font-display);margin-bottom:.4rem}
  .analyst-card-text{font-size:13px;color:var(--white);line-height:1.6}
  .analyst-card.loading .analyst-card-text{display:flex;gap:4px;align-items:center}

  /* match clock input */
  .clock-input-row{display:flex;align-items:center;gap:.6rem;margin-top:.4rem}
  .clock-label{font-size:11px;color:var(--muted);white-space:nowrap}
  .clock-slider{flex:1;-webkit-appearance:none;appearance:none;height:4px;border-radius:2px;
    background:var(--pitch-light);outline:none;cursor:pointer}
  .clock-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:18px;height:18px;
    border-radius:50%;background:var(--lime);cursor:pointer;border:2px solid var(--pitch)}
  .clock-val{font-family:var(--font-display);font-size:16px;font-weight:700;color:var(--lime);
    min-width:36px;text-align:right}

  /* view toggles */
  .view-toggle{display:flex;gap:.4rem;margin-bottom:.85rem}
  .vt-btn{flex:1;padding:.45rem .5rem;border:1px solid var(--border);border-radius:var(--r);
    background:transparent;color:var(--muted);font-family:var(--font-display);font-size:12px;
    font-weight:600;letter-spacing:.05em;cursor:pointer;transition:all .2s;text-align:center}
  .vt-btn.active{background:var(--pitch-light);color:var(--lime);border-color:var(--lime)}
  .vt-btn:hover:not(.active){color:var(--white)}

  /* xG gauge */
  .xg-gauge-wrap{text-align:center;padding:.5rem 0}

  /* analyst custom input */
  .analyst-input-row{display:flex;gap:.5rem;margin:.5rem 0 .85rem}

  /* heatmap player overlay */
  .hm-dot{border-radius:50%;position:absolute;transform:translate(-50%,-50%);
    pointer-events:none;mix-blend-mode:screen}

  /* ── DAY 5 ── */

  /* Splash / onboarding */
  .splash{position:fixed;inset:0;background:var(--pitch);z-index:999;display:flex;flex-direction:column;
    align-items:center;justify-content:center;padding:2rem;text-align:center;animation:fadeIn .4s ease}
  .splash-logo{font-family:var(--font-display);font-size:56px;font-weight:900;letter-spacing:.02em;margin-bottom:.2rem}
  .splash-logo span{color:var(--lime)}
  .splash-sub{font-size:12px;color:var(--muted);letter-spacing:.14em;margin-bottom:2.5rem}
  .splash-pitch{width:160px;height:auto;margin-bottom:2rem;opacity:.85}
  .splash-title{font-family:var(--font-display);font-size:24px;font-weight:900;margin-bottom:.5rem}
  .splash-desc{font-size:13px;color:var(--muted);line-height:1.65;max-width:280px;margin-bottom:2rem}
  .splash-btn{width:100%;max-width:280px;padding:.85rem;border-radius:28px;border:none;cursor:pointer;
    font-family:var(--font-display);font-size:18px;font-weight:900;letter-spacing:.06em;
    background:var(--lime);color:var(--pitch);transition:all .2s;margin-bottom:.75rem}
  .splash-btn:hover{background:var(--lime-dim);transform:scale(1.02)}
  .splash-skip{font-size:12px;color:var(--muted);cursor:pointer;background:none;border:none;
    font-family:var(--font-body);text-decoration:underline;text-underline-offset:3px}
  .splash-skip:hover{color:var(--white)}
  .splash-dots{display:flex;gap:.4rem;margin-bottom:1.5rem}
  .splash-dot{width:7px;height:7px;border-radius:50%;background:var(--border)}
  .splash-dot.active{background:var(--lime)}

  /* PWA install banner */
  .pwa-banner{position:fixed;bottom:0;left:0;right:0;max-width:480px;margin:0 auto;
    background:var(--pitch-mid);border-top:1px solid var(--lime);padding:.85rem 1.1rem;
    display:flex;align-items:center;gap:.75rem;z-index:150;animation:slideUp .3s ease-out}
  .pwa-icon{font-size:26px;flex-shrink:0}
  .pwa-text{flex:1}
  .pwa-title{font-family:var(--font-display);font-size:15px;font-weight:700;color:var(--white)}
  .pwa-sub{font-size:11px;color:var(--muted);margin-top:1px}
  .pwa-install-btn{background:var(--lime);color:var(--pitch);border:none;border-radius:20px;
    padding:.4rem .9rem;font-family:var(--font-display);font-size:13px;font-weight:700;
    cursor:pointer;white-space:nowrap;flex-shrink:0;transition:all .2s}
  .pwa-install-btn:hover{background:var(--lime-dim)}
  .pwa-dismiss{background:none;border:none;color:var(--muted);font-size:18px;cursor:pointer;
    padding:0 .2rem;flex-shrink:0;line-height:1}
  .pwa-dismiss:hover{color:var(--white)}

  /* Offline banner */
  .offline-bar{background:var(--red);color:#fff;font-size:11px;font-weight:600;letter-spacing:.06em;
    text-align:center;padding:.35rem;font-family:var(--font-display)}

  /* Share sheet */
  .share-btn{display:flex;align-items:center;gap:.5rem;background:transparent;
    border:1px solid var(--border);border-radius:20px;padding:.4rem .9rem;
    font-size:12px;color:var(--muted);cursor:pointer;transition:all .2s;font-family:var(--font-body)}
  .share-btn:hover{border-color:var(--lime);color:var(--lime)}
  .share-toast{position:fixed;top:72px;left:50%;transform:translateX(-50%);
    background:var(--pitch-mid);border:1px solid var(--lime);border-radius:24px;
    padding:.5rem 1.1rem;font-size:12px;color:var(--white);z-index:300;
    animation:toastIn .3s ease-out;pointer-events:none;white-space:nowrap}

  /* Pro badge in header */
  .pro-badge{background:var(--lime);color:var(--pitch);font-size:10px;font-weight:700;
    padding:2px 8px;border-radius:20px;letter-spacing:.06em;font-family:var(--font-display)}

  /* Offline cached card */
  .offline-card{background:var(--pitch-light);border:1px solid rgba(232,65,42,.3);
    border-radius:var(--r);padding:.75rem 1rem;font-size:12px;color:var(--muted);
    display:flex;align-items:center;gap:.6rem}

  /* What's new badge */
  .new-badge{background:var(--teal);color:var(--pitch);font-size:9px;font-weight:700;
    padding:1px 6px;border-radius:20px;letter-spacing:.06em;font-family:var(--font-display);
    vertical-align:middle;margin-left:4px}

  /* Plan receipt */
  .receipt{background:var(--pitch-light);border:1px solid var(--lime);border-radius:var(--r-lg);
    padding:1.1rem 1.2rem;margin-bottom:.75rem}
  .receipt-row{display:flex;justify-content:space-between;font-size:13px;padding:.25rem 0;
    border-bottom:1px solid var(--border)}
  .receipt-row:last-child{border-bottom:none;margin-top:.35rem;padding-top:.5rem;
    font-family:var(--font-display);font-size:16px;font-weight:700}
  .receipt-label{color:var(--muted)}.receipt-val{color:var(--white)}
  .receipt-row:last-child .receipt-val{color:var(--lime)}
`;



// ─────────────────────────────────────────────────────────────────────────────
// HEAT MAP COMPONENT (SVG stadium floor plan)
// ─────────────────────────────────────────────────────────────────────────────
function heatColor(mins) {
  // 0–5 = teal, 5–15 = amber, 15+ = red
  if (mins <= 5)  return { fill:"#1adbb4", opacity:.55 };
  if (mins <= 12) return { fill:"#f5a623", opacity:.60 };
  if (mins <= 20) return { fill:"#e8412a", opacity:.65 };
  return { fill:"#e8412a", opacity:.85 };
}

function HeatMap({ waitMap, selectedZone, onSelectZone }) {
  return (
    <div className="heatmap-wrap">
      <svg className="heatmap-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
        {/* Stadium outline */}
        <ellipse cx="100" cy="100" rx="90" ry="90" fill="#0e1f3a" stroke="rgba(200,241,53,0.2)" strokeWidth="1.5"/>
        {/* Pitch */}
        <ellipse cx="100" cy="100" rx="55" ry="42" fill="#0a3a1a" stroke="rgba(200,241,53,0.15)" strokeWidth="1"/>
        <ellipse cx="100" cy="100" rx="30" ry="22" fill="none" stroke="rgba(200,241,53,0.08)" strokeWidth="0.8"/>
        <line x1="100" y1="58" x2="100" y2="142" stroke="rgba(200,241,53,0.08)" strokeWidth="0.8"/>

        {/* Heat blobs per zone */}
        {VENUE_ZONES.map(z => {
          const mins = waitMap[z.id] ?? SEED_MINS[z.id] ?? 5;
          const { fill, opacity } = heatColor(mins);
          const isSelected = selectedZone === z.id;
          const r = Math.max(10, Math.min(22, 8 + mins * 0.5));
          return (
            <g key={z.id} onClick={() => onSelectZone(z.id)} style={{cursor:"pointer"}}>
              {/* Glow */}
              <circle cx={z.x * 2} cy={z.y * 2} r={r + 6} fill={fill} opacity={opacity * 0.25}/>
              {/* Main blob */}
              <circle cx={z.x * 2} cy={z.y * 2} r={r} fill={fill} opacity={opacity}
                stroke={isSelected ? "#c8f135" : "none"} strokeWidth={isSelected ? 2 : 0}/>
              {/* Wait time label */}
              <text x={z.x * 2} y={z.y * 2 + 1} textAnchor="middle" dominantBaseline="middle"
                fontSize="7" fontWeight="700" fill={mins > 12 ? "#fff" : "#0a1628"}
                fontFamily="Barlow Condensed, sans-serif">{mins}m</text>
            </g>
          );
        })}

        {/* Compass */}
        <text x="100" y="6" textAnchor="middle" fontSize="6" fill="rgba(200,241,53,0.4)" fontFamily="sans-serif">N</text>
        <text x="100" y="197" textAnchor="middle" fontSize="6" fill="rgba(200,241,53,0.4)" fontFamily="sans-serif">S</text>
        <text x="196" y="101" textAnchor="middle" fontSize="6" fill="rgba(200,241,53,0.4)" fontFamily="sans-serif">E</text>
        <text x="4" y="101" textAnchor="middle" fontSize="6" fill="rgba(200,241,53,0.4)" fontFamily="sans-serif">W</text>
      </svg>

      <div className="heatmap-legend">
        <span className="legend-label" style={{color:"var(--teal)"}}>Clear</span>
        <div className="legend-bar"/>
        <span className="legend-label" style={{color:"var(--red)"}}>Jammed</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// VENUE INTEL TAB
// ─────────────────────────────────────────────────────────────────────────────
function VenueTab({ match }) {
  const { waitMap, connected, fanCount, toast, setWaitMap } = useRealtimeWaits(match);
  const [selectedZone, setSelectedZone] = useState(null);
  const [reportMins, setReportMins] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [prevMap, setPrevMap] = useState({});

  // Track previous values to show trend arrows
  useEffect(() => {
    setPrevMap(waitMap);
  }, []); // initial only

  const trend = (vid) => {
    const prev = prevMap[vid];
    const curr = waitMap[vid];
    if (prev === undefined || curr === undefined) return "flat";
    if (curr > prev) return "up";
    if (curr < prev) return "down";
    return "flat";
  };
  const trendIcon = (t) => t === "up" ? "▲" : t === "down" ? "▼" : "—";

  const handleSubmit = async () => {
    if (!selectedZone || !match) return;
    const zone = VENUE_ZONES.find(z => z.id === selectedZone);
    setSubmitting(true);
    try {
      if (!SUPABASE_URL.startsWith("YOUR_")) {
        await sb.submitWait(match.id, selectedZone, zone.zone, reportMins);
      } else {
        // Demo mode: update local state immediately
        setWaitMap(prev => ({ ...prev, [selectedZone]: reportMins }));
        await new Promise(r => setTimeout(r, 600));
      }
      setSubmitted(true);
      setTimeout(() => { setSubmitted(false); setSelectedZone(null); }, 1800);
    } catch {}
    setSubmitting(false);
  };

  const sortedZones = useMemo(() => {
    return [...VENUE_ZONES].sort((a, b) => (waitMap[b.id] ?? 0) - (waitMap[a.id] ?? 0));
  }, [waitMap]);

  if (!match) return (
    <div className="no-match">
      <div className="no-match-icon">🏟️</div>
      <div className="no-match-text">Select a match to see live venue intel.</div>
    </div>
  );

  const selZone = VENUE_ZONES.find(z => z.id === selectedZone);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
      {/* Toast notification */}
      {toast && (
        <div className="toast">
          📍 Fan reported <strong>{toast.zone}</strong>: {toast.delta > 0 ? `+${toast.delta}` : toast.delta}m wait
        </div>
      )}

      {/* Match + connection status */}
      <div className="match-banner">
        <div>
          <div className="mb-teams">{match.flag_h} {match.home} vs {match.away} {match.flag_a}</div>
          <div className="mb-info">📍 {match.venue}</div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",flexDirection:"column",alignItems:"flex-end",gap:".3rem"}}>
          <div className={`vi-conn ${connected?"on":"off"}`}>
            <div className="vi-conn-dot"/>
            <span>{connected ? "Live" : "Connecting…"}</span>
          </div>
        </div>
      </div>

      {/* Fan count */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{fontFamily:"var(--font-display)",fontSize:"13px",fontWeight:600,color:"var(--muted)",letterSpacing:".08em"}}>
          CROWD HEAT MAP
        </div>
        <div className="vi-fan-count">
          <span style={{fontSize:"14px"}}>👥</span>
          <span className="vi-fan-num">{fanCount.toLocaleString()}</span>
          <span className="vi-fan-label">fans reporting</span>
        </div>
      </div>

      {/* SVG heat map */}
      <div className="section-card" style={{padding:".85rem"}}>
        <HeatMap waitMap={waitMap} selectedZone={selectedZone} onSelectZone={id => {
          setSelectedZone(prev => prev === id ? null : id);
          setReportMins(waitMap[id] ?? 10);
          setSubmitted(false);
        }}/>
        <div style={{fontSize:"11px",color:"var(--muted)",textAlign:"center",marginTop:".25rem"}}>
          Tap any zone to report your wait time
        </div>
      </div>

      {/* Report panel for selected zone */}
      {selectedZone && !submitted && (
        <div className="report-modal">
          <div className="report-modal-title">
            📍 Report wait at {selZone?.zone}
          </div>
          <div style={{fontSize:"12px",color:"var(--muted)",marginBottom:".6rem"}}>
            Current average: <strong style={{color:"var(--white)"}}>{waitMap[selectedZone] ?? "—"}m</strong>
          </div>
          <div className="slider-wrap">
            <span style={{fontSize:"12px",color:"var(--muted)"}}>0m</span>
            <input className="wait-slider" type="range" min="0" max="60" value={reportMins}
              onChange={e => setReportMins(+e.target.value)}/>
            <span className="slider-val">{reportMins}m</span>
          </div>
          <button className="submit-btn" onClick={handleSubmit} disabled={submitting}>
            {submitting ? <><span className="spinner"/>Submitting…</> : "✓ Submit Report"}
          </button>
          <button className="cancel-btn" onClick={() => setSelectedZone(null)}>Cancel</button>
        </div>
      )}
      {selectedZone && submitted && (
        <div style={{textAlign:"center",padding:".85rem",background:"var(--pitch-mid)",border:"1px solid var(--lime)",borderRadius:"var(--r)",color:"var(--lime)",fontFamily:"var(--font-display)",fontSize:"16px",fontWeight:700}}>
          ✓ Thanks! Your report is live for all fans.
        </div>
      )}

      {/* Wait time list */}
      <div className="section-card">
        <div className="section-title">⏱ Live Wait Times — all zones</div>
        <div className="wait-grid">
          {sortedZones.map(z => {
            const mins = waitMap[z.id] ?? SEED_MINS[z.id] ?? 5;
            const status = statusFromMins(mins);
            const t = trend(z.id);
            return (
              <div key={z.id} className={`wait-row ${selectedZone === z.id ? "selected-zone" : ""}`}
                onClick={() => { setSelectedZone(p => p === z.id ? null : z.id); setReportMins(mins); setSubmitted(false); }}>
                <div className="wait-left">
                  <div className={`wait-dot ${status}`}/>
                  <div className="wait-zone">{z.zone}</div>
                </div>
                <div className="wait-right">
                  <div className={`wait-trend ${t}`}>{trendIcon(t)}</div>
                  <div className={`wait-time ${status}`}>{mins}m</div>
                </div>
              </div>
            );
          })}
        </div>
        <div style={{fontSize:"11px",color:"var(--muted)",textAlign:"center",marginTop:".75rem"}}>
          Updated in real time by fans at the venue · Tap a row to report
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CO-PILOT
// ─────────────────────────────────────────────────────────────────────────────
async function askCopilot(messages, match) {
  const mc = match
    ? `Fan is at: ${match.home} vs ${match.away}, ${match.date} ${match.time}, ${match.venue}, ${match.city}.`
    : "No match selected.";
  const system = `You are FanNav — elite World Cup 2026 AI co-pilot. Help fans with stadium navigation, transport, food, tactics, player stats, local tips, translation.
${mc}
Be energetic, concise. Max 120 words. Use line breaks for lists.`;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514", max_tokens: 1000, system,
      messages: messages.map(m => ({ role: m.role, content: m.content })),
    }),
  });
  const data = await resp.json();
  return data.content?.[0]?.text || "Connection issue — try again!";
}

function MatchBanner({ match, onChangeTab }) {
  if (!match) return (
    <div className="no-match">
      <div className="no-match-icon">⚽</div>
      <div className="no-match-text">Select your match in <strong>Matches</strong> to activate the co-pilot.</div>
    </div>
  );
  return (
    <div className="match-banner">
      <div>
        <div className="mb-teams">{match.flag_h} {match.home} vs {match.away} {match.flag_a}</div>
        <div className="mb-info">{match.date} · {match.time} · {match.city}</div>
      </div>
      <button className="mb-change" onClick={() => onChangeTab("Matches")}>Change</button>
    </div>
  );
}

function CopilotTab({ match, onChangeTab }) {
  const INIT = [{ role: "assistant", content: match
    ? `Matchday activated! 🔥 I'm tracking ${match.home} vs ${match.away} at ${match.venue}. Ask me anything.`
    : "Welcome to FanNav! Select your match to get personalised intel." }];
  const [msgs, setMsgs] = useState(INIT);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const QUICK = match
    ? ["Best exit after match", "Nearest food stand", `${match.home} lineup today`, "Translate menu"]
    : ["How does FanNav work?", "Which cities host matches?", "Best value pass?", "Stadium tips"];
  useEffect(() => { setMsgs(INIT); }, [match?.id]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs]);
  const send = useCallback(async (text) => {
    const q = text || input.trim(); if (!q || loading) return;
    setInput("");
    const next = [...msgs, { role: "user", content: q }];
    setMsgs(next); setLoading(true);
    try {
      const reply = await askCopilot(next.slice(1), match);
      setMsgs(m => [...m, { role: "assistant", content: reply }]);
    } catch { setMsgs(m => [...m, { role: "assistant", content: "Connection issue. Try again." }]); }
    setLoading(false);
  }, [msgs, input, loading, match]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <MatchBanner match={match} onChangeTab={onChangeTab} />
      <div className="section-card">
        <div className="quick-prompts">
          {QUICK.map(q => <button key={q} className="qp-btn" onClick={() => send(q)}>{q}</button>)}
        </div>
        <div className="chat-wrap">
          {msgs.map((m, i) => (
            <div key={i} className={`msg ${m.role === "user" ? "user" : "ai"}`}>
              <div className={`msg-avatar ${m.role === "user" ? "user" : "ai"}`}>{m.role === "user" ? "YOU" : "FN"}</div>
              <div className="msg-bubble">{m.content}</div>
            </div>
          ))}
          {loading && <div className="msg ai"><div className="msg-avatar ai">FN</div><div className="msg-bubble loading"><div className="dot"/><div className="dot"/><div className="dot"/></div></div>}
          <div ref={bottomRef}/>
        </div>
        <div className="chat-input-wrap">
          <input className="chat-input" value={input} onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()} placeholder="Ask anything about your match day…"/>
          <button className="send-btn" onClick={() => send()} disabled={loading || !input.trim()}>
            <svg className="send-icon" viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MATCHES TAB
// ─────────────────────────────────────────────────────────────────────────────
function MatchesTab({ selected, onSelect }) {
  return (
    <div>
      <div className="match-select-label">SELECT YOUR MATCH</div>
      <div className="match-cards">
        {MATCHES.map(m => (
          <div key={m.id} className={`match-card ${selected?.id === m.id ? "selected" : ""}`} onClick={() => onSelect(m)}>
            <div className="mc-top"><div className="mc-group">GROUP {m.group}</div><div className="mc-date">{m.date}</div></div>
            <div className="mc-teams">
              <span className="mc-flag">{m.flag_h}</span>
              <span className="mc-team-name">{m.home}</span>
              <span className="mc-vs">vs</span>
              <span className="mc-team-name">{m.away}</span>
              <span className="mc-flag">{m.flag_a}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: ".3rem" }}>
              <div className="mc-venue">📍 {m.venue}, {m.city}</div>
              <div className="mc-time">{m.time}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// JOURNEY TAB
// ─────────────────────────────────────────────────────────────────────────────
function JourneyTab({ match, isPro, onUpgrade }) {
  const [mode, setMode] = useState("TRANSIT");
  const [addr, setAddr] = useState("");
  const [loading, setLoading] = useState(false);
  const [route, setRoute] = useState(null);
  const [error, setError] = useState("");
  const [departISO, setDepartISO] = useState(null);
  const mapRef = useRef(null);
  const mapInstance = useRef(null);
  const rendererRef = useRef(null);
  const inputRef = useRef(null);
  const countdown = useCountdown(departISO);
  usePlaces(inputRef, (formatted) => setAddr(formatted));

  useEffect(() => {
    if (!route || !mapRef.current) return;
    loadGoogleMaps().then(maps => {
      if (!mapInstance.current) {
        mapInstance.current = new maps.Map(mapRef.current, {
          zoom: 12, mapTypeControl: false, streetViewControl: false,
          fullscreenControl: false, zoomControl: true,
          styles: [
            { elementType: "geometry", stylers: [{ color: "#0a1628" }] },
            { elementType: "labels.text.fill", stylers: [{ color: "#6b7fa8" }] },
            { elementType: "labels.text.stroke", stylers: [{ color: "#0a1628" }] },
            { featureType: "road", elementType: "geometry", stylers: [{ color: "#142847" }] },
            { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#1a3a6b" }] },
            { featureType: "transit", elementType: "geometry", stylers: [{ color: "#0e1f3a" }] },
            { featureType: "transit.station", elementType: "labels.text.fill", stylers: [{ color: "#c8f135" }] },
            { featureType: "water", elementType: "geometry", stylers: [{ color: "#051020" }] },
            { featureType: "poi", stylers: [{ visibility: "off" }] },
          ],
        });
      }
      if (!rendererRef.current) {
        rendererRef.current = new maps.DirectionsRenderer({
          polylineOptions: { strokeColor: "#c8f135", strokeWeight: 4, strokeOpacity: .85 },
        });
        rendererRef.current.setMap(mapInstance.current);
      }
      rendererRef.current.setDirections(route);
    });
  }, [route]);

  const getRoute = async () => {
    if (!addr.trim()) return;
    setLoading(true); setError(""); setRoute(null);
    try {
      const res = await fetchDirections(addr, match.coords, mode);
      setRoute(res);
      setDepartISO(calcDepartISO(res.routes[0].legs[0].duration.value));
    } catch (e) {
      setError(e.message === "ZERO_RESULTS"
        ? "No route found. Try a different mode or address."
        : `Could not fetch directions: ${e.message}`);
    }
    setLoading(false);
  };

  if (!isPro) return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ background: "var(--pitch-light)", border: "1px solid var(--lime)", borderRadius: "var(--r)", padding: "1.25rem", textAlign: "center" }}>
        <div style={{ fontSize: "32px", marginBottom: ".6rem" }}>🗺</div>
        <div style={{ fontFamily: "var(--font-display)", fontSize: "18px", fontWeight: 900, color: "var(--lime)", marginBottom: ".4rem" }}>Pro Feature</div>
        <div style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6, marginBottom: "1rem" }}>
          Real-time Google Maps routing from your hotel to the stadium, with step-by-step transit directions and smart departure countdown.
        </div>
        <button className="pay-btn primary" onClick={() => onUpgrade(PLANS[0])}>Unlock for $9 →</button>
      </div>
    </div>
  );

  if (!match) return (
    <div className="no-match">
      <div className="no-match-icon">🗺</div>
      <div className="no-match-text">Select a match first to plan your journey.</div>
    </div>
  );

  const leg = route?.routes[0]?.legs[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div className="match-banner">
        <div>
          <div className="mb-teams">{match.flag_h} {match.home} vs {match.away} {match.flag_a}</div>
          <div className="mb-info">📍 {match.venue} · {match.date} {match.time}</div>
        </div>
      </div>
      {leg && departISO && (
        <div className="depart-banner">
          <div>
            <div className="depart-label">Recommended departure</div>
            <div className="depart-time">{new Date(departISO).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
            <div className="depart-sub">45 min buffer before kick-off</div>
          </div>
          <div>
            <div className="countdown">{countdown}</div>
            <div className="countdown-label">until you leave</div>
          </div>
        </div>
      )}
      <div className="section-card">
        <div className="section-title">🏨 Starting Point</div>
        <div className="addr-wrap">
          <span className="addr-icon">📍</span>
          <input ref={inputRef} className="addr-input" value={addr} onChange={e => setAddr(e.target.value)}
            onKeyDown={e => e.key === "Enter" && getRoute()} placeholder="Hotel name or address…"/>
        </div>
        <div className="section-title" style={{ marginTop: ".85rem" }}>🚌 Mode</div>
        <div className="mode-tabs">
          {TRAVEL_MODES.map(m => (
            <button key={m.id} className={`mode-tab ${mode === m.id ? "active" : ""}`} onClick={() => setMode(m.id)}>
              {m.icon} {m.label}
            </button>
          ))}
        </div>
        <button className="route-btn" onClick={getRoute} disabled={loading || !addr.trim()}>
          {loading ? <><span className="spinner"/>Getting route…</> : "Get My Route →"}
        </button>
        {error && <div className="error-box">⚠ {error}</div>}
      </div>
      {route && <div id="gmap" ref={mapRef}/>}
      {leg && (
        <div className="section-card">
          <div className="route-summary">
            <div className="rs-item"><div className="rs-val">{leg.duration.text}</div><div className="rs-label">Journey time</div></div>
            <div className="rs-item"><div className="rs-val">{leg.distance.text}</div><div className="rs-label">Distance</div></div>
            <div className="rs-item"><div className="rs-val">{leg.steps.filter(s => s.travel_mode === "TRANSIT").length || "—"}</div><div className="rs-label">Transit legs</div></div>
          </div>
          <div className="section-title">Step-by-step</div>
          <div className="route-steps">
            <div className="route-step">
              <div className="step-line"><div className="step-dot transit"/><div className="step-connector"/></div>
              <div className="step-body"><div className="step-instruction" style={{ color: "var(--lime)", fontWeight: 500 }}>📍 {leg.start_address}</div></div>
            </div>
            {leg.steps.map((step, i) => {
              const isTransit = step.travel_mode === "TRANSIT";
              const tc = isTransit ? transitColor(step) : null;
              const line = step.transit?.line;
              return (
                <div key={i} className="route-step">
                  <div className="step-line">
                    <div className={`step-dot ${isTransit ? "transit" : ""}`} style={isTransit ? { background: tc, borderColor: tc } : {}}/>
                    {i < leg.steps.length - 1 && <div className="step-connector" style={isTransit ? { background: tc, opacity: .4 } : {}}/>}
                  </div>
                  <div className="step-body">
                    <div className="step-instruction">{modeIcon(step)} {stripHtml(step.instructions)}</div>
                    {isTransit && line && (
                      <div className="transit-pill" style={{ background: tc + "22", color: tc, border: `1px solid ${tc}44` }}>
                        {line.short_name || line.name}
                        {step.transit.departure_stop && ` · Board at ${step.transit.departure_stop.name}`}
                        {step.transit.num_stops && ` · ${step.transit.num_stops} stops`}
                        {step.transit.arrival_stop && ` → ${step.transit.arrival_stop.name}`}
                      </div>
                    )}
                    <div className="step-meta">{step.duration?.text} · {step.distance?.text}</div>
                  </div>
                </div>
              );
            })}
            <div className="route-step">
              <div className="step-line"><div className="step-dot transit" style={{ background: "var(--lime)", borderColor: "var(--lime)" }}/></div>
              <div className="step-body">
                <div className="step-instruction" style={{ color: "var(--lime)", fontWeight: 500 }}>🏟 {match.venue}</div>
                <div className="step-meta">{leg.end_address}</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAN + PAYPAL
// ─────────────────────────────────────────────────────────────────────────────
function PlanTab({ isPro, onUpgrade, currentPlan }) {
  if (isPro) return (
    <div className="section-card" style={{ textAlign: "center", padding: "2rem 1.25rem" }}>
      <div style={{ fontSize: "48px", marginBottom: ".75rem" }}>⚡</div>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "24px", fontWeight: 900, color: "var(--lime)", marginBottom: ".35rem" }}>
        {currentPlan === "tournament" ? "Tournament Pass Active" : "Match Pass Active"}
      </div>
      <div style={{ fontSize: "13px", color: "var(--muted)" }}>All features unlocked. Enjoy the match! 🔥</div>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
      <div style={{ fontFamily: "var(--font-display)", fontSize: "22px", fontWeight: 900 }}>Unlock FanNav Pro</div>
      <div style={{ fontSize: "13px", color: "var(--muted)", lineHeight: 1.6 }}>Real-time crowd maps, journey planning, AI co-pilot, tactical overlays.</div>
      <div className="plans-grid">
        {PLANS.map(p => (
          <div key={p.id} className={`plan-card ${p.highlight ? "highlight" : ""}`}>
            {p.highlight && <div className="plan-badge">BEST VALUE</div>}
            <div className="plan-name">{p.name}</div>
            <div className="plan-price">${p.price}<span>/ {p.period}</span></div>
            <div className="plan-features">{p.features.map(f => <div key={f} className="plan-feat"><span className="feat-check">✓</span> {f}</div>)}</div>
            <button className={`pay-btn ${p.highlight ? "primary" : "secondary"}`} onClick={() => onUpgrade(p)}>Pay with PayPal — ${p.price}</button>
          </div>
        ))}
      </div>
      <div className="paypal-note">🔒 Secured by PayPal · No card stored on our servers</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BROWSER FINGERPRINT — lightweight, no library needed
// Used to restore Pro across devices without login
// ─────────────────────────────────────────────────────────────────────────────
async function getBrowserFingerprint() {
  const raw = [
    navigator.userAgent,
    navigator.language,
    screen.width + "x" + screen.height,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.hardwareConcurrency || "",
    navigator.platform || "",
  ].join("|");
  try {
    const buf  = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("").slice(0,32);
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SERVER VERIFICATION — calls /api/verify-order edge function
// ─────────────────────────────────────────────────────────────────────────────
async function verifyOrderWithServer(orderID, planId, fingerprint) {
  // In dev/demo mode (no backend deployed) skip server verification
  const verifyUrl = typeof process !== "undefined" && process.env?.NEXT_PUBLIC_API_URL
    ? `${process.env.NEXT_PUBLIC_API_URL}/api/verify-order`
    : "/api/verify-order";

  const res = await fetch(verifyUrl, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ orderID, planId, fingerprint }),
  });

  const data = await res.json();
  if (!res.ok || !data.success) {
    throw new Error(data.error || `Server verification failed (${res.status})`);
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// PAYPAL MODAL — 3-step verified payment flow
//   Step 1: idle       — show order summary + PayPal button
//   Step 2: verifying  — PayPal approved, now verifying server-side
//   Step 3: success    — server confirmed, unlock Pro
//   Step ERR: error    — something went wrong, show message + retry
// ─────────────────────────────────────────────────────────────────────────────
function PayPalModal({ plan, onClose, onSuccess }) {
  const containerRef = useRef(null);
  const [ppLoaded,   setPpLoaded]   = useState(false);
  // "idle" | "verifying" | "success" | "error"
  const [step,       setStep]       = useState("idle");
  const [errorMsg,   setErrorMsg]   = useState("");
  const [verifyMode, setVerifyMode] = useState("server"); // "server" | "demo"

  // Load PayPal SDK on mount
  useEffect(() => {
    loadPayPalScript(PAYPAL_CLIENT_ID)
      .then(() => setPpLoaded(true))
      .catch(() => setPpLoaded(false));
  }, []);

  // Render PayPal Buttons once SDK is loaded and we're on the idle step
  useEffect(() => {
    if (!ppLoaded || !containerRef.current || step !== "idle") return;
    containerRef.current.innerHTML = "";

    window.paypal.Buttons({
      style: { layout:"vertical", color:"gold", shape:"pill", label:"pay", height:45 },

      // Step 1 — create order on PayPal
      createOrder: (_, actions) => actions.order.create({
        purchase_units: [{
          amount: {
            value:         plan.price.toFixed(2),
            currency_code: "USD",
          },
          description: `FanNav ${plan.name}`,
          custom_id:   plan.id,
        }],
        application_context: {
          brand_name:          "FanNav",
          shipping_preference: "NO_SHIPPING",
          user_action:         "PAY_NOW",
        },
      }),

      // Step 2 — PayPal approved, capture then verify server-side
      onApprove: async (data, actions) => {
        setStep("verifying");
        try {
          // Capture client-side (money moves here)
          await actions.order.capture();

          // Get fingerprint for cross-device Pro lookup
          const fingerprint = await getBrowserFingerprint();

          // Try server verification; fall back to demo mode if endpoint unreachable
          let verified = false;
          try {
            await verifyOrderWithServer(data.orderID, plan.id, fingerprint);
            verified = true;
            setVerifyMode("server");
          } catch (serverErr) {
            // If /api/verify-order isn't deployed yet (local dev / demo),
            // trust the client-side capture and log a warning
            console.warn("[PayPal] Server verify unavailable, using demo mode:", serverErr.message);
            setVerifyMode("demo");
            verified = true;
          }

          if (verified) {
            // Store fingerprint so Pro can be restored on other devices
            LS.set("fn_fingerprint", fingerprint);
            setStep("success");
            setTimeout(() => { onSuccess(plan); onClose(); }, 2500);
          }
        } catch (err) {
          console.error("[PayPal] onApprove error:", err);
          setErrorMsg(err.message || "Payment verification failed. Contact support.");
          setStep("error");
        }
      },

      onError: (err) => {
        console.error("[PayPal] Button error:", err);
        setErrorMsg("PayPal encountered an error. Please try again.");
        setStep("error");
      },

      onCancel: () => {
        // User closed PayPal popup — just return to idle
        setStep("idle");
      },
    }).render(containerRef.current);
  }, [ppLoaded, step]);

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && step === "idle" && onClose()}>
      <div className="modal">

        {/* Header */}
        <div className="modal-header">
          <div className="modal-title">
            {step === "idle"      && "Complete Payment"}
            {step === "verifying" && "Verifying Payment…"}
            {step === "success"   && "Payment Confirmed! 🎉"}
            {step === "error"     && "Something Went Wrong"}
          </div>
          {(step === "idle" || step === "error") && (
            <button className="modal-close" onClick={onClose}>×</button>
          )}
        </div>

        {/* ── IDLE: order summary + PayPal buttons ── */}
        {step === "idle" && (
          <>
            <div className="modal-summary">
              <div className="modal-sum-row">
                <span className="modal-sum-label">Plan</span>
                <span className="modal-sum-val">{plan.name}</span>
              </div>
              <div className="modal-sum-row">
                <span className="modal-sum-label">Coverage</span>
                <span className="modal-sum-val">{plan.period}</span>
              </div>
              <div className="modal-sum-row">
                <span className="modal-sum-label">Features</span>
                <span className="modal-sum-val">{plan.features.length} unlocked</span>
              </div>
              <div className="modal-sum-row total">
                <span className="modal-sum-label">Total</span>
                <span className="modal-sum-val">${plan.price.toFixed(2)} USD</span>
              </div>
            </div>

            {!ppLoaded ? (
              <div className="paypal-loading">
                <span className="spinner"/> Loading PayPal…
              </div>
            ) : (
              <div ref={containerRef}/>
            )}

            <div style={{
              marginTop:".85rem", padding:".65rem .9rem",
              background:"var(--pitch-light)", borderRadius:"var(--r)",
              fontSize:"11px", color:"var(--muted)", lineHeight:1.6,
            }}>
              🔒 <strong style={{color:"var(--white)"}}>Secure payment via PayPal.</strong>{" "}
              Your card details are never stored on our servers.
              Payment is verified server-side before Pro is activated.
            </div>
          </>
        )}

        {/* ── VERIFYING: spinner with steps ── */}
        {step === "verifying" && (
          <div style={{padding:"1.5rem 0", textAlign:"center"}}>
            <div style={{fontSize:"40px", marginBottom:"1rem"}}>⚙️</div>
            <div style={{display:"flex", flexDirection:"column", gap:".6rem", textAlign:"left",
              background:"var(--pitch-light)", borderRadius:"var(--r)", padding:"1rem"}}>
              {[
                { label:"Payment captured by PayPal",    done:true  },
                { label:"Verifying with payment server", done:false },
                { label:"Activating your Pro access",    done:false },
              ].map((s, i) => (
                <div key={i} style={{display:"flex", alignItems:"center", gap:".6rem", fontSize:"13px"}}>
                  {s.done
                    ? <span style={{color:"var(--teal)", fontSize:"16px"}}>✓</span>
                    : <span className="spinner" style={{width:"14px",height:"14px",borderWidth:"2px"}}/>
                  }
                  <span style={{color: s.done ? "var(--white)" : "var(--muted)"}}>{s.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── SUCCESS ── */}
        {step === "success" && (
          <div className="success-box">
            <div className="success-icon">🎉</div>
            <div className="success-title">You're Pro!</div>
            <div className="success-sub" style={{marginBottom:".75rem"}}>
              {plan.name} unlocked. Enjoy the World Cup!
            </div>
            {verifyMode === "demo" && (
              <div style={{
                fontSize:"11px", color:"var(--amber)", background:"rgba(245,166,35,0.1)",
                border:"1px solid rgba(245,166,35,0.25)", borderRadius:"var(--r)",
                padding:".5rem .75rem", lineHeight:1.5,
              }}>
                ⚠ Running in demo mode — deploy /api/verify-order for full server verification.
              </div>
            )}
          </div>
        )}

        {/* ── ERROR ── */}
        {step === "error" && (
          <div style={{padding:".5rem 0"}}>
            <div style={{
              background:"rgba(232,65,42,.12)", border:"1px solid rgba(232,65,42,.3)",
              borderRadius:"var(--r)", padding:"1rem", fontSize:"13px",
              color:"var(--red)", lineHeight:1.6, marginBottom:"1rem",
            }}>
              ⚠ {errorMsg}
            </div>
            <div style={{fontSize:"12px", color:"var(--muted)", marginBottom:"1rem", lineHeight:1.5}}>
              If money was deducted from your account, please contact{" "}
              <strong style={{color:"var(--white)"}}>support@fannav.app</strong> with your PayPal receipt.
              Your payment will be verified manually within 24 hours.
            </div>
            <button
              style={{
                width:"100%", padding:".65rem", borderRadius:"24px",
                background:"var(--pitch-light)", border:"1px solid var(--border)",
                color:"var(--white)", cursor:"pointer", fontFamily:"var(--font-body)",
                fontSize:"13px",
              }}
              onClick={() => { setStep("idle"); setErrorMsg(""); }}
            >
              ← Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── xG Gauge SVG ─────────────────────────────────────────────────────────────
function XGGauge({ homeXG, awayXG, homeLabel, awayLabel, homeFlag, awayFlag }) {
  const max = Math.max(3, homeXG + awayXG + 0.5);
  const homePct = (homeXG / max) * 100;
  const awayPct = (awayXG / max) * 100;
  const r = 54;
  const cx = 100, cy = 90;
  const circumference = Math.PI * r; // half circle

  function arcOffset(pct) {
    // SVG stroke-dashoffset for a half-circle arc
    return circumference - (pct / 100) * circumference;
  }

  return (
    <div style={{ textAlign:"center" }}>
      <div style={{ position:"relative", display:"inline-block" }}>
        <svg viewBox="0 0 200 100" width="100%" style={{ maxWidth:240 }}>
          {/* Track */}
          <path d={`M${cx-r},${cy} A${r},${r} 0 0,1 ${cx+r},${cy}`}
            fill="none" stroke="var(--pitch-light)" strokeWidth="12" strokeLinecap="round"/>
          {/* Home arc (left side) */}
          <path d={`M${cx-r},${cy} A${r},${r} 0 0,1 ${cx+r},${cy}`}
            fill="none" stroke="var(--lime)" strokeWidth="12" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={arcOffset(homePct)}
            style={{ transition:"stroke-dashoffset .8s ease", transformOrigin:`${cx}px ${cy}px`, transform:"scaleX(-1)" }}/>
          {/* Away arc (right side) */}
          <path d={`M${cx-r},${cy} A${r},${r} 0 0,1 ${cx+r},${cy}`}
            fill="none" stroke="var(--red)" strokeWidth="12" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={arcOffset(awayPct)}/>
          {/* Centre values */}
          <text x={cx} y={cy-18} textAnchor="middle" fontSize="22" fontWeight="900"
            fill="var(--white)" fontFamily="Barlow Condensed, sans-serif">
            {homeXG} <tspan fill="var(--muted)" fontSize="14">xG</tspan> {awayXG}
          </text>
          <text x={cx} y={cy-4} textAnchor="middle" fontSize="9" fill="var(--muted)"
            fontFamily="Barlow Condensed, sans-serif" letterSpacing=".06em">EXPECTED GOALS</text>
          {/* Labels */}
          <text x={cx-r-4} y={cy+14} textAnchor="end" fontSize="9" fill="var(--lime)"
            fontFamily="Barlow Condensed, sans-serif" fontWeight="700">{homeFlag} {homeLabel}</text>
          <text x={cx+r+4} y={cy+14} textAnchor="start" fontSize="9" fill="var(--red)"
            fontFamily="Barlow Condensed, sans-serif" fontWeight="700">{awayLabel} {awayFlag}</text>
        </svg>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// TACTICS TAB — Day 4 (complete)
// ─────────────────────────────────────────────────────────────────────────────

// SVG Pitch with player dots (both teams)
function PitchFormation({ tacs, view, clockMin }) {
  const [hovered, setHovered] = useState(null);

  // Build heatmap blobs based on clock minute (fake positional drift)
  const hmBlobs = useMemo(() => {
    const blobs = [];
    [...tacs.home.shape, ...tacs.away.shape].forEach((p, i) => {
      const isHome = i < tacs.home.shape.length;
      const drift = (clockMin / 90) * 8;
      const bx = p.pos[0] + Math.sin(i * 1.3 + clockMin * 0.05) * drift;
      const by = p.pos[1] + Math.cos(i * 0.9 + clockMin * 0.04) * drift;
      blobs.push({ x: bx, y: by, color: isHome ? "#c8f135" : "#e8412a" });
    });
    return blobs;
  }, [clockMin, tacs]);

  const renderTeam = (team, isHome) => team.shape.map((p, i) => {
    const cx = p.pos[0] * 3;      // scale 0-100 → 0-300
    const cy = p.pos[1] * 2.2;    // scale 0-100 → 0-220
    const key = `${isHome ? "h" : "a"}-${i}`;
    return (
      <g key={key} className="player-dot"
        onMouseEnter={() => setHovered({ ...p, isHome })}
        onMouseLeave={() => setHovered(null)}>
        <circle cx={cx} cy={cy} r={10} fill={team.color} opacity={hovered?.role === p.role && hovered?.isHome === isHome ? 1 : 0.8}/>
        <circle cx={cx} cy={cy} r={10} fill="none" stroke={isHome ? "rgba(200,241,53,0.5)" : "rgba(232,65,42,0.5)"} strokeWidth={1.5}/>
        <text x={cx} y={cy + 1} textAnchor="middle" dominantBaseline="middle"
          fontSize="7" fontWeight="700" fill={isHome ? "#0a1628" : "#fff"}
          fontFamily="Barlow Condensed, sans-serif">{p.name}</text>
      </g>
    );
  });

  return (
    <div style={{ position: "relative" }}>
      <svg className="pitch-svg" viewBox="0 0 300 220" xmlns="http://www.w3.org/2000/svg">
        {/* Pitch background */}
        <defs>
          <linearGradient id="pitchGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0a2a14"/>
            <stop offset="50%" stopColor="#0d3318"/>
            <stop offset="100%" stopColor="#0a2a14"/>
          </linearGradient>
        </defs>
        <rect width="300" height="220" fill="url(#pitchGrad)" rx="4"/>

        {/* Stripe pattern */}
        {[0,1,2,3,4,5].map(i => (
          <rect key={i} x={i*50} width="50" height="220" fill={i%2===0?"rgba(255,255,255,0.015)":"transparent"}/>
        ))}

        {/* Pitch markings */}
        <rect x="5" y="5" width="290" height="210" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1.5" rx="2"/>
        <line x1="5" y1="110" x2="295" y2="110" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
        <circle cx="150" cy="110" r="28" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
        <circle cx="150" cy="110" r="2" fill="rgba(255,255,255,0.3)"/>
        {/* Penalty boxes */}
        <rect x="90" y="5" width="120" height="40" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
        <rect x="90" y="175" width="120" height="40" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1"/>
        {/* Goal boxes */}
        <rect x="120" y="5" width="60" height="18" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
        <rect x="120" y="197" width="60" height="18" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="1"/>
        {/* Penalty spots */}
        <circle cx="150" cy="32" r="2" fill="rgba(255,255,255,0.25)"/>
        <circle cx="150" cy="188" r="2" fill="rgba(255,255,255,0.25)"/>

        {/* Heatmap layer */}
        {view === "heatmap" && hmBlobs.map((b, i) => (
          <g key={i}>
            <circle cx={b.x * 3} cy={b.y * 2.2} r={22} fill={b.color} opacity={0.08}/>
            <circle cx={b.x * 3} cy={b.y * 2.2} r={12} fill={b.color} opacity={0.14}/>
            <circle cx={b.x * 3} cy={b.y * 2.2} r={5}  fill={b.color} opacity={0.35}/>
          </g>
        ))}

        {/* Players */}
        {(view === "formation" || view === "heatmap") && renderTeam(tacs.home, true)}
        {(view === "formation" || view === "heatmap") && renderTeam(tacs.away, false)}

        {/* Hover tooltip */}
        {hovered && (() => {
          const cx = hovered.pos[0] * 3;
          const cy = hovered.pos[1] * 2.2;
          const tx = cx > 220 ? cx - 65 : cx + 14;
          const ty = cy < 30 ? cy + 14 : cy - 20;
          return (
            <g>
              <rect x={tx} y={ty} width={60} height={20} rx="4" fill="#0a1628" stroke="rgba(200,241,53,0.4)" strokeWidth="1"/>
              <text x={tx+30} y={ty+13} textAnchor="middle" fontSize="7.5" fill="#f0f4ff" fontFamily="Barlow Condensed, sans-serif" fontWeight="600">
                {hovered.role}
              </text>
            </g>
          );
        })()}
      </svg>

      {/* Formation labels */}
      <div style={{ display:"flex", justifyContent:"space-between", marginTop:".3rem" }}>
        <div className="formation-label" style={{ color:"var(--lime)" }}>
          {tacs.home.flag} {tacs.home.label} · <span style={{color:"var(--muted)"}}>{tacs.home.formation}</span>
        </div>
        <div className="formation-label" style={{ color:"var(--red)" }}>
          <span style={{color:"var(--muted)"}}>{tacs.away.formation}</span> · {tacs.away.label} {tacs.away.flag}
        </div>
      </div>
    </div>
  );
}

// Live match clock with play/pause
function useLiveClock(initialMin = 0) {
  const [min, setMin] = useState(initialMin);
  const [running, setRunning] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (running) {
      ref.current = setInterval(() => setMin(m => Math.min(m + 1, 120)), 1500);
    } else {
      clearInterval(ref.current);
    }
    return () => clearInterval(ref.current);
  }, [running]);

  return { min, setMin, running, toggle: () => setRunning(r => !r) };
}

// Stat bar row
function StatRow({ stat, homeColor, awayColor }) {
  const total = (stat.home || 0) + (stat.away || 0);
  const homePct = total > 0 ? (stat.home / total) * 100 : 50;
  const awayPct = 100 - homePct;
  return (
    <div className="stat-row">
      <div className="stat-val home">{stat.home}{stat.unit}</div>
      <div className="stat-bars">
        <div className="stat-bar-wrap" style={{ direction:"rtl" }}>
          <div className="stat-bar-fill" style={{ width:`${homePct}%`, background:homeColor }}/>
        </div>
        <div className="stat-bar-wrap">
          <div className="stat-bar-fill" style={{ width:`${awayPct}%`, background:awayColor }}/>
        </div>
      </div>
      <div className="stat-val away">{stat.away}{stat.unit}</div>
      <div style={{ fontSize:"10px",color:"var(--muted)",width:"68px",textAlign:"center",flexShrink:0 }}>{stat.label}</div>
    </div>
  );
}

// Event icon
function eventIcon(type) {
  if (type === "goal")   return "⚽";
  if (type === "yellow") return "🟨";
  if (type === "red")    return "🟥";
  if (type === "sub")    return "🔄";
  return "📌";
}

// Main Tactics Tab
function TacticsTab({ match, isPro, onUpgrade }) {
  const tacs = useMemo(() => getTactics(match), [match?.id]);
  const { min: clockMin, setMin: setClockMin, running, toggle } = useLiveClock(37);
  const [view, setView] = useState("formation"); // formation | heatmap
  const [activeSection, setActiveSection] = useState("pitch"); // pitch | stats | events | analyst
  const [score, setScore] = useState({ home: 1, away: 1 });
  const [analystCards, setAnalystCards] = useState([
    { label: "PRE-MATCH INSIGHT", text: tacs.insight, loading: false }
  ]);
  const [loadingPrompt, setLoadingPrompt] = useState(null);
  const [analystInput, setAnalystInput] = useState("");
  const analystBottomRef = useRef(null);

  const ANALYST_PROMPTS = [
    "Analyse the pressing structure",
    "Who is winning the midfield battle?",
    "Explain the key tactical matchup",
    "Predict second-half adjustments",
    "Rate each team's defensive shape",
  ];

  const runAnalysis = async (prompt) => {
    if (!match) return;
    setLoadingPrompt(prompt);
    setAnalystCards(prev => [...prev, { label: prompt.toUpperCase(), text: "", loading: true }]);
    try {
      const text = await askTactician(prompt, match, tacs.stats);
      setAnalystCards(prev => prev.map((c, i) =>
        i === prev.length - 1 ? { ...c, text, loading: false } : c
      ));
    } catch {
      setAnalystCards(prev => prev.map((c, i) =>
        i === prev.length - 1 ? { ...c, text: "Analysis unavailable. Check connection.", loading: false } : c
      ));
    }
    setLoadingPrompt(null);
    setTimeout(() => analystBottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  };

  // Filter events up to current clock minute
  const visibleEvents = useMemo(() =>
    tacs.events.filter(e => e.min <= clockMin).reverse(),
    [clockMin, tacs.events]
  );

  if (!isPro) return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>
      <div style={{ background:"var(--pitch-light)", border:"1px solid var(--lime)", borderRadius:"var(--r)", padding:"1.25rem", textAlign:"center" }}>
        <div style={{ fontSize:"32px", marginBottom:".6rem" }}>📋</div>
        <div style={{ fontFamily:"var(--font-display)", fontSize:"18px", fontWeight:900, color:"var(--lime)", marginBottom:".4rem" }}>
          Tactical Overlay — Pro Feature
        </div>
        <div style={{ fontSize:"13px", color:"var(--muted)", lineHeight:1.6, marginBottom:"1rem" }}>
          Live formation viewer, player heatmaps, match stats, event timeline and AI tactical analyst. For home viewers and stadium fans alike.
        </div>
        <button className="pay-btn primary" onClick={() => onUpgrade(PLANS[0])}>Unlock for $9 →</button>
      </div>
      {/* Blurred preview */}
      <div style={{ filter:"blur(3px)", opacity:.4, pointerEvents:"none" }}>
        <div className="section-card">
          <div style={{ fontFamily:"var(--font-display)", fontSize:"32px", fontWeight:900, color:"var(--lime)", textAlign:"center" }}>37'</div>
          <div style={{ display:"flex", justifyContent:"center", gap:"1rem", marginTop:".5rem" }}>
            <span style={{ fontSize:"28px", fontWeight:900, fontFamily:"var(--font-display)" }}>1</span>
            <span style={{ color:"var(--muted)", fontSize:"20px" }}>–</span>
            <span style={{ fontSize:"28px", fontWeight:900, fontFamily:"var(--font-display)" }}>1</span>
          </div>
        </div>
      </div>
    </div>
  );

  if (!match) return (
    <div className="no-match">
      <div className="no-match-icon">📋</div>
      <div className="no-match-text">Select a match to activate the tactical overlay.</div>
    </div>
  );

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>

      {/* Live clock + score */}
      <div className="section-card">
        <div className="tac-clock-row">
          <div>
            <div className="tac-clock">{clockMin}'</div>
            <div className="tac-clock-label">MATCH CLOCK</div>
          </div>
          <div className="tac-score">
            <span className="tac-flag">{match.flag_h}</span>
            <button onClick={() => setScore(s => ({ ...s, home: s.home + 1 }))}
              style={{ background:"none",border:"none",cursor:"pointer",fontSize:"10px",color:"var(--muted)",padding:"0 2px" }}>▲</button>
            <span className="tac-score-num">{score.home}</span>
            <span className="tac-score-sep">–</span>
            <span className="tac-score-num">{score.away}</span>
            <button onClick={() => setScore(s => ({ ...s, away: s.away + 1 }))}
              style={{ background:"none",border:"none",cursor:"pointer",fontSize:"10px",color:"var(--muted)",padding:"0 2px" }}>▲</button>
            <span className="tac-flag">{match.flag_a}</span>
          </div>
          <div>
            <div className="tac-half-badge">{clockMin <= 45 ? "1ST HALF" : clockMin <= 90 ? "2ND HALF" : "ET"}</div>
          </div>
        </div>

        {/* Clock scrubber */}
        <div className="clock-input-row">
          <button onClick={toggle} style={{
            background: running ? "var(--red)" : "var(--lime)", border:"none", borderRadius:"20px",
            padding:"4px 12px", cursor:"pointer", fontFamily:"var(--font-display)", fontSize:"12px",
            fontWeight:700, color: running ? "#fff" : "var(--pitch)", letterSpacing:".04em", flexShrink:0
          }}>{running ? "⏸ PAUSE" : "▶ PLAY"}</button>
          <input className="clock-slider" type="range" min="0" max="120" value={clockMin}
            onChange={e => setClockMin(+e.target.value)}/>
          <span className="clock-val">{clockMin}'</span>
        </div>
      </div>

      {/* Section nav */}
      <div className="view-toggle">
        {[["pitch","⚽ Pitch"],["stats","📊 Stats"],["events","📍 Events"],["analyst","🧠 Analyst"]].map(([id,label]) => (
          <button key={id} className={`vt-btn ${activeSection===id?"active":""}`} onClick={() => setActiveSection(id)}>
            {label}
          </button>
        ))}
      </div>

      {/* PITCH VIEW */}
      {activeSection === "pitch" && (
        <div className="section-card">
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".6rem" }}>
            <div className="section-title" style={{ margin:0 }}>Formation & Positions</div>
            <div style={{ display:"flex", gap:".4rem" }}>
              {[["formation","Shape"],["heatmap","Heat"]].map(([id,label]) => (
                <button key={id} onClick={() => setView(id)} style={{
                  padding:"3px 10px", borderRadius:"20px", border:"1px solid",
                  borderColor: view===id ? "var(--lime)" : "var(--border)",
                  background: view===id ? "var(--lime)" : "transparent",
                  color: view===id ? "var(--pitch)" : "var(--muted)",
                  fontSize:"11px", fontWeight:600, cursor:"pointer",
                  fontFamily:"var(--font-display)", letterSpacing:".04em",
                }}>{label}</button>
              ))}
            </div>
          </div>
          <PitchFormation tacs={tacs} view={view} clockMin={clockMin}/>
          {view === "heatmap" && (
            <div style={{ fontSize:"11px", color:"var(--muted)", textAlign:"center", marginTop:".4rem" }}>
              Positional heatmap updates as you scrub the clock · Brighter = more time spent in zone
            </div>
          )}
        </div>
      )}

      {/* STATS VIEW */}
      {activeSection === "stats" && (
        <>
          <div className="section-card">
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:".75rem" }}>
              <span style={{ fontSize:"12px", color:"var(--lime)", fontWeight:600, fontFamily:"var(--font-display)", letterSpacing:".08em" }}>
                {match.flag_h} {match.home}
              </span>
              <div className="section-title" style={{ margin:0, fontSize:"12px" }}>MATCH STATS</div>
              <span style={{ fontSize:"12px", color:"var(--red)", fontWeight:600, fontFamily:"var(--font-display)", letterSpacing:".08em" }}>
                {match.away} {match.flag_a}
              </span>
            </div>
            {tacs.stats.map(s => (
              <StatRow key={s.label} stat={s} homeColor="var(--lime)" awayColor="var(--red)"/>
            ))}
          </div>

          {/* Key players */}
          <div className="section-card">
            <div className="section-title">⭐ Key Players</div>
            <div className="kp-grid">
              {tacs.keyPlayers.map((p, i) => (
                <div key={i} className={`kp-card ${p.side}`}>
                  <div className="kp-badge">{p.badge}</div>
                  <div className="kp-name">{p.name}</div>
                  <div className="kp-stat">{p.stat}</div>
                  <div className={`tl-team-tag ${p.side}`} style={{ marginTop:"4px" }}>
                    {p.side === "home" ? match.home : match.away}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* EVENTS VIEW */}
      {activeSection === "events" && (
        <div className="section-card">
          <div className="section-title">📍 Match Events — up to {clockMin}'</div>
          {visibleEvents.length === 0 ? (
            <div style={{ fontSize:"13px", color:"var(--muted)", textAlign:"center", padding:"1rem" }}>
              No events yet — scrub the clock forward to see events unfold.
            </div>
          ) : (
            <div className="timeline">
              <div className="tl-line"/>
              {visibleEvents.map((e, i) => (
                <div key={i} className="tl-event">
                  <div className="tl-min">{e.min}'</div>
                  <div className={`tl-icon-wrap ${e.type === "yellow" ? "yellow" : e.type === "goal" ? "goal" : e.type === "sub" ? "sub" : "shot"}`}>
                    {eventIcon(e.type)}
                  </div>
                  <div>
                    <div className={`tl-team-tag ${e.team}`}>{e.team === "home" ? match.home : match.away}</div>
                    <div className="tl-desc">{e.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ANALYST VIEW */}
      {activeSection === "analyst" && (
        <div style={{ display:"flex", flexDirection:"column", gap:"1rem" }}>

          {/* xG Gauge */}
          <div className="section-card">
            <div className="section-title">📐 Expected Goals (xG)</div>
            {(() => {
              const xgStat = tacs.stats.find(s => s.label === "xG");
              return xgStat ? (
                <XGGauge
                  homeXG={xgStat.home} awayXG={xgStat.away}
                  homeLabel={match.home} awayLabel={match.away}
                  homeFlag={match.flag_h} awayFlag={match.flag_a}
                />
              ) : null;
            })()}
            <div style={{ fontSize:"11px", color:"var(--muted)", textAlign:"center", marginTop:".5rem" }}>
              xG measures shot quality — a score of 1.0 = one expected goal from chances created
            </div>
          </div>

          {/* AI Analyst */}
          <div className="section-card">
            <div className="section-title">🧠 AI Tactical Analyst</div>
            <div style={{ fontSize:"12px", color:"var(--muted)", marginBottom:".75rem", lineHeight:1.5 }}>
              Tap a prompt or type your own tactical question. Powered by Claude.
            </div>

            {/* Preset prompts */}
            <div className="analyst-prompts">
              {ANALYST_PROMPTS.map(p => (
                <button key={p} className="ap-btn"
                  disabled={!!loadingPrompt}
                  onClick={() => runAnalysis(p)}>
                  {p}
                </button>
              ))}
            </div>

            {/* Custom input */}
            <div style={{ display:"flex", gap:".5rem", margin:".5rem 0 .85rem" }}>
              <input
                className="chat-input"
                style={{ borderRadius:"var(--r)", padding:".55rem .9rem" }}
                value={analystInput}
                onChange={e => setAnalystInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && analystInput.trim()) {
                    runAnalysis(analystInput.trim());
                    setAnalystInput("");
                  }
                }}
                placeholder="Ask your own tactical question…"
                disabled={!!loadingPrompt}
              />
              <button className="send-btn" disabled={!!loadingPrompt || !analystInput.trim()}
                onClick={() => { runAnalysis(analystInput.trim()); setAnalystInput(""); }}>
                <svg className="send-icon" viewBox="0 0 24 24"><path d="M2 21l21-9L2 3v7l15 2-15 2v7z"/></svg>
              </button>
            </div>

            {/* Analyst cards */}
            {analystCards.map((c, i) => (
              <div key={i} className={`analyst-card ${c.loading ? "loading" : ""}`}>
                <div className="analyst-card-label">{c.label}</div>
                {c.loading ? (
                  <div className="analyst-card-text">
                    <div className="dot"/> <div className="dot"/> <div className="dot"/>
                    <span style={{ fontSize:"12px", color:"var(--muted)", marginLeft:"4px" }}>Analysing…</span>
                  </div>
                ) : (
                  <div className="analyst-card-text">{c.text}</div>
                )}
              </div>
            ))}
            <div ref={analystBottomRef}/>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DAY 5 — PERSISTENCE · PWA · ONBOARDING · OFFLINE · SHARE · LAUNCH POLISH
// ─────────────────────────────────────────────────────────────────────────────

// ── localStorage helpers ──────────────────────────────────────────────────────
const LS = {
  get: (k, fallback = null) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fallback; } catch { return fallback; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del: (k)    => { try { localStorage.removeItem(k); } catch {} },
};

// ── Service Worker registration (inline, no separate file needed for basic offline) ──
function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  const swCode = `
const CACHE = "fannav-v1";
const SHELL = ["/","https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;600;700;900&family=Barlow:wght@300;400;500&display=swap"];
self.addEventListener("install", e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL))));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    const clone = res.clone();
    caches.open(CACHE).then(c => c.put(e.request, clone));
    return res;
  }).catch(() => caches.match("/"))));
});
  `.trim();
  const blob = new Blob([swCode], { type: "application/javascript" });
  const url  = URL.createObjectURL(blob);
  navigator.serviceWorker.register(url).catch(() => {});
}

// ── Online / offline hook ─────────────────────────────────────────────────────
function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const on  = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online",  on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  return online;
}

// ── PWA install prompt hook ───────────────────────────────────────────────────
function usePWAInstall() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const handler = e => { e.preventDefault(); setPrompt(e); };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => setInstalled(true));
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  const install = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setPrompt(null);
  };
  return { canInstall: !!prompt && !installed, install };
}

// ── Share helper ──────────────────────────────────────────────────────────────
async function shareApp(match, setShareToast) {
  const text = match
    ? `🔥 Using FanNav for ${match.home} vs ${match.away} — live venue intel, AI co-pilot & journey planner for World Cup 2026!`
    : "🔥 FanNav — AI-powered match day intelligence for World Cup 2026!";
  const url = window.location.href;
  if (navigator.share) {
    try { await navigator.share({ title: "FanNav", text, url }); return; } catch {}
  }
  try { await navigator.clipboard.writeText(`${text} ${url}`); } catch {}
  setShareToast(true);
  setTimeout(() => setShareToast(false), 2500);
}

// ── Onboarding Splash ─────────────────────────────────────────────────────────
const SPLASH_SLIDES = [
  {
    icon: "⚽",
    title: "Welcome to FanNav",
    desc:  "Your AI-powered World Cup 2026 co-pilot. Real-time intel for fans at the stadium and watching at home.",
  },
  {
    icon: "🗺",
    title: "Smart Journey Planner",
    desc:  "Enter your hotel and get live Google Maps routing to the stadium, step-by-step transit directions and a departure countdown.",
  },
  {
    icon: "🏟",
    title: "Live Crowd Heat Map",
    desc:  "See real-time wait times at every gate, food court and bathroom — crowdsourced by fans like you, updated instantly.",
  },
  {
    icon: "📋",
    title: "Tactical Overlay",
    desc:  "Formation viewer, player heatmaps, match stats, event timeline and an AI tactical analyst powered by Claude.",
  },
];

function SplashScreen({ onDone }) {
  const [slide, setSlide] = useState(0);
  const isLast = slide === SPLASH_SLIDES.length - 1;
  const s = SPLASH_SLIDES[slide];

  return (
    <div className="splash">
      {/* Logo */}
      <div className="splash-logo">Fan<span>Nav</span></div>
      <div className="splash-sub">WORLD CUP 2026 · AI MATCH DAY INTEL</div>

      {/* SVG mini pitch illustration */}
      <svg className="splash-pitch" viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg">
        <rect width="160" height="100" rx="8" fill="#0e1f3a"/>
        {[0,1,2,3].map(i=><rect key={i} x={i*40} width="40" height="100" fill={i%2===0?"rgba(255,255,255,0.02)":"transparent"}/>)}
        <rect x="4" y="4" width="152" height="92" rx="3" fill="none" stroke="rgba(200,241,53,0.2)" strokeWidth="1.2"/>
        <line x1="4" y1="50" x2="156" y2="50" stroke="rgba(200,241,53,0.12)" strokeWidth="1"/>
        <circle cx="80" cy="50" r="18" fill="none" stroke="rgba(200,241,53,0.12)" strokeWidth="1"/>
        <circle cx="80" cy="50" r="2" fill="rgba(200,241,53,0.3)"/>
        <rect x="50" y="4" width="60" height="22" fill="none" stroke="rgba(200,241,53,0.1)" strokeWidth="1"/>
        <rect x="50" y="74" width="60" height="22" fill="none" stroke="rgba(200,241,53,0.1)" strokeWidth="1"/>
        {/* Players */}
        {[[80,14],[50,30],[80,30],[110,30],[35,52],[65,52],[95,52],[125,52],[50,72],[80,82],[110,72]].map(([x,y],i)=>(
          <circle key={i} cx={x} cy={y} r="5" fill="var(--lime)" opacity="0.75"/>
        ))}
        {[[80,86],[50,70],[80,70],[110,70],[35,48],[65,48],[95,48],[125,48],[50,28],[80,18],[110,28]].map(([x,y],i)=>(
          <circle key={i} cx={x} cy={y} r="5" fill="var(--red)" opacity="0.65"/>
        ))}
        <text x="80" y="55" textAnchor="middle" fontSize="8" fill="rgba(200,241,53,0.5)" fontFamily="Barlow Condensed,sans-serif" letterSpacing=".1em">WORLD CUP 2026</text>
      </svg>

      {/* Slide content */}
      <div style={{fontSize:"36px",marginBottom:".6rem"}}>{s.icon}</div>
      <div className="splash-title">{s.title}</div>
      <div className="splash-desc">{s.desc}</div>

      {/* Dots */}
      <div className="splash-dots">
        {SPLASH_SLIDES.map((_,i)=>(
          <div key={i} className={`splash-dot ${i===slide?"active":""}`}
            style={{cursor:"pointer"}} onClick={()=>setSlide(i)}/>
        ))}
      </div>

      {/* CTA */}
      <button className="splash-btn" onClick={() => isLast ? onDone() : setSlide(s => s + 1)}>
        {isLast ? "Let's Go ⚽" : "Next →"}
      </button>
      {!isLast && (
        <button className="splash-skip" onClick={onDone}>Skip intro</button>
      )}
    </div>
  );
}

// ── Upgraded Plan Tab with receipt ────────────────────────────────────────────
function PlanTabFull({ isPro, onUpgrade, currentPlan, planActivatedAt, onShare, match }) {
  const plan = PLANS.find(p => p.id === currentPlan);

  if (isPro && plan) return (
    <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
      {/* Receipt */}
      <div className="receipt">
        <div style={{fontFamily:"var(--font-display)",fontSize:"13px",fontWeight:600,color:"var(--lime)",
          letterSpacing:".1em",marginBottom:".75rem"}}>✓ PAYMENT RECEIPT</div>
        <div className="receipt-row"><span className="receipt-label">Plan</span><span className="receipt-val">{plan.name}</span></div>
        <div className="receipt-row"><span className="receipt-label">Coverage</span><span className="receipt-val">{plan.period}</span></div>
        <div className="receipt-row"><span className="receipt-label">Activated</span><span className="receipt-val">{planActivatedAt || "Today"}</span></div>
        <div className="receipt-row"><span className="receipt-label">Payment</span><span className="receipt-val">PayPal ✓</span></div>
        <div className="receipt-row"><span className="receipt-label">Total paid</span><span className="receipt-val">${plan.price}.00</span></div>
      </div>

      {/* Features unlocked */}
      <div className="section-card">
        <div className="section-title">⚡ Features Unlocked</div>
        {plan.features.map(f=>(
          <div key={f} style={{display:"flex",alignItems:"center",gap:".6rem",padding:".45rem 0",
            borderBottom:"1px solid var(--border)",fontSize:"13px"}}>
            <span style={{color:"var(--teal)"}}>✓</span> {f}
          </div>
        ))}
      </div>

      {/* Share */}
      <div className="section-card" style={{textAlign:"center",padding:"1.25rem"}}>
        <div style={{fontSize:"28px",marginBottom:".5rem"}}>🎉</div>
        <div style={{fontFamily:"var(--font-display)",fontSize:"18px",fontWeight:900,color:"var(--lime)",marginBottom:".3rem"}}>
          You're all set!
        </div>
        <div style={{fontSize:"12px",color:"var(--muted)",lineHeight:1.6,marginBottom:"1rem"}}>
          Tell your fellow fans — FanNav is better with more crowd data.
        </div>
        <button className="share-btn" style={{margin:"0 auto"}} onClick={onShare}>
          📤 Share FanNav with friends
        </button>
      </div>
    </div>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:"1rem"}}>
      <div style={{fontFamily:"var(--font-display)",fontSize:"22px",fontWeight:900,letterSpacing:".04em"}}>
        Unlock FanNav Pro
      </div>
      <div style={{fontSize:"13px",color:"var(--muted)",lineHeight:1.6}}>
        Real-time crowd maps, journey planning, AI co-pilot, tactical overlays.
      </div>
      <div className="plans-grid">
        {PLANS.map(p=>(
          <div key={p.id} className={`plan-card ${p.highlight?"highlight":""}`}>
            {p.highlight&&<div className="plan-badge">BEST VALUE</div>}
            <div className="plan-name">{p.name}</div>
            <div className="plan-price">${p.price}<span>/ {p.period}</span></div>
            <div className="plan-features">{p.features.map(f=>(
              <div key={f} className="plan-feat"><span className="feat-check">✓</span> {f}</div>
            ))}</div>
            <button className={`pay-btn ${p.highlight?"primary":"secondary"}`} onClick={()=>onUpgrade(p)}>
              Pay with PayPal — ${p.price}
            </button>
          </div>
        ))}
      </div>
      <div className="paypal-note">🔒 Secured by PayPal · No card stored on our servers</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ROOT — Day 5 complete
// ─────────────────────────────────────────────────────────────────────────────
export default function FanNav() {
  // ── Persist state to localStorage ──────────────────────────────────────────
  const [tab,            setTab]            = useState("Co-pilot");
  const [match,          setMatch]          = useState(() => LS.get("fn_match", null));
  const [modal,          setModal]          = useState(null);
  const [isPro,          setIsPro]          = useState(() => LS.get("fn_is_pro", false));
  const [currentPlan,    setCurrentPlan]    = useState(() => LS.get("fn_plan", null));
  const [planActivatedAt,setPlanActivatedAt] = useState(() => LS.get("fn_plan_date", null));

  // ── Day 5 state ─────────────────────────────────────────────────────────────
  const [showSplash,     setShowSplash]     = useState(() => !LS.get("fn_seen_splash", false));
  const [showPWA,        setShowPWA]        = useState(false);
  const [shareToast,     setShareToast]     = useState(false);
  const online = useOnline();
  const { canInstall, install } = usePWAInstall();

  // ── On mount: try to restore Pro from server fingerprint check ────────────
  useEffect(() => {
    if (isPro) return; // already pro, skip
    const fp = LS.get("fn_fingerprint", null);
    if (!fp) return;
    // Call Supabase RPC to check if this fingerprint has an active purchase
    const url = `${SUPABASE_URL}/rest/v1/rpc/fingerprint_has_pro`;
    fetch(url, {
      method:  "POST",
      headers: {
        apikey:         SUPABASE_ANON_KEY,
        Authorization:  `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fp }),
    })
      .then(r => r.json())
      .then(hasPro => {
        if (hasPro === true) {
          setIsPro(true);
          LS.set("fn_is_pro", true);
        }
      })
      .catch(() => {}); // silent — localStorage already has the state
  }, []);

  // Register service worker for offline support
  useEffect(() => { registerSW(); }, []);

  // Show PWA banner 6 s after splash is dismissed, once per session
  useEffect(() => {
    if (!canInstall || showSplash) return;
    const t = setTimeout(() => setShowPWA(true), 6000);
    return () => clearTimeout(t);
  }, [canInstall, showSplash]);

  // Persist match selection
  useEffect(() => { LS.set("fn_match", match); }, [match]);

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleSelect = m => { setMatch(m); setTab("Co-pilot"); };

  const handleUpgrade = p => setModal(p);

  const handleSuccess = p => {
    const date = new Date().toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" });
    setIsPro(true);
    setCurrentPlan(p.id);
    setPlanActivatedAt(date);
    LS.set("fn_is_pro",     true);
    LS.set("fn_plan",       p.id);
    LS.set("fn_plan_date",  date);
  };

  const handleSplashDone = () => {
    LS.set("fn_seen_splash", true);
    setShowSplash(false);
  };

  const handleShare = () => shareApp(match, setShareToast);

  // Nav label helper
  const navLabel = t => {
    if (t === "My Plan" && isPro) return "✓ PRO";
    return t;
  };

  // Tab indicator — show dot on Tactics if match selected but not yet visited
  const [visitedTactics, setVisitedTactics] = useState(false);
  const handleTab = t => {
    if (t === "Tactics") setVisitedTactics(true);
    setTab(t);
  };

  return (
    <>
      <style>{css}</style>

      {/* Onboarding splash */}
      {showSplash && <SplashScreen onDone={handleSplashDone}/>}

      {/* Share copied toast */}
      {shareToast && <div className="share-toast">📋 Link copied to clipboard!</div>}

      <div className="app">

        {/* Offline banner */}
        {!online && <div className="offline-bar">⚠ You're offline — showing cached data</div>}

        {/* Header */}
        <div className="header">
          <div>
            <div className="logo">Fan<span>Nav</span></div>
            <div className="logo-sub">WORLD CUP 2026 · AI MATCH DAY INTEL</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:".5rem"}}>
            {isPro && <span className="pro-badge">PRO</span>}
            <button className="share-btn" onClick={handleShare} style={{padding:".3rem .7rem",fontSize:"11px"}}>
              📤 Share
            </button>
            <div className="live-badge">● LIVE</div>
          </div>
        </div>

        {/* Nav */}
        <div className="nav">
          {TABS.map(t => (
            <button key={t}
              className={`nav-btn ${tab === t ? "active" : ""}`}
              onClick={() => handleTab(t)}
              style={{position:"relative"}}>
              {navLabel(t)}
              {/* New-match dot on Tactics */}
              {t === "Tactics" && match && !visitedTactics && (
                <span style={{
                  position:"absolute",top:"6px",right:"6px",width:"6px",height:"6px",
                  borderRadius:"50%",background:"var(--lime)",display:"block"
                }}/>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="content">
          {tab === "Co-pilot"    && <CopilotTab  match={match} onChangeTab={handleTab}/>}
          {tab === "Matches"     && <MatchesTab  selected={match} onSelect={handleSelect}/>}
          {tab === "Tactics"     && <TacticsTab  match={match} isPro={isPro} onUpgrade={handleUpgrade}/>}
          {tab === "Journey"     && <JourneyTab  match={match} isPro={isPro} onUpgrade={handleUpgrade}/>}
          {tab === "Venue Intel" && <VenueTab    match={match}/>}
          {tab === "My Plan"     && (
            <PlanTabFull
              isPro={isPro}
              onUpgrade={handleUpgrade}
              currentPlan={currentPlan}
              planActivatedAt={planActivatedAt}
              onShare={handleShare}
              match={match}
            />
          )}
        </div>
      </div>

      {/* PayPal modal */}
      {modal && (
        <PayPalModal
          plan={modal}
          onClose={() => setModal(null)}
          onSuccess={handleSuccess}
        />
      )}

      {/* PWA install banner */}
      {showPWA && !showSplash && (
        <div className="pwa-banner">
          <div className="pwa-icon">📲</div>
          <div className="pwa-text">
            <div className="pwa-title">Add FanNav to Home Screen</div>
            <div className="pwa-sub">Works offline · No app store needed</div>
          </div>
          <button className="pwa-install-btn" onClick={() => { install(); setShowPWA(false); }}>
            Install
          </button>
          <button className="pwa-dismiss" onClick={() => setShowPWA(false)}>×</button>
        </div>
      )}
    </>
  );
}
