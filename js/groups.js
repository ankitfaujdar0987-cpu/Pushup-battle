// Groups: create or join with a code, plus a live leaderboard for each group.
import { db } from "./auth.js";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  onSnapshot,
  writeBatch,
  runTransaction,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const $ = (id) => document.getElementById(id);

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RULE = /^[A-Z0-9]{6}$/;

let me = null; // { user, profile } from account.js
let wired = false;
let linkHandled = false;
let listUnsub = null;
let boardUnsub = null;
let current = null; // the open group: { id, name }

function makeCode() {
  let code = "";
  for (let i = 0; i < 6; i++) code += CHARS[Math.floor(Math.random() * CHARS.length)];
  return code;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function setMsg(text) {
  $("groupsMsg").textContent = text;
}

const memberRef = (gid, uid) => doc(db, "groups", gid, "members", uid);
const myGroupRef = (gid) => doc(db, "userGroups", me.user.uid, "groups", gid);

function newMember() {
  return {
    username: me.profile.username,
    photoURL: me.profile.photoURL || null,
    joinedAt: serverTimestamp(),
    played: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    pushups: 0,
    streak: 0,
    bestStreak: 0,
    beat: [],
  };
}

/* ---------- Create, join, leave ---------- */

async function createGroup() {
  const name = $("groupNameInput").value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 30) {
    setMsg("A group name needs 2-30 characters");
    return;
  }
  setMsg("Creating...");
  const uid = me.user.uid;
  let lastErr = null;

  for (let i = 0; i < 4; i++) {
    const gid = makeCode(); // if the code is taken, we try another one
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, "groups", gid), { name, ownerUid: uid, createdAt: serverTimestamp() });
      batch.set(memberRef(gid, uid), newMember());
      batch.set(myGroupRef(gid), { name, joinedAt: serverTimestamp() });
      await batch.commit();
      $("groupNameInput").value = "";
      setMsg("");
      openBoard(gid, name);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  console.error(lastErr);
  setMsg("Could not create the group: " + (lastErr.code || lastErr.message));
}

async function joinGroup() {
  const code = $("groupCodeInput").value.trim().toUpperCase();
  if (!CODE_RULE.test(code)) {
    setMsg("A group code has 6 letters or numbers");
    return;
  }
  setMsg("");

  try {
    const gSnap = await getDoc(doc(db, "groups", code));
    if (!gSnap.exists()) {
      setMsg("No group with that code");
      return;
    }
    const name = gSnap.data().name;
    const uid = me.user.uid;

    if ((await getDoc(memberRef(code, uid))).exists()) {
      openBoard(code, name);
      return;
    }

    const batch = writeBatch(db);
    batch.set(memberRef(code, uid), newMember());
    batch.set(myGroupRef(code), { name, joinedAt: serverTimestamp() });
    await batch.commit();

    $("groupCodeInput").value = "";
    openBoard(code, name);
  } catch (err) {
    console.error(err);
    setMsg("Could not join: " + (err.code || err.message));
  }
}

async function leaveGroup(id, name) {
  if (!confirm('Leave "' + name + '"? Your results in this group will be removed.')) return;
  try {
    const batch = writeBatch(db);
    batch.delete(memberRef(id, me.user.uid));
    batch.delete(myGroupRef(id));
    await batch.commit();
    if (current && current.id === id) closeBoard();
  } catch (err) {
    console.error(err);
    setMsg("Could not leave: " + (err.code || err.message));
  }
}

async function copyInvite() {
  if (!current) return;
  const link = location.origin + location.pathname + "?group=" + current.id;
  const text =
    'Join my group "' + current.name + '" on Pushup Battle! Code: ' + current.id + "\n" + link;
  try {
    await navigator.clipboard.writeText(text);
    setMsg("Invite copied. Paste it in WhatsApp!");
  } catch (err) {
    setMsg("Share this code with your friends: " + current.id);
  }
}

/* ---------- Showing groups and the leaderboard ---------- */

function renderGroups(snap) {
  const list = $("groupsList");
  list.replaceChildren();
  if (snap.empty) {
    list.appendChild(el("li", "f-empty", "No groups yet. Create one or join with a code."));
    return;
  }

  const items = [];
  snap.forEach((d) => items.push({ id: d.id, name: d.data().name }));
  items.sort((a, b) => a.name.localeCompare(b.name));

  items.forEach((g) => {
    const li = el("li", "f-row");

    const info = el("span", "f-name", g.name);
    info.appendChild(el("div", "lb-sub", "Code: " + g.id));

    const actions = el("span", "f-actions");
    const open = el("button", "", "Open");
    open.addEventListener("click", () => openBoard(g.id, g.name));
    const leave = el("button", "ghost", "Leave");
    leave.addEventListener("click", () => leaveGroup(g.id, g.name));
    actions.append(open, leave);

    li.append(info, actions);
    list.appendChild(li);
  });
}

