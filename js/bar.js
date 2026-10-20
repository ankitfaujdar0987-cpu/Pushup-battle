// The tug-of-war bar: whoever has more pushups pushes the bar toward the other side.
import { sounds } from "./sound.js";

export class TugBar {
  constructor() {
    this.fillEl = document.getElementById("barFill");
    this.p1PctEl = document.getElementById("p1Pct");
    this.p2PctEl = document.getElementById("p2Pct");
    this.p1BadgeEl = document.getElementById("p1Badge");
    this.p2BadgeEl = document.getElementById("p2Badge");
    this.leadEl = document.getElementById("leadText");
    this.reset();
  }

  reset() {
    this.p1 = 0;
    this.p2 = 0;
    this.render();
  }

  addP1(n = 1) {
        sounds.rep();
    this.p1 += n;
    this.render();
  }

  addP2(n = 1) {
    this.p2 += n;
    this.render();
  }
    // Used when the real opponent's total arrives over the network.
  setP2(n) {
        if (n > this.p2) sounds.opponentRep();
    this.p2 = n;
    this.render();
  }

  render() {
    const total = this.p1 + this.p2;
    const p1Share = total === 0 ? 50 : (this.p1 / total) * 100;

    // Keep a small piece of each colour visible so the bar never disappears.
    const visible = Math.min(96, Math.max(4, p1Share));
    this.fillEl.style.width = visible + "%";

    this.p1PctEl.textContent = Math.round(p1Share) + "%";
    this.p2PctEl.textContent = Math.round(100 - p1Share) + "%";
    this.p1BadgeEl.textContent = this.p1;
    this.p2BadgeEl.textContent = this.p2;

    if (this.p1 === this.p2) {
      this.leadEl.textContent = "Tied";
    } else if (this.p1 > this.p2) {
      this.leadEl.textContent = `You lead by ${this.p1 - this.p2}`;
    } else {
      this.leadEl.textContent = `Opponent leads by ${this.p2 - this.p1}`;
    }
  }
}