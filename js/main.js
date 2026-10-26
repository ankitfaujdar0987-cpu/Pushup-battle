// Pushup Battle: connects everything together and runs the round.
import { startCamera } from "./camera.js";
import { loadPose, detectPose, drawPose } from "./pose.js";
import { PushupCounter } from "./counter.js";
import { TugBar } from "./bar.js";
import { RoundUI } from "./ui.js";
import { Network } from "./network.js";
import { sounds, isMuted, setMuted } from "./sound.js";

/* ---------------- Settings ---------------- */
let roundSeconds = 60;
const COUNTDOWN_SECONDS = 3;
const ALLOWED_SECONDS = [60, 180, 300, 600];

/* ---------------- Page elements ---------------- */
const $ = (id) => document.getElementById(id);

const video = $("video");
const canvas = $("overlay");
const statusEl = $("status");
const startBtn = $("startBtn");
const roundBtn = $("roundBtn");
const resetBtn = $("resetBtn");
const muteBtn = $("muteBtn");
const micBtn = $("micBtn");
const voiceBtn = $("voiceBtn");
const p1Pill = $("p1Pill");
const p2Pill = $("p2Pill");
const p2Waiting = $("p2Waiting");
const remoteVideo = $("remoteVideo");
const roomStatus = $("roomStatus");
const roomActions = $("roomActions");
const createBtn = $("createBtn");
const joinBtn = $("joinBtn");
const leaveBtn = $("leaveBtn");
const codeInput = $("codeInput");
const durationRow = document.querySelector(".duration-row");
const durButtons = document.querySelectorAll(".dur");
const debugEl = $("debug");

// Side menu
const drawer = $("drawer");
const drawerBackdrop = $("drawerBackdrop");
const drawerClose = $("drawerClose");
const drawerName = $("drawerName");
const navTrigger = $("accountTrigger");
const accountNameEl = $("accountName");
const signInBtn = $("signInBtn");

/* ---------------- Objects and state ---------------- */
const counter = new PushupCounter();
const bar = new TugBar();
const ui = new RoundUI();
const net = new Network();

let cameraRunning = false; // the pushup loop is running
let modelReady = false;    // pushup detection has loaded
let lastCount = 0;
let state = "idle";        // idle -> countdown -> playing -> finished
let timers = [];           // every timer we start, so we can cancel them all

let p1Ready = false;       // my camera is on
let p2Ready = false;       // the opponent's camera is on
let lastSentReady = null;  // last camera status we sent
let gotOpponentFinal = false;
let resultShown = false;
let opponentInfo = null;   // who we play: { uid, username }

let micOn = true;
let hearOpponent = true;

/* ---------------- Debug lines (add ?debug=1 to the address) ---------------- */
const debugOn = new URLSearchParams(location.search).has("debug");
const debugLines = [];

function dbg(text) {
  if (!debugOn || !debugEl) return;
  debugLines.push(text);
  debugEl.hidden = false;
  debugEl.textContent = debugLines.slice(-8).join("\n");
}
net.onDebug = dbg;

/* ---------------- Small helpers ---------------- */
function clearTimers() {
  timers.forEach((id) => {
    clearTimeout(id);
    clearInterval(id);
  });
  timers = [];
}

function roundIsActive() {
  return state === "countdown" || state === "playing";
}

function setState(newState) {
  state = newState;
  updateReadyUI();
}

function setOpponentLabel(name) {
  document.querySelector(".p2 .tag").textContent = name ? "@" + name : "OPPONENT";
}

/* ---------------- Sending things to the opponent ---------------- */

// Tells the opponent whether my camera is on (only when it changes).
function syncMyCamera(force = false) {
  if (!net.isConnected()) return;
  if (force || lastSentReady !== p1Ready) {
    net.send({ type: "camera", ready: p1Ready });
    lastSentReady = p1Ready;
    dbg("I sent camera: " + (p1Ready ? "ON" : "OFF"));
  }
}

// Sends my pushup total to the opponent.
function syncMyCount() {
  net.send({ type: "count", value: bar.p1 });
}

function sendToOpponent(message) {
  if (net.isConnected()) net.send({ type: "alert", text: message });
}

// Sends my live video to the opponent (needs my camera on and a connection).
function sendMyVideo() {
  try {
    if (net.isConnected() && video.srcObject) {
      net.sendVideo(video.srcObject);
    }
  } catch (err) {
    console.error("Video send failed:", err);
    dbg("video send failed: " + err.message);
  }
}