function renderBoard(snap) {
  const list = $("leaderboardList");
  list.replaceChildren();

  const rows = [];
  snap.forEach((d) => rows.push({ uid: d.id, ...d.data() }));
  rows.sort(
    (a, b) =>
      b.wins - a.wins ||
      a.losses - b.losses ||
      b.pushups - a.pushups ||
      a.username.localeCompare(b.username)
  );

  rows.forEach((r, i) => {
    const isTop = i === 0 && r.played > 0;
    const li = el("li", "lb-row" + (r.uid === me.user.uid ? " me" : "") + (isTop ? " top" : ""));

    li.appendChild(el("span", "lb-rank", "#" + (i + 1)));

    const img = el("img");
    if (r.photoURL && r.photoURL.startsWith("https://")) {
      img.src = r.photoURL;
      img.referrerPolicy = "no-referrer";
      img.alt = "";
    } else {
      img.hidden = true;
    }
    li.appendChild(img);

    const main = el("div", "lb-main");
    main.appendChild(el("div", "lb-name", "@" + r.username));
    main.appendChild(
      el(
        "div",
        "lb-sub",
        r.wins + "W " + r.losses + "L " + r.draws + "D  |  streak " + r.streak + "  |  " + r.pushups + " pushups"
      )
    );

    // Badges
    const badges = el("div", "lb-badges");
    const others = rows.filter((o) => o.uid !== r.uid);
    const beat = r.beat || [];
    if (isTop) badges.appendChild(el("span", "lb-badge", "Top of the group"));
    if (others.length > 0 && others.every((o) => beat.includes(o.uid))) {
      badges.appendChild(el("span", "lb-badge", "Beat everyone"));
    }
    if (r.played > 0 && r.losses === 0) badges.appendChild(el("span", "lb-badge green", "Undefeated"));
    if (badges.childNodes.length) main.appendChild(badges);
    li.appendChild(main);

    const wins = el("div", "lb-wins", String(r.wins));
    wins.appendChild(el("small", "", "WINS"));
    li.appendChild(wins);

    list.appendChild(li);
  });
}

function openBoard(id, name) {
  closeBoard();
  current = { id, name };
  $("groupsPanel").hidden = false;
  $("groupsHome").hidden = true;
  $("groupView").hidden = false;
  $("groupsBack").hidden = false;
  $("groupsTitle").textContent = name;
  $("groupCode").textContent = id;

  boardUnsub = onSnapshot(collection(db, "groups", id, "members"), renderBoard, (err) => {
    console.error(err);
    setMsg("Could not load the leaderboard: " + (err.code || err.message));
  });
}

function closeBoard() {
  if (boardUnsub) boardUnsub();
  boardUnsub = null;
  current = null;
  $("groupsHome").hidden = false;
  $("groupView").hidden = true;
  $("groupsBack").hidden = true;
  $("groupsTitle").textContent = "Groups";
}

/* ---------- After a match: update my row in each shared group ---------- */

export async function recordGroupMatch(account, m) {
  const uid = account.user.uid;
  const result = m.mine > m.theirs ? "win" : m.mine < m.theirs ? "lose" : "draw";
  const mine = await getDocs(collection(db, "userGroups", uid, "groups"));

  for (const g of mine.docs) {
    try {
      // Only count the match if the opponent is in this group too.
      const opp = await getDoc(doc(db, "groups", g.id, "members", m.opponentUid));
      if (!opp.exists()) continue;

      const ref = doc(db, "groups", g.id, "members", uid);
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        const s = snap.data();

        const streak =
          result === "win" ? s.streak + 1 : result === "lose" ? 0 : s.streak; // a draw keeps it
        const beat =
          result === "win" && !s.beat.includes(m.opponentUid)
            ? [...s.beat, m.opponentUid]
            : s.beat;

        tx.update(ref, {
          played: s.played + 1,
          wins: s.wins + (result === "win" ? 1 : 0),
          losses: s.losses + (result === "lose" ? 1 : 0),
          draws: s.draws + (result === "draw" ? 1 : 0),
          pushups: s.pushups + m.mine,
          streak,
          bestStreak: Math.max(s.bestStreak, streak),
          beat,
        });
      });
    } catch (err) {
      console.error("Group update failed:", g.id, err);
    }
  }
}

/* ---------- Start and stop ---------- */

export function startGroups(account) {
  stopGroups();
  me = account;

  if (!wired) {
    wired = true;
    $("groupsBtn").addEventListener("click", () => {
      $("groupsPanel").hidden = !$("groupsPanel").hidden;
    });
    $("groupsClose").addEventListener("click", () => {
      $("groupsPanel").hidden = true;
    });
    $("groupsBack").addEventListener("click", closeBoard);
    $("groupCreateBtn").addEventListener("click", createGroup);
    $("groupJoinBtn").addEventListener("click", joinGroup);
    $("groupCopyBtn").addEventListener("click", copyInvite);
  }

  $("groupsBtn").hidden = false;
  listUnsub = onSnapshot(
    collection(db, "userGroups", me.user.uid, "groups"),
    renderGroups,
    (err) => console.error("Groups:", err)
  );

  // An invite link like  ...?group=ABC123  opens the panel with the code filled in.
  if (!linkHandled) {
    linkHandled = true;
    const code = (new URLSearchParams(location.search).get("group") || "").toUpperCase();
    if (CODE_RULE.test(code)) {
      $("groupCodeInput").value = code;
      $("groupsPanel").hidden = false;
      setMsg("Press Join to enter this group");
    }
  }
}

export function stopGroups() {
  if (listUnsub) listUnsub();
  listUnsub = null;
  closeBoard();
  me = null;
  $("groupsBtn").hidden = true;
  $("groupsPanel").hidden = true;
}