// Uses MediaPipe to find body points (shoulders, elbows, wrists...) in each frame.
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const WASM = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
// "full" is more accurate than "lite". It is a bit heavier, which a laptop handles fine.
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";

let poseLandmarker;

export async function loadPose() {
  if (poseLandmarker) return;
  const vision = await FilesetResolver.forVisionTasks(WASM);

  const make = (delegate) =>
    PoseLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "VIDEO",
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

  try {
    poseLandmarker = await make("GPU"); // fast
  } catch (err) {
    console.warn("GPU not available, using CPU:", err);
    poseLandmarker = await make("CPU");
  }
}

// Returns the list of body points for one person, or null if nobody is found.
export function detectPose(videoEl, timestamp) {
  const result = poseLandmarker.detectForVideo(videoEl, timestamp);
  return result.landmarks[0] || null;
}

// Draws the dots and lines on top of the video so you can see what it detects.
export function drawPose(canvas, landmarks) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!landmarks) return;

  const drawer = new DrawingUtils(ctx);
  drawer.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS);
  drawer.drawLandmarks(landmarks, { radius: 3 });
}