// Tells the opponent who I am (only if I'm signed in).
function sendHello() {
  import("./account.js")
    .then((acc) => {
      if (acc.me.user && acc.me.profile) {
        net.send({ type: "hello", uid: acc.me.user.uid, username: acc.me.profile.username });
      }
    })
    .catch(() => {});
}

/* ---------------- Camera status and voice ---------------- */

// Applies the mic / opponent-voice switches and updates the button labels.
function applyVoice() {
  const tracks = video.srcObject ? video.srcObject.getAudioTracks() : [];
  tracks.forEach((t) => (t.enabled = micOn));
  remoteVideo.muted = !hearOpponent;

  micBtn.textContent =
    p1Ready && tracks.length === 0 ? "Mic: unavailable" : "Mic: " + (micOn ? "ON" : "OFF");
  voiceBtn.textContent = "Opponent voice: " + (hearOpponent ? "ON" : "OFF");
}

function updateReadyUI() {
  p1Pill.textContent = "Your camera: " + (p1Ready ? "ON" : "OFF");
  p2Pill.textContent = "Opponent camera: " + (p2Ready ? "ON" : "OFF");
  p1Pill.classList.toggle("on", p1Ready);
  p2Pill.classList.toggle("on", p2Ready);

  const showRemote = net.isConnected() && !!remoteVideo.srcObject;
  remoteVideo.hidden = !showRemote;
  p2Waiting.hidden = showRemote;

  if (!net.isConnected()) p2Waiting.textContent = "Waiting for opponent...";
  else if (p2Ready) p2Waiting.textContent = "Opponent's camera is ON, loading video...";
  else p2Waiting.textContent = "Opponent's camera is OFF";

  // The button only locks while a round is running.
  roundBtn.disabled = roundIsActive();
  syncMyCamera();
  applyVoice();
}

function setOpponentReady(value) {
  p2Ready = value;
  if (!value) remoteVideo.srcObject = null;
  if (!value && roundIsActive()) abortRound("Opponent's camera turned off");
  updateReadyUI();
}

// Returns true if everything is ready to start. Otherwise shows the right popup.
function checkCamerasOrAlert() {
  if (!p1Ready) {
    ui.showAlert("Turn on your camera to start");
    return false;
  }
  if (!modelReady) {
    ui.showAlert("Pushup detection is still loading. Wait a moment.");
    return false;
  }
  if (!p2Ready) {
    if (net.isConnected()) {
      ui.showAlert("Opponent's camera is off. We asked them to turn it on.");
      sendToOpponent("Turn on your camera to start the round");
    } else {
      ui.showAlert("No opponent yet. Create or join a room first.");
    }
    return false;
  }
  return true;
}

/* ---------------- Camera ---------------- */

async function startCameraAndModel() {
  startBtn.disabled = true;
  statusEl.textContent = "Starting camera...";

  try {
    await startCamera(video);
  } catch (err) {
    statusEl.textContent = "Camera error: " + err.message;
    ui.showAlert("Could not start the camera: " + err.message);
    startBtn.disabled = false;
    return;
  }

  // If the camera gets turned off or unplugged, stop everything cleanly.
  const track = video.srcObject.getVideoTracks()[0];
  track.addEventListener("ended", () => {
    cameraRunning = false;
    modelReady = false;
    p1Ready = false;
    startBtn.disabled = false;
    startBtn.textContent = "Start Camera";
    startBtn.classList.remove("cam-on");
    statusEl.textContent = "Camera stopped";
    if (roundIsActive()) abortRound("Your camera turned off");
    updateReadyUI();
  });

  // The camera is on: tell the opponent and send my video right away.
  p1Ready = true;
  startBtn.disabled = false;
  startBtn.textContent = "Turn Off Camera";
  startBtn.classList.add("cam-on");
  dbg("camera is on");
  updateReadyUI();
  sendMyVideo();

  // Now load the pushup detection (this can take a while on a phone).
  statusEl.textContent = "Loading pushup detection...";
  try {
    await loadPose();
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Pushup detection failed: " + err.message;
    ui.showAlert("Pushup detection could not load: " + err.message);
    dbg("pose model failed: " + err.message);
    return;
  }

  if (!p1Ready) return; // the camera was turned off while loading

  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  cameraRunning = true;
  modelReady = true;
  dbg("pushup detection ready");
  statusEl.textContent = "Get in position";
  updateReadyUI();
  loop();
}

