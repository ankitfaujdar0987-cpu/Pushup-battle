// Friends: add by username, accept or decline requests, see your friends.
import { db } from "./auth.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  onSnapshot,
  writeBatch,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { sounds } from "./sound.js";

const $ = (id) => document.getElementById(id);
// main.js fills these in so friends can start and join rooms.
export const bridge = {
  busy: () => false,
  host: async () => null,
  join: () => {},
};

const INVITE_MAX_AGE_MS = 3 * 60 * 1000;
let currentInvite = null;

let me = null; // { user, profile } from account.js
let unsubs = [];
let wired = false;

function setMsg(text) {
  $("friendsMsg").textContent = text;
}

// One row: photo + @username + buttons.
function makeRow(username, photoURL, buttons) {
  const li = document.createElement("li");
  li.className = "f-row";

  const img = document.createElement("img");
  if (photoURL && photoURL.startsWith("https://")) {
    img.src = photoURL;
    img.referrerPolicy = "no-referrer";
    img.alt = "";
  } else {
    img.hidden = true;
  }

  const name = document.createElement("span");
  name.className = "f-name";
  name.textContent = "@" + username;

  const actions = document.createElement("span");
  actions.className = "f-actions";
  buttons.forEach(([label, cls, onClick]) => {
    const b = document.createElement("button");
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener("click", onClick);
    actions.appendChild(b);
  });

  li.append(img, name, actions);
  return li;
}

function emptyRow(text) {
  const li = document.createElement("li");
  li.className = "f-empty";
  li.textContent = text;
  return li;
}

/* ---------- Actions ---------- */

async function sendRequest() {
  const input = $("friendInput");
  const wanted = input.value.trim().toLowerCase().replace(/^@/, "");
  setMsg("");

  if (!/^[a-z0-9_]{3,16}$/.test(wanted)) {
    setMsg("Enter a valid username (3-16 letters, numbers or _)");
    return;
  }
  if (wanted === me.profile.username) {
    setMsg("That's your own username");
    return;
  }

  try {
    const nameSnap = await getDoc(doc(db, "usernames", wanted));
    if (!nameSnap.exists()) {
      setMsg("No player has that username");
      return;
    }
    const toUid = nameSnap.data().uid;
    const myUid = me.user.uid;

    if ((await getDoc(doc(db, "users", myUid, "friends", toUid))).exists()) {
      setMsg("You are already friends with @" + wanted);
      return;
    }
    if ((await getDoc(doc(db, "users", myUid, "requests", toUid))).exists()) {
      setMsg("@" + wanted + " already sent you a request. Accept it below.");
      return;
    }

    await setDoc(doc(db, "users", toUid, "requests", myUid), {
      username: me.profile.username,
      photoURL: me.profile.photoURL || null,
      createdAt: serverTimestamp(),
    });
    input.value = "";
    setMsg("Request sent to @" + wanted);
  } catch (err) {
    console.error(err);
    setMsg("Could not send the request: " + (err.code || err.message));
  }
}

async function acceptRequest(fromUid, req) {
  try {
    const myUid = me.user.uid;
    const batch = writeBatch(db);
    batch.set(doc(db, "users", myUid, "friends", fromUid), {
      username: req.username,
      photoURL: req.photoURL || null,
      since: serverTimestamp(),
    });
    batch.set(doc(db, "users", fromUid, "friends", myUid), {
      username: me.profile.username,
      photoURL: me.profile.photoURL || null,
      since: serverTimestamp(),
    });
    batch.delete(doc(db, "users", myUid, "requests", fromUid));
    await batch.commit();
    setMsg("You and @" + req.username + " are friends now");
  } catch (err) {
    console.error(err);
    setMsg("Could not accept: " + (err.code || err.message));
  }
}

async function declineRequest(fromUid) {
  try {
    await deleteDoc(doc(db, "users", me.user.uid, "requests", fromUid));
  } catch (err) {
    console.error(err);
    setMsg("Could not decline: " + (err.code || err.message));
  }
}

async function removeFriend(friendUid, username) {
  if (!confirm("Remove @" + username + " from your friends?")) return;
  try {
    const myUid = me.user.uid;
    const batch = writeBatch(db);
    batch.delete(doc(db, "users", myUid, "friends", friendUid));
    batch.delete(doc(db, "users", friendUid, "friends", myUid));
    await batch.commit();
  } catch (err) {
    console.error(err);
    setMsg("Could not remove: " + (err.code || err.message));
  }
}

/* ---------- Showing the lists ---------- */

function renderRequests(snap) {
  const list = $("requestsList");
  list.replaceChildren();
  if (snap.empty) list.appendChild(emptyRow("No requests"));

  snap.forEach((d) => {
    const req = d.data();
    list.appendChild(
      makeRow(req.username, req.photoURL, [
        ["Accept", "", () => acceptRequest(d.id, req)],
        ["Decline", "ghost", () => declineRequest(d.id)],
      ])
    );
  });

  const badge = $("friendsBadge");
  badge.textContent = snap.size;
  badge.hidden = snap.size === 0;
    const dot = $("menuDot");
  if (dot) dot.hidden = snap.size === 0;
}

