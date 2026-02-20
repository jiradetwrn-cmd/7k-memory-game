import { PROCESSING_CONFIG } from "./config";

/* ============================= */
/* 🔥 SAFE VIDEO LOADER */
/* ============================= */

const loadVideo = async (blob) => {
   const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.src = URL.createObjectURL(blob);

  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => {
      // ถ้า duration เป็น Infinity หรือ 0 ให้ force seek
      if (!isFinite(video.duration) || video.duration === Infinity || video.duration === 0) {
        video.currentTime = 1e10;

        video.ontimeupdate = () => {
          video.ontimeupdate = null;

          if (isFinite(video.duration) && video.duration > 0) {
            resolve();
          } else {
            reject(new Error("Invalid video duration"));
          }
        };
      } else {
        resolve();
      }
    };

    video.onerror = () => reject(new Error("Video load error"));
  });

  return video;
};

const safeSeek = (video, time) =>
  new Promise((resolve) => {
    if (!isFinite(time) || time < 0) time = 0;
    if (time > video.duration) time = video.duration;

    video.currentTime = time;
    video.onseeked = resolve;
  });

const prepareCanvas = (video) => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  // ใช้ขนาดจริง
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  return { canvas, ctx };
};



const validateFrameCount = (video) => {
  const fps = PROCESSING_CONFIG.fps;
  const frameCount = Math.floor(video.duration * fps);

  if (!isFinite(frameCount) || frameCount <= 0) {
    throw new Error("Recording too short. Please record longer.");
  }

  return frameCount;
};

/* ============================= */
/* 1️⃣ LAST VALUE */
/* ============================= */

export const processVideoChangedPixelsLastValue = async (
  blob,
  onProgress
) => {
  const video = await loadVideo(blob);
  const { canvas, ctx } = prepareCanvas(video);
  const frameCount = validateFrameCount(video);
  const fps = PROCESSING_CONFIG.fps;

  await safeSeek(video, video.duration - 0.05);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const baselineData = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );

  const result = ctx.createImageData(canvas.width, canvas.height);
  result.data.set(baselineData.data);

  const threshold = PROCESSING_CONFIG.threshold;
  const pixelCount = canvas.width * canvas.height;

  for (let i = 0; i < frameCount; i++) {
    await safeSeek(video, i / fps);

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const currentData = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

    for (let p = 0; p < pixelCount; p++) {
      const idx = p * 4;

      const diff =
        (Math.abs(currentData.data[idx] - baselineData.data[idx]) +
          Math.abs(currentData.data[idx + 1] -
            baselineData.data[idx + 1]) +
          Math.abs(currentData.data[idx + 2] -
            baselineData.data[idx + 2])) /
        3;

      if (diff > threshold) {
        result.data[idx] = currentData.data[idx];
        result.data[idx + 1] = currentData.data[idx + 1];
        result.data[idx + 2] = currentData.data[idx + 2];
        result.data[idx + 3] = 255;
      }
    }

    if (
      i % PROCESSING_CONFIG.progressUpdateInterval === 0 ||
      i === frameCount - 1
    ) {
      onProgress?.(i + 1, frameCount);
    }
  }

  ctx.putImageData(result, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  URL.revokeObjectURL(video.src);
  return dataUrl;
};

/* ============================= */
/* 2️⃣ MAX DIFFERENCE */
/* ============================= */