function stopCamera() {
  if (roundIsActive()) abortRound("Your camera turned off");

  cameraRunning = false;
  modelReady = false;
  p1Ready = false;

  if (video.srcObject) {
    video.srcObject.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  }
  if (net.outCall) {
    net.outCall.close();
    net.outCall = null;
  }

  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  counter.reset();
  lastCount = 0;

  startBtn.textContent = "Start Camera";
  startBtn.classList.remove("cam-on");
  statusEl.textContent = "Camera is off";
  updateReadyUI();
}

let lastVideoTime = -1;

function loop() {
  if (!cameraRunning) return;

  // Only analyse a picture when the camera has given us a new one.
  if (video.currentTime === lastVideoTime) {
    requestAnimationFrame(loop);
    return;
  }
  lastVideoTime = video.currentTime;

  const landmarks = detectPose(video, performance.now());
  drawPose(canvas, landmarks);

  if (landmarks) {
    const result = counter.update(landmarks);

    if (state === "playing") {
      // Every new real pushup moves the bar.
      if (result.count > lastCount) {
        bar.addP1(result.count - lastCount);
        lastCount = result.count;
        syncMyCount();
      }
    } else {
      // Pushups done outside a round don't count.
      lastCount = result.count;
    }

    statusEl.textContent =
      result.status +
      (result.angle !== null ? ` | elbow angle: ${Math.round(result.angle)}°` : "");
  } else {
    statusEl.textContent = "No body detected";
  }

  requestAnimationFrame(loop);
}

/* ---------------- Round ---------------- */

function startRound(fromOpponent = false) {
  if (roundIsActive()) return;
  if (!fromOpponent) {
    if (!checkCamerasOrAlert()) return;
    net.send({ type: "start", seconds: roundSeconds });
  }

  clearTimers();
  bar.reset();
  gotOpponentFinal = false;
  resultShown = false;
  ui.setTimer(roundSeconds);
  setState("countdown");

  let n = COUNTDOWN_SECONDS;
  ui.showMessage(n);

  const tick = setInterval(() => {
    n -= 1;
    if (n > 0) {
      ui.showMessage(n);
    } else {
      clearInterval(tick);
      ui.showMessage("GO!");
      beginPlaying();
    }
  }, 1000);
  timers.push(tick);
}

function beginPlaying() {
  setState("playing");
  lastCount = counter.count; // start counting from now

  timers.push(setTimeout(() => ui.hide(), 700));

  const endTime = Date.now() + roundSeconds * 1000;
  const tick = setInterval(() => {
    const left = Math.max(0, Math.ceil((endTime - Date.now()) / 1000));
    ui.setTimer(left);
    if (left <= 0) endRound();
  }, 200);
  timers.push(tick);
}

function endRound() {
  clearTimers();
  setState("finished");
  ui.setTimer(0);

  // Tell the opponent my final total.
  net.send({ type: "final", value: bar.p1 });

  if (!net.isConnected() || gotOpponentFinal) {
    showResult();
  } else {
    // Wait up to 1.5 seconds for the opponent's final total.
    ui.showMessage("TIME!");
    timers.push(setTimeout(showResult, 1500));
  }
}

function showResult() {
  if (state !== "finished" || resultShown) return;
  resultShown = true;

  let kind, text;
  if (bar.p1 > bar.p2) {
    kind = "win";
    text = "YOU WIN!";
  } else if (bar.p2 > bar.p1) {
    kind = "lose";
    text = "OPPONENT WINS";
  } else {
    kind = "draw";
    text = "DRAW";
  }

  // "Play again" starts a new round, "Exit" goes back to the main screen.
  ui.showWinner(kind, text, `You ${bar.p1}  -  ${bar.p2} Opponent`, playAgain, resetAll);
}

// A camera turned off during a round: stop it and go back to the start.
function abortRound(message) {
  clearTimers();
  bar.reset();
  ui.hide();
  ui.setTimer(roundSeconds);
  setState("idle");
  ui.showAlert(message);
}

function playAgain() {
  if (checkCamerasOrAlert()) {
    startRound();
  } else {
    resetAll();
  }
}

function resetAll() {
  clearTimers();
  counter.reset();
  lastCount = 0;
  bar.reset();
  ui.hide();
  ui.setTimer(roundSeconds);
  setState("idle");
}

/* ---------------- Buttons ---------------- */
startBtn.addEventListener("click", () => {
  if (cameraRunning || p1Ready) stopCamera();
  else startCameraAndModel();
});
roundBtn.addEventListener("click", () => startRound());
resetBtn.addEventListener("click", resetAll);

