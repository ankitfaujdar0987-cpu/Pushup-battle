// Saves finished matches, and shows your stats, streaks and match history.
import { db } from "./auth.js";
import {
  doc,
  collection,
  query,
  orderBy,
  limit,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

let me = null; // { user, profile } from account.js
let wired = false;

const EMPTY = { played: 0, wins: 0, losses: 0, draws: 0, pushups: 0, streak: 0, bestStreak: 0 };

/* ---------- Saving a match ---------- */

export async function saveMatch(account, m) {
  const uid = account.user.uid;
  const result = m.mine > m.theirs ? "win" : m.mine < m.theirs ? "lose" : "draw";
  const statsRef = doc(db, "stats", uid);
  const matchRef = doc(collection(db, "matchHistory", uid, "matches"));

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(statsRef);
    const s = snap.exists() ? snap.data() : EMPTY;

    const streak =
      result === "win" ? s.streak + 1 : result === "lose" ? 0 : s.streak; // a draw keeps the streak

    tx.set(statsRef, {
      played: s.played + 1,
      wins: s.wins + (result === "win" ? 1 : 0),
      losses: s.losses + (result === "lose" ? 1 : 0),
      draws: s.draws + (result === "draw" ? 1 : 0),
      pushups: s.pushups + m.mine,
      streak,
      bestStreak: Math.max(s.bestStreak, streak),
    });

    tx.set(matchRef, {
      opponentUid: m.opponentUid,
      opponentName: m.opponentName,
      mine: m.mine,
      theirs: m.theirs,
      result,
      seconds: m.seconds,
      at: serverTimestamp(),
    });
  });
}

/* ---------- The stats panel ---------- */

function tile(label, value) {
  const box = document.createElement("div");
  box.className = "s-tile";
  const v = document.createElement("div");
  v.className = "s-value";
  v.textContent = value;
  const l = document.createElement("div");
  l.className = "s-label";
  l.textContent = label;
  box.append(v, l);
  return box;
}

function historyRow(m) {
  const li = document.createElement("li");
  li.className = "h-row";

  const badge = document.createElement("span");
  const result = ["win", "lose", "draw"].includes(m.result) ? m.result : "draw";
  badge.className = "h-badge " + result;
  badge.textContent = result === "lose" ? "LOSS" : result.toUpperCase();

  const name = document.createElement("span");
  name.className = "h-name";
  name.textContent = "vs @" + m.opponentName;

  const score = document.createElement("span");
  score.className = "h-score";
  score.textContent = m.mine + " - " + m.theirs;

  const date = document.createElement("span");
  date.className = "h-date";
  date.textContent = m.at && m.at.toDate ? m.at.toDate().toLocaleDateString() : "";

  li.append(badge, name, score, date);
  return li;
}

async function openPanel() {
  $("statsPanel").hidden = false;
  const grid = $("statsGrid");
  const list = $("historyList");
  const msg = $("statsMsg");
  grid.replaceChildren();
  list.replaceChildren();
  msg.textContent = "Loading...";

  try {
    const uid = me.user.uid;
    const [statsSnap, histSnap] = await Promise.all([
      getDoc(doc(db, "stats", uid)),
      getDocs(
        query(collection(db, "matchHistory", uid, "matches"), orderBy("at", "desc"), limit(20))
      ),
    ]);

    const s = statsSnap.exists() ? statsSnap.data() : EMPTY;
    const rate = s.played ? Math.round((s.wins / s.played) * 100) + "%" : "-";
    grid.append(
      tile("Played", s.played),
      tile("Wins", s.wins),
      tile("Win rate", rate),
      tile("Win streak", s.streak),
      tile("Best streak", s.bestStreak),
      tile("Total pushups", s.pushups)
    );

    if (histSnap.empty) {
      const li = document.createElement("li");
      li.className = "f-empty";
      li.textContent = "No matches yet. Challenge a friend!";
      list.appendChild(li);
    } else {
      histSnap.forEach((d) => list.appendChild(historyRow(d.data())));
    }
    msg.textContent = "";
  } catch (err) {
    console.error(err);
    msg.textContent = "Could not load stats: " + (err.code || err.message);
  }
}

export function startStats(account) {
  me = account;
  if (!wired) {
    wired = true;
    $("statsBtn").addEventListener("click", openPanel);
    $("statsClose").addEventListener("click", () => {
      $("statsPanel").hidden = true;
    });
  }
  $("statsBtn").hidden = false;
}

export function stopStats() {
  me = null;
  $("statsBtn").hidden = true;
  $("statsPanel").hidden = true;
}