export const processVideoMaxDifference = async (
  blob,
  onProgress
) => {
  const video = await loadVideo(blob);
  const { canvas, ctx } = prepareCanvas(video);
  const frameCount = validateFrameCount(video);
  const fps = PROCESSING_CONFIG.fps;

  await safeSeek(video, video.duration - 0.05);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const baselineData = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );

  const result = ctx.createImageData(canvas.width, canvas.height);
  result.data.set(baselineData.data);

  const maxDiff = new Float32Array(canvas.width * canvas.height);
  const threshold = PROCESSING_CONFIG.threshold;
  const pixelCount = canvas.width * canvas.height;

  for (let i = 0; i < frameCount; i++) {
    await safeSeek(video, i / fps);

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const currentData = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

    for (let p = 0; p < pixelCount; p++) {
      const idx = p * 4;

      const diff =
        (Math.abs(currentData.data[idx] - baselineData.data[idx]) +
          Math.abs(currentData.data[idx + 1] -
            baselineData.data[idx + 1]) +
          Math.abs(currentData.data[idx + 2] -
            baselineData.data[idx + 2])) /
        3;

      if (diff > threshold && diff > maxDiff[p]) {
        maxDiff[p] = diff;
        result.data[idx] = currentData.data[idx];
        result.data[idx + 1] = currentData.data[idx + 1];
        result.data[idx + 2] = currentData.data[idx + 2];
        result.data[idx + 3] = 255;
      }
    }

    if (
      i % PROCESSING_CONFIG.progressUpdateInterval === 0 ||
      i === frameCount - 1
    ) {
      onProgress?.(i + 1, frameCount);
    }
  }

  ctx.putImageData(result, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  URL.revokeObjectURL(video.src);
  return dataUrl;
};

/* ============================= */
/* 3️⃣ MEDIAN */
/* ============================= */
/* (ใช้ safe loader + frame validation แบบเดียวกัน) */

export const processVideoMedian = async (blob, onProgress) => {
  const video = await loadVideo(blob);
  const { canvas, ctx } = prepareCanvas(video);
  const frameCount = validateFrameCount(video);
  const fps = PROCESSING_CONFIG.fps;

  await safeSeek(video, video.duration - 0.05);
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const baselineData = ctx.getImageData(
    0,
    0,
    canvas.width,
    canvas.height
  );

  const pixelCount = canvas.width * canvas.height;
  const threshold = PROCESSING_CONFIG.threshold;

  const values = Array.from({ length: pixelCount }, () => ({
    r: [],
    g: [],
    b: [],
  }));

  for (let i = 0; i < frameCount; i++) {
    await safeSeek(video, i / fps);

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const currentData = ctx.getImageData(
      0,
      0,
      canvas.width,
      canvas.height
    );

    for (let p = 0; p < pixelCount; p++) {
      const idx = p * 4;

      const diff =
        (Math.abs(currentData.data[idx] - baselineData.data[idx]) +
          Math.abs(currentData.data[idx + 1] -
            baselineData.data[idx + 1]) +
          Math.abs(currentData.data[idx + 2] -
            baselineData.data[idx + 2])) /
        3;

      if (diff > threshold) {
        values[p].r.push(currentData.data[idx]);
        values[p].g.push(currentData.data[idx + 1]);
        values[p].b.push(currentData.data[idx + 2]);
      }
    }

    if (
      i % PROCESSING_CONFIG.progressUpdateInterval === 0 ||
      i === frameCount - 1
    ) {
      onProgress?.(i + 1, frameCount);
    }
  }

  const result = ctx.createImageData(canvas.width, canvas.height);

  for (let p = 0; p < pixelCount; p++) {
    const idx = p * 4;

    if (values[p].r.length > 0) {
      values[p].r.sort((a, b) => a - b);
      values[p].g.sort((a, b) => a - b);
      values[p].b.sort((a, b) => a - b);

      const mid = Math.floor(values[p].r.length / 2);

      result.data[idx] = values[p].r[mid];
      result.data[idx + 1] = values[p].g[mid];
      result.data[idx + 2] = values[p].b[mid];
    } else {
      result.data[idx] = baselineData.data[idx];
      result.data[idx + 1] = baselineData.data[idx + 1];
      result.data[idx + 2] = baselineData.data[idx + 2];
    }

    result.data[idx + 3] = 255;
  }

  ctx.putImageData(result, 0, 0);
  const dataUrl = canvas.toDataURL("image/png");
  URL.revokeObjectURL(video.src);
  return dataUrl;
};
/* ============================= */
/* 4️⃣ MAX BRIGHTNESS (alias) */
/* ============================= */
/* เพื่อให้ App.jsx ที่เรียกชื่อเก่าไม่พัง */

export const processVideoMaxBrightness = processVideoMaxDifference;