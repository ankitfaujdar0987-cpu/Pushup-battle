// Connects two players over the internet (WebRTC through PeerJS).

const PREFIX = "pushupbattle-";
const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing letters (O/0, I/1)

function makeCode() {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return code;
}

export class Network {
  constructor() {
    this.peer = null;
    this.conn = null;
    this.role = null; // "host" or "guest"
      this.code = null;
    this.outCall = null; // the video call we started

    // main.js fills these in:
    this.onRemoteStream = () => {}; // (video stream)
    this.onStatus = () => {};       // (text)
    this.onConnected = () => {};    // (role)
    this.onDisconnected = () => {};
    this.onMessage = () => {};      // (message object)
  }
    // Listen for the opponent's video. We answer without sending anything back.
  listenForCalls() {
    this.peer.on("call", (call) => {
      call.answer();
      call.on("stream", (stream) => this.onRemoteStream(stream));
    });
  }

  // Send my camera to the opponent.
  sendVideo(stream) {
    if (!this.isConnected() || !this.peer) return;
    if (this.outCall) this.outCall.close();
    this.outCall = this.peer.call(this.conn.peer, stream);
  }

  isConnected() {
    return !!this.conn && this.conn.open;
  }

  send(message) {
    if (this.isConnected()) this.conn.send(message);
  }

  createRoom() {
    this.cleanup();
    this.role = "host";
    this.code = makeCode();
    this.peer = new Peer(PREFIX + this.code);
        this.listenForCalls();

    this.peer.on("open", () => {
      this.onStatus(`Room code: ${this.code}  -  waiting for opponent...`);
    });

    this.peer.on("connection", (conn) => {
      if (this.isConnected()) {
        conn.close(); // room is full (only 2 players)
        return;
      }
      this.setupConnection(conn);
    });

    this.peer.on("error", (err) => {
      if (err.type === "unavailable-id") this.createRoom(); // code taken, try another
      else this.onStatus("Connection error: " + err.type);
    });
  }

  joinRoom(code) {
    this.cleanup();
    this.role = "guest";
    this.code = code.toUpperCase().trim();
    this.onStatus("Connecting...");
    this.peer = new Peer();
        this.listenForCalls();

    this.peer.on("open", () => {
      const conn = this.peer.connect(PREFIX + this.code, { reliable: true });
      this.setupConnection(conn);
    });

    this.peer.on("error", (err) => {
      if (err.type === "peer-unavailable") {
        this.onStatus("Room not found. Check the code.");
      } else {
        this.onStatus("Connection error: " + err.type);
      }
    });
  }

  setupConnection(conn) {
    this.conn = conn;
    conn.on("open", () => this.onConnected(this.role));
    conn.on("data", (msg) => this.onMessage(msg));
    conn.on("close", () => {
      this.conn = null;
      this.onDisconnected();
    });
  }

  cleanup() {
        if (this.outCall) this.outCall.close();
    this.outCall = null;
    if (this.conn) this.conn.close();
    if (this.peer) this.peer.destroy();
    this.conn = null;
    this.peer = null;
    this.role = null;
    this.code = null;
  }
}