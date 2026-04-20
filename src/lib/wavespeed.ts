import crypto from "crypto";
import fs from "fs";
import path from "path";

const API_BASE = "https://api.wavespeed.ai/api/v2";
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 120; // 6 minutes max

interface WaveSpeedResponse {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  output?: {
    video_url?: string;
  };
  error?: string;
}

/**
 * Generate a lip-sync video using the WaveSpeed API.
 *
 * Takes a face image URL and a local audio file path, sends them to WaveSpeed,
 * polls for completion, and downloads the result video to public/video/.
 *
 * @param imageUrl - URL of the face image (must be publicly accessible)
 * @param audioPath - Absolute path to the audio file on disk
 * @returns Path relative to public/ for use with staticFile() (e.g. "video/lipsync-abc123.mp4")
 */
export async function generateLipSync(imageUrl: string, audioPath: string): Promise<string> {
  const apiKey = process.env.WAVESPEED_API_KEY;
  if (!apiKey) throw new Error("WAVESPEED_API_KEY not set");

  const outputDir = path.join(process.cwd(), "public", "video");
  fs.mkdirSync(outputDir, { recursive: true });

  // Generate a deterministic filename from inputs
  const hash = crypto
    .createHash("md5")
    .update(imageUrl + audioPath)
    .digest("hex")
    .slice(0, 8);
  const filename = `lipsync-${hash}.mp4`;
  const filepath = path.join(outputDir, filename);

  // Skip if already generated
  if (fs.existsSync(filepath)) {
    console.log(`[wavespeed] Using cached lip-sync video: ${filename}`);
    return `video/${filename}`;
  }

  // Read audio file and convert to base64 data URI
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }
  const audioBuffer = fs.readFileSync(audioPath);
  const audioBase64 = audioBuffer.toString("base64");
  const audioMime = audioPath.endsWith(".wav") ? "audio/wav" : "audio/mpeg";
  const audioDataUri = `data:${audioMime};base64,${audioBase64}`;

  // Submit the lip-sync job
  console.log(`[wavespeed] Submitting lip-sync job...`);
  console.log(`[wavespeed]   Image: ${imageUrl}`);
  console.log(`[wavespeed]   Audio: ${audioPath}`);

  const submitResponse = await fetch(`${API_BASE}/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_url: imageUrl,
      audio_url: audioDataUri,
    }),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    throw new Error(`WaveSpeed API submit error ${submitResponse.status}: ${errorText}`);
  }

  const submitData = (await submitResponse.json()) as WaveSpeedResponse;
  const jobId = submitData.id;

  if (!jobId) {
    throw new Error(`WaveSpeed API did not return a job ID: ${JSON.stringify(submitData)}`);
  }

  console.log(`[wavespeed] Job submitted: ${jobId}`);

  // Poll for completion
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const pollResponse = await fetch(`${API_BASE}/status/${jobId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!pollResponse.ok) {
      console.warn(`[wavespeed] Poll attempt ${attempt + 1} failed: ${pollResponse.status}`);
      continue;
    }

    const pollData = (await pollResponse.json()) as WaveSpeedResponse;

    if (pollData.status === "completed") {
      const videoUrl = pollData.output?.video_url;
      if (!videoUrl) {
        throw new Error(
          `WaveSpeed job completed but no video URL in response: ${JSON.stringify(pollData)}`,
        );
      }

      // Download the result video
      console.log(`[wavespeed] Downloading result video...`);
      const videoResponse = await fetch(videoUrl);
      if (!videoResponse.ok) {
        throw new Error(`Failed to download lip-sync video: ${videoResponse.status}`);
      }

      const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
      fs.writeFileSync(filepath, videoBuffer);
      console.log(`[wavespeed] Saved lip-sync video: ${filename} (${videoBuffer.length} bytes)`);

      return `video/${filename}`;
    }

    if (pollData.status === "failed") {
      throw new Error(`WaveSpeed job failed: ${pollData.error || "unknown error"}`);
    }

    // Still processing
    if ((attempt + 1) % 10 === 0) {
      console.log(`[wavespeed] Still processing... (attempt ${attempt + 1}/${MAX_POLL_ATTEMPTS})`);
    }
  }

  throw new Error(
    `WaveSpeed job timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