function renderFriends(snap) {
  const list = $("friendsList");
  list.replaceChildren();
  if (snap.empty) {
    list.appendChild(emptyRow("No friends yet. Add someone by username."));
    return;
  }

  const items = [];
  snap.forEach((d) => items.push({ id: d.id, ...d.data() }));
  items.sort((a, b) => a.username.localeCompare(b.username));

  items.forEach((f) => {
    list.appendChild(
      makeRow(f.username, f.photoURL, [
        ["Challenge", "", () => challenge(f.id, f.username)],
        ["Remove", "ghost", () => removeFriend(f.id, f.username)],
      ])
    );
  });
}
/* ---------- Challenges ---------- */

async function challenge(friendUid, username) {
  if (bridge.busy()) {
    setMsg("Finish your current match or room first");
    return;
  }
  setMsg("Creating your room...");
  const code = await bridge.host();
  if (!code) {
    setMsg("Could not create a room. Try again.");
    return;
  }
  try {
    await setDoc(doc(db, "users", friendUid, "invites", me.user.uid), {
      username: me.profile.username,
      photoURL: me.profile.photoURL || null,
      code,
      createdAt: serverTimestamp(),
    });
    setMsg("Challenge sent to @" + username + ". Close this and wait for them to join.");
  } catch (err) {
    console.error(err);
    setMsg("Could not send the challenge: " + (err.code || err.message));
  }
}

function showInvite(item) {
  $("inviteText").textContent = "@" + item.inv.username + " challenged you!";
  $("inviteNote").textContent = "";
  $("inviteToast").hidden = false;
  sounds.connect();
}

function hideInvite() {
  currentInvite = null;
  $("inviteToast").hidden = true;
}

function renderInvites(snap) {
  let best = null;
  snap.forEach((d) => {
    const inv = d.data();
    const ts = inv.createdAt && inv.createdAt.toMillis ? inv.createdAt.toMillis() : Date.now();
    if (Date.now() - ts > INVITE_MAX_AGE_MS) {
      deleteDoc(d.ref).catch(() => {}); // too old: clean it up
      return;
    }
    if (!best || ts > best.ts) best = { fromUid: d.id, inv, ts };
  });

  if (!best) {
    hideInvite();
    return;
  }
  if (currentInvite && currentInvite.fromUid === best.fromUid && currentInvite.ts === best.ts) {
    return; // already showing this one
  }
  currentInvite = best;
  showInvite(best);
}

async function acceptInvite() {
  if (!currentInvite) return;
  if (bridge.busy()) {
    $("inviteNote").textContent = "Finish your current match or room first";
    return;
  }
  const { fromUid, inv } = currentInvite;
  hideInvite();
  try {
    await deleteDoc(doc(db, "users", me.user.uid, "invites", fromUid));
  } catch (err) {
    console.error(err);
  }
  if (/^[A-Z0-9]{5}$/.test(inv.code)) bridge.join(inv.code);
}

async function declineInvite() {
  if (!currentInvite) return;
  const { fromUid } = currentInvite;
  hideInvite();
  try {
    await deleteDoc(doc(db, "users", me.user.uid, "invites", fromUid));
  } catch (err) {
    console.error(err);
  }
}

/* ---------- Start and stop ---------- */

function wireOnce() {
  if (wired) return;
  wired = true;
  $("friendsBtn").addEventListener("click", () => {
    $("friendsPanel").hidden = !$("friendsPanel").hidden;
  });
  $("friendsClose").addEventListener("click", () => {
    $("friendsPanel").hidden = true;
  });
  $("friendAddBtn").addEventListener("click", sendRequest);
    $("inviteAccept").addEventListener("click", acceptInvite);
  $("inviteDecline").addEventListener("click", declineInvite);
  $("friendInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") sendRequest();
  });
}

export function startFriends(account) {
  stopFriends();
  me = account;
  wireOnce();
  $("friendsBtn").hidden = false;

  const myUid = me.user.uid;
  unsubs.push(
    onSnapshot(collection(db, "users", myUid, "requests"), renderRequests, (err) =>
      console.error("Requests:", err)
    )
  );
  unsubs.push(
    onSnapshot(collection(db, "users", myUid, "friends"), renderFriends, (err) =>
      console.error("Friends:", err)
    )
  );
    unsubs.push(
    onSnapshot(collection(db, "users", myUid, "invites"), renderInvites, (err) =>
      console.error("Invites:", err)
    )
  );
}

export function stopFriends() {
  unsubs.forEach((u) => u());
  unsubs = [];
  me = null;
  hideInvite();
  $("friendsBtn").hidden = true;
  $("friendsPanel").hidden = true;
}