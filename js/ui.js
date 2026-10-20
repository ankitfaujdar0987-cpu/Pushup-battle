// Everything you see during a round: timer, countdown, winner screen, popups.
import { sounds } from "./sound.js";

export class RoundUI {
  constructor() {
    this.timerEl = document.getElementById("timer");
    this.overlay = document.getElementById("roundOverlay");
    this.textEl = document.getElementById("roundText");
    this.subEl = document.getElementById("roundSub");
    this.againBtn = document.getElementById("againBtn");
    this.hintEl = document.getElementById("hint");
    this.hintTimer = null;

    // Put "Play again" and "Exit" side by side in one row.
    this.actions = document.createElement("div");
    this.actions.className = "round-actions";
    this.actions.hidden = true;
    this.againBtn.hidden = false;
    this.againBtn.parentNode.insertBefore(this.actions, this.againBtn);
    this.actions.appendChild(this.againBtn);

    this.exitBtn = document.createElement("button");
    this.exitBtn.textContent = "Exit";
    this.exitBtn.className = "ghost";
    this.actions.appendChild(this.exitBtn);
  }

  setTimer(seconds) {
    const m = Math.floor(seconds / 60);
const s = seconds % 60;
this.timerEl.textContent = m + ":" + String(s).padStart(2, "0");
    // Turn red in the last 10 seconds.
    this.timerEl.classList.toggle("danger", seconds > 0 && seconds <= 10);
        if (seconds > 10) this.lastTick = null;
    if (seconds > 0 && seconds <= 10 && seconds !== this.lastTick) {
      this.lastTick = seconds;
      sounds.tick();
    }
  }

  // Big text in the middle of the screen: 3, 2, 1, GO!
  showMessage(text) {
        if (text === "GO!") sounds.go();
    else if (typeof text === "number") sounds.countdown();
    this.overlay.hidden = false;
    this.actions.hidden = true;
    this.subEl.textContent = "";
    this.textEl.className = "round-text";
    this.textEl.textContent = text;
    this.restartPop();
  }

  // kind is "win", "lose" or "draw"
  showWinner(kind, text, sub, onAgain, onExit) {
        if (this.onResult) this.onResult(kind);
        if (sounds[kind]) sounds[kind]();
    this.overlay.hidden = false;
    this.textEl.className = "round-text result " + kind;
    this.textEl.textContent = text;
    this.subEl.textContent = sub;
    this.actions.hidden = false;
    this.againBtn.onclick = onAgain;
    this.exitBtn.onclick = onExit;
    this.restartPop();
  }

  hide() {
    this.overlay.hidden = true;
    this.actions.hidden = true;
  }

  // Red popup at the top of the screen. Disappears after 3 seconds.
  showAlert(text) {
        sounds.alert();
    document.querySelectorAll(".toast").forEach((e) => e.remove());

    const box = document.createElement("div");
    box.className = "toast";
    box.textContent = text;
    document.body.appendChild(box);

    setTimeout(() => box.classList.add("hide"), 3000);
    setTimeout(() => box.remove(), 3500);
  }

  // TEMPORARY: shows, inside the opponent's panel, the popup they would see.
  showOpponentPreview(text) {
    const screen = document.querySelector(".p2 .screen");
    if (!screen) return;
    screen.querySelectorAll(".panel-alert").forEach((e) => e.remove());

    const box = document.createElement("div");
    box.className = "panel-alert";

    const label = document.createElement("small");
    label.textContent = "Message sent to opponent:";
    const msg = document.createElement("span");
    msg.textContent = text;

    box.appendChild(label);
    box.appendChild(msg);
    screen.appendChild(box);

    setTimeout(() => box.remove(), 4000);
  }

  // Small yellow message under the buttons, disappears after 2 seconds.
  flashHint(text) {
    this.hintEl.textContent = text;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => {
      this.hintEl.textContent = "";
    }, 2000);
  }

  // Replays the "pop" animation each time the text changes.
  restartPop() {
    this.textEl.classList.remove("pop");
    void this.textEl.offsetWidth;
    this.textEl.classList.add("pop");
  }
}