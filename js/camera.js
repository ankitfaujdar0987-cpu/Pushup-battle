// Opens the camera and shows it inside the <video> element.
export async function startCamera(videoEl) {
   const videoSettings = { width: 640, height: 480, facingMode: "user" };
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: videoSettings,
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (err) {
    // No microphone (or permission denied): use the camera only.
    stream = await navigator.mediaDevices.getUserMedia({
      video: videoSettings,
      audio: false,
    });
  }

  videoEl.srcObject = stream;

  await new Promise((resolve) => {
    videoEl.onloadedmetadata = () => resolve();
  });
  await videoEl.play();
}