muteBtn.addEventListener("click", () => {
  setMuted(!isMuted());
  updateMuteBtn();
});
function updateMuteBtn() {
  muteBtn.textContent = isMuted() ? "Sound: OFF" : "Sound: ON";
}

micBtn.addEventListener("click", () => {
  micOn = !micOn;
  applyVoice();
});
voiceBtn.addEventListener("click", () => {
  hearOpponent = !hearOpponent;
  applyVoice();
});

/* ---------------- Challenge length ---------------- */

// Only the host (or a player who is not in a room) can choose the length.
function canChooseDuration() {
  return net.role !== "guest";
}

function applyDuration(seconds) {
  roundSeconds = seconds;
  durButtons.forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.seconds) === seconds)
  );
  ui.setTimer(seconds);
}

durButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (roundIsActive()) {
      ui.showAlert("You can't change the time during a round");
      return;
    }
    if (!canChooseDuration()) {
      ui.showAlert("Only the host can choose the time");
      return;
    }
    applyDuration(Number(btn.dataset.seconds));
    net.send({ type: "duration", seconds: roundSeconds });
  });
});

/* ---------------- Room (network) ---------------- */

net.onStatus = (text) => {
  roomStatus.textContent = text;
  updateRoomButtons();
};

net.onConnected = (role) => {
  sounds.connect();
  dbg("connected as " + role);
  roomStatus.textContent =
    role === "host"
      ? "Opponent joined! You are the host."
      : "Connected! The host chooses the time.";
  durationRow.classList.toggle("locked", role === "guest");
  updateRoomButtons();

  syncMyCamera(true); // tell the opponent our camera status right away
  sendHello();
  sendMyVideo();
  // The host tells the guest the current length right away.
  if (role === "host") net.send({ type: "duration", seconds: roundSeconds });
};

net.onDisconnected = () => {
  sounds.disconnect();
  dbg("opponent disconnected");
  net.cleanup();
  lastSentReady = null;
  p2Ready = false;
  remoteVideo.srcObject = null;
  opponentInfo = null;
  setOpponentLabel(null);
  roomStatus.textContent = leavingOnPurpose ? "Not connected" : "Opponent left the room.";
  durationRow.classList.remove("locked");
  updateRoomButtons();
  if (roundIsActive()) abortRound("Opponent left the room");
  updateReadyUI();
};

net.onMessage = (msg) => {
  try {
    if (!msg || typeof msg !== "object") return;

    // The opponent tells us when their camera turns on or off.
    if (msg.type === "camera") {
      dbg("opponent camera: " + (msg.ready ? "ON" : "OFF"));
      setOpponentReady(!!msg.ready);
    }

    if (msg.type === "duration" && ALLOWED_SECONDS.includes(msg.seconds) && !roundIsActive()) {
      applyDuration(msg.seconds);
    }

    if (msg.type === "alert" && typeof msg.text === "string") {
      ui.showAlert(msg.text.slice(0, 120));
    }

    if (msg.type === "start" && ALLOWED_SECONDS.includes(msg.seconds)) {
      if (roundIsActive()) return;
      if (!p1Ready || !modelReady) {
        ui.showAlert("Your opponent tried to start, but your camera or pushup detection is not ready");
        return;
      }
      applyDuration(msg.seconds);
      startRound(true);
    }

    if (msg.type === "count" && roundIsActive()) {
      const n = Math.floor(Number(msg.value));
      if (Number.isFinite(n) && n >= 0 && n < 10000) bar.setP2(n);
    }

    if (msg.type === "final") {
      const n = Math.floor(Number(msg.value));
      if (Number.isFinite(n) && n >= 0 && n < 10000 && (roundIsActive() || state === "finished")) {
        bar.setP2(n);
        gotOpponentFinal = true;
        showResult();
      }
    }

    if (msg.type === "hello") {
      if (
        typeof msg.uid === "string" &&
        msg.uid.length <= 128 &&
        typeof msg.username === "string" &&
        /^[a-z0-9_]{3,16}$/.test(msg.username)
      ) {
        opponentInfo = { uid: msg.uid, username: msg.username };
        setOpponentLabel(msg.username);
      }
    }
  } catch (err) {
    console.error("Message error:", err);
  }
};

// The opponent's live video arrives here.
net.onRemoteStream = (stream) => {
  dbg("opponent video received");
  remoteVideo.srcObject = stream;
  remoteVideo.play().catch(() => {
    // Phones may refuse to start video with sound. Start it muted instead.
    remoteVideo.muted = true;
    remoteVideo.play().catch(() => {});
    hearOpponent = false;
    applyVoice();
    ui.flashHint("Tap 'Opponent voice' to hear your opponent");
  });
  updateReadyUI();
};

