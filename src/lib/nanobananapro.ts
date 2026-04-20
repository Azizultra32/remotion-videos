import crypto from "crypto";
import fs from "fs";
import path from "path";

const API_BASE = "https://api.nanobananapro.com/v1";
const POLL_INTERVAL_MS = 2000;
const MAX_POLL_ATTEMPTS = 90; // 3 minutes max

interface NanoBananaResponse {
  id?: string;
  status?: "pending" | "processing" | "completed" | "failed";
  output?: {
    image_url?: string;
  };
  error?: string;
}

/**
 * Generate a product image using the Nano Banana Pro API.
 *
 * @param prompt - Text description of the image to generate
 * @param outputPath - Optional output path relative to public/ (default: "images/<hash>.png")
 * @returns Path relative to public/ for use with staticFile()
 */
export async function generateProductImage(prompt: string, outputPath?: string): Promise<string> {
  const apiKey = process.env.NANOBANANAPRO_API_KEY;
  if (!apiKey) throw new Error("NANOBANANAPRO_API_KEY not set");

  const outputDir = path.join(process.cwd(), "public", "images");
  fs.mkdirSync(outputDir, { recursive: true });

  // Determine output filename
  const hash = crypto.createHash("md5").update(prompt).digest("hex").slice(0, 8);
  const relativePath = outputPath || `images/product-${hash}.png`;
  const filepath = path.join(process.cwd(), "public", relativePath);

  // Ensure parent directory exists
  fs.mkdirSync(path.dirname(filepath), { recursive: true });

  // Skip if already generated
  if (fs.existsSync(filepath)) {
    console.log(`[nanobananapro] Using cached image: ${relativePath}`);
    return relativePath;
  }

  // Submit the generation request
  console.log(`[nanobananapro] Generating image for: "${prompt.slice(0, 80)}..."`);

  const submitResponse = await fetch(`${API_BASE}/generate`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      width: 1024,
      height: 1024,
      num_images: 1,
    }),
  });

  if (!submitResponse.ok) {
    const errorText = await submitResponse.text();
    throw new Error(`Nano Banana Pro API error ${submitResponse.status}: ${errorText}`);
  }

  const submitData = (await submitResponse.json()) as NanoBananaResponse;

  // If the response includes the image URL directly (synchronous)
  if (submitData.output?.image_url) {
    return await downloadImage(submitData.output.image_url, filepath, relativePath);
  }

  // Otherwise poll for async completion
  const jobId = submitData.id;
  if (!jobId) {
    throw new Error(
      `Nano Banana Pro API did not return a job ID or image: ${JSON.stringify(submitData)}`,
    );
  }

  console.log(`[nanobananapro] Job submitted: ${jobId}`);

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const pollResponse = await fetch(`${API_BASE}/status/${jobId}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    if (!pollResponse.ok) {
      console.warn(`[nanobananapro] Poll attempt ${attempt + 1} failed: ${pollResponse.status}`);
      continue;
    }

    const pollData = (await pollResponse.json()) as NanoBananaResponse;

    if (pollData.status === "completed" && pollData.output?.image_url) {
      return await downloadImage(pollData.output.image_url, filepath, relativePath);
    }

    if (pollData.status === "failed") {
      throw new Error(`Nano Banana Pro job failed: ${pollData.error || "unknown error"}`);
    }

    if ((attempt + 1) % 10 === 0) {
      console.log(
        `[nanobananapro] Still processing... (attempt ${attempt + 1}/${MAX_POLL_ATTEMPTS})`,
      );
    }
  }

  throw new Error(
    `Nano Banana Pro job timed out after ${(MAX_POLL_ATTEMPTS * POLL_INTERVAL_MS) / 1000}s`,
  );
}

async function downloadImage(url: string, filepath: string, relativePath: string): Promise<string> {
  console.log(`[nanobananapro] Downloading generated image...`);
  const imageResponse = await fetch(url);
  if (!imageResponse.ok) {
    throw new Error(`Failed to download generated image: ${imageResponse.status}`);
  }

  const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
  fs.writeFileSync(filepath, imageBuffer);
  console.log(`[nanobananapro] Saved image: ${relativePath} (${imageBuffer.length} bytes)`);

  return relativePath;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
