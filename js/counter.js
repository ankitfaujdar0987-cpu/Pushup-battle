// Counts pushups from the elbow angle (side view) and checks the form.

const MIN_VIS = 0.5;

// Counting
const UP_ANGLE = 150;     // elbows this straight = top of a pushup
const DOWN_ANGLE = 105;   // elbows bent this much = bottom
const MIN_REP_MS = 350;   // at least this long between two counted pushups
const SMOOTH = 0.6;       // 1 = no smoothing (fastest), lower = smoother

// Body position and form
const MAX_TILT = 40;          // body must be within 40 degrees of horizontal
const BODY_LINE_MIN = 145;    // shoulder-hip-ankle angle: lower = sagging or piked hips
const KNEE_MIN = 140;         // hip-knee-ankle angle: lower = bent knees (knee pushup)
const BAD_FORM_SHARE = 0.35;  // a rep is rejected if more than 35% of it had bad form
const GRACE_MS = 500;         // keep the rep going if the camera loses you for less than this

const ASPECT = 4 / 3;

// Angle (in degrees) at point b, formed by points a-b-c.
// "aspect" is picture width / height, so the angle is not stretched.
function angle(a, b, c, aspect) {
  const ab = { x: (a.x - b.x) * aspect, y: a.y - b.y };
  const cb = { x: (c.x - b.x) * aspect, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (mag === 0) return null;
  const cos = Math.min(1, Math.max(-1, dot / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

const seen = (p) => !!p && (p.visibility ?? 0) >= MIN_VIS;

// Body point numbers for each side of the body
const SIDES = [
  { sh: 11, el: 13, wr: 15, hip: 23, kn: 25, an: 27 }, // left
  { sh: 12, el: 14, wr: 16, hip: 24, kn: 26, an: 28 }, // right
];

export class PushupCounter {
  constructor() {
    this.mode = "side"; // "side" (camera at your side) or "front" (phone in front of you)
    this.aspect = ASPECT; // picture width / height, set by main.js
    this.reset();
  }

  setMode(mode) {
    this.mode = mode;
    this.reset();
  }

  reset() {
    this.count = 0;
    this.state = "waiting"; // waiting -> up -> down -> up (count +1)
    this.smoothAngle = null;
    this.side = 0;
    this.lastGood = 0;
    this.lastRepTime = 0;
    this.repFrames = 0;
    this.repBad = 0;
    this.notice = "";
    this.noticeUntil = 0;
    this.lastStatus = "Get into pushup position (side view, full body visible)";
    // front view
    this.topY = null;
    this.smoothDepth = null;
    this.fDownSince = 0;
    this.fLastRep = 0;
  }

  say(text, now) {
    this.notice = text;
    this.noticeUntil = now + 2000;
  }

  // Picks the side of the body the camera sees best, and sticks with it.
  pickSide(lm) {
    const score = (s) =>
      Math.min(
        lm[s.sh].visibility ?? 0,
        lm[s.el].visibility ?? 0,
        lm[s.wr].visibility ?? 0,
        lm[s.hip].visibility ?? 0
      );
    const current = score(SIDES[this.side]);
    const other = score(SIDES[1 - this.side]);
    if (current < MIN_VIS && other > current) this.side = 1 - this.side;
    return SIDES[this.side];
  }

  // Front view: the phone lies on the floor in front of you, facing you.
  // We count how far your head drops, measured in shoulder-widths.
  updateFront(lm) {
    const FRONT_DOWN = 0.35;
    const FRONT_UP = 0.15;
    const MIN_REP = 400;
    const MIN_DOWN = 80;

    const nose = lm[0];
    const ls = lm[11];
    const rs = lm[12];
    if (!seen(nose) || !seen(ls) || !seen(rs)) {
      this.state = "waiting";
      this.smoothDepth = null;
      return {
        count: this.count,
        angle: null,
        status: "Face the phone: head and both shoulders must be visible",
      };
    }

    const sw = Math.hypot((ls.x - rs.x) * (this.aspect || 1), ls.y - rs.y);
    if (sw < 0.05) {
      return { count: this.count, angle: null, status: "Move a little closer to the phone" };
    }

    const y = nose.y;
    if (this.topY === null || y < this.topY) this.topY = y;
    else if (this.state !== "down") this.topY += (y - this.topY) * 0.01;

    const raw = (y - this.topY) / sw;
    this.smoothDepth = this.smoothDepth === null ? raw : 0.5 * this.smoothDepth + 0.5 * raw;
    const d = this.smoothDepth;
    const now = performance.now();

    if (this.state === "waiting") {
      if (d < FRONT_UP) this.state = "up";
    } else if (this.state === "up") {
      if (d > FRONT_DOWN) {
        this.state = "down";
        this.fDownSince = now;
      }
    } else if (this.state === "down") {
      if (d < FRONT_UP) {
        this.state = "up";
        if (now - this.fDownSince >= MIN_DOWN && now - this.fLastRep > MIN_REP) {
          this.count += 1;
          this.fLastRep = now;
        }
      }
    }

    const status =
      this.state === "waiting" ? "Get ready, arms straight" :
      this.state === "up" ? "Go down" : "Push up!";
    return { count: this.count, angle: null, status: status + " | drop " + d.toFixed(2) };
  }

  update(lm) {
    if (this.mode === "front") return this.updateFront(lm);

    const now = performance.now();
    const asp = this.aspect || ASPECT;
    const s = this.pickSide(lm);
    const sh = lm[s.sh];
    const el = lm[s.el];
    const wr = lm[s.wr];
    const hip = lm[s.hip];
    const kn = lm[s.kn];
    const an = lm[s.an];

    // The arm and hip must be seen. The far end of the body is the ankle, else the knee, else the hip.
    const armOk = seen(sh) && seen(el) && seen(wr) && seen(hip);
    const far = seen(an) ? an : seen(kn) ? kn : hip;

    let tilt = 90;
    if (armOk) {
      const dx = Math.abs(sh.x - far.x) * asp;
      const dy = Math.abs(sh.y - far.y);
      tilt = (Math.atan2(dy, dx) * 180) / Math.PI;
    }

    if (!armOk || tilt >= MAX_TILT) {
      // Don't give up straight away: fast movement can hide a joint for a moment.
      if (now - this.lastGood > GRACE_MS) {
        this.state = "waiting";
        this.smoothAngle = null;
        this.lastStatus = "Get into pushup position (side view, full body visible)";
      }
      return { count: this.count, angle: null, status: this.lastStatus };
    }
    this.lastGood = now;

    const raw = angle(sh, el, wr, asp);
    if (raw === null) return { count: this.count, angle: null, status: this.lastStatus };

    this.smoothAngle =
      this.smoothAngle === null ? raw : SMOOTH * raw + (1 - SMOOTH) * this.smoothAngle;
    const a = this.smoothAngle;

    // Form: is the body one straight line, and are the knees straight?
    const line = seen(an) ? angle(sh, hip, an, asp) : null;
    const knee = seen(an) && seen(kn) ? angle(hip, kn, an, asp) : null;
    const badNow = (line !== null && line < BODY_LINE_MIN) || (knee !== null && knee < KNEE_MIN);

    if (this.state === "waiting") {
      if (a > UP_ANGLE) this.state = "up";
    } else if (this.state === "up") {
      if (a < DOWN_ANGLE) {
        this.state = "down";
        this.repFrames = 0;
        this.repBad = 0;
      }
    } else if (this.state === "down") {
      this.repFrames += 1;
      if (badNow) this.repBad += 1;

      if (a > UP_ANGLE) {
        this.state = "up";
        const badShare = this.repBad / Math.max(1, this.repFrames);
        if (now - this.lastRepTime > MIN_REP_MS) {
          if (badShare > BAD_FORM_SHARE) {
            this.say("Not counted: keep your body and knees straight", now);
          } else {
            this.count += 1;
            this.lastRepTime = now;
          }
        }
      }
    }

    let status =
      this.state === "waiting" ? "Get ready, arms straight" :
      this.state === "up" ? "Go down" : "Push up!";
    if (now < this.noticeUntil) status = this.notice;
    this.lastStatus = status;

    const extra =
      (line !== null ? " | body " + Math.round(line) + "°" : "") +
      (knee !== null ? " knee " + Math.round(knee) + "°" : "");
    return { count: this.count, angle: a, status: status + extra };
  }
}