// While you are in a room, show only "Leave room". Otherwise show Create / Join.
function updateRoomButtons() {
  const inRoom = !!net.role;
  createBtn.hidden = inRoom;
  codeInput.hidden = inRoom;
  joinBtn.hidden = inRoom;
  leaveBtn.hidden = !inRoom;
}

let leavingOnPurpose = false;

function leaveRoom() {
  if (roundIsActive()) {
    if (!confirm("Leave the room? The round will stop.")) return;
    abortRound("You left the room");
  }

  leavingOnPurpose = true;
  net.cleanup(); // closes the connection, the video call and the room
  leavingOnPurpose = false;

  lastSentReady = null;
  p2Ready = false;
  remoteVideo.srcObject = null;
  opponentInfo = null;
  setOpponentLabel(null);
  roomStatus.textContent = "Not connected";
  durationRow.classList.remove("locked");
  updateRoomButtons();
  updateReadyUI();
}

createBtn.addEventListener("click", () => {
  net.createRoom();
  updateRoomButtons();
});
leaveBtn.addEventListener("click", leaveRoom);
updateRoomButtons();

joinBtn.addEventListener("click", () => {
  if (codeInput.value.trim().length < 5) {
    ui.showAlert("Enter the 5-letter room code");
    return;
  }
  net.joinRoom(codeInput.value);
});

/* ---------------- Accounts, friends, history ---------------- */

// Loaded separately, so if Firebase is blocked the game itself still works.
import("./account.js")
  .then((m) => m.initAccount(ui))
  .catch((err) => console.error("Accounts not available:", err));

// Creates (or reuses) my room and gives back its code, so a friend can be invited.
function hostRoomForInvite() {
  return new Promise((resolve) => {
    if (net.role === "guest" || net.isConnected()) return resolve(null);
    if (net.role !== "host") net.createRoom();

    const started = Date.now();
    const timer = setInterval(() => {
      if (net.peer && net.peer.open && net.code) {
        clearInterval(timer);
        resolve(net.code);
      } else if (Date.now() - started > 8000) {
        clearInterval(timer);
        resolve(null);
      }
    }, 150);
  });
}

import("./friends.js")
  .then((m) => {
    m.bridge.busy = () => net.role === "guest" || net.isConnected() || roundIsActive();
    m.bridge.host = hostRoomForInvite;
    m.bridge.join = (code) => net.joinRoom(code);
  })
  .catch((err) => console.error("Friends not available:", err));

// When a result appears, save the match for a signed-in player.
ui.onResult = () => {
  Promise.all([import("./account.js"), import("./stats.js")])
    .then(([acc, st]) => {
      if (!acc.me.user || !acc.me.profile) return;
      if (!opponentInfo || opponentInfo.uid === acc.me.user.uid) return; // guest, or same account
      if (bar.p1 === 0 && bar.p2 === 0) return; // 0-0 is not saved
      const match = {
        opponentUid: opponentInfo.uid,
        opponentName: opponentInfo.username,
        mine: bar.p1,
        theirs: bar.p2,
        seconds: roundSeconds,
      };
      return st
        .saveMatch(acc.me, match)
        .then(() => import("./groups.js"))
        .then((g) => g.recordGroupMatch(acc.me, match));
    })
    .catch((err) => console.error("Could not save the match:", err));
};

/* ---------------- Side menu ---------------- */

function setDrawer(open) {
  drawer.classList.toggle("open", open);
  drawer.setAttribute("aria-hidden", String(!open));
  drawerBackdrop.hidden = !open;
  navTrigger.setAttribute("aria-expanded", String(open));
}

navTrigger.addEventListener("click", () => setDrawer(!drawer.classList.contains("open")));
drawerBackdrop.addEventListener("click", () => setDrawer(false));
drawerClose.addEventListener("click", () => setDrawer(false));
signInBtn.addEventListener("click", () => setDrawer(false));
drawer.addEventListener("click", (e) => {
  if (e.target.closest(".drawer-item")) setDrawer(false); // picking an item closes the menu
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") setDrawer(false);
});

// Show the username at the top of the menu too.
new MutationObserver(() => {
  drawerName.textContent = accountNameEl.textContent || "Welcome";
}).observe(accountNameEl, { childList: true, characterData: true, subtree: true });

/* ---------------- Start ---------------- */
updateMuteBtn();
updateReadyUI();