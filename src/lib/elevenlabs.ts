import fs from "fs";
import path from "path";
import crypto from "crypto";

const API_BASE = "https://api.elevenlabs.io/v1";

interface VoiceoverOptions {
  text: string;
  voiceId?: string; // default: "21m00Tcm4TlvDq8ikWAM" (Rachel)
  modelId?: string; // default: "eleven_monolingual_v1"
  outputDir?: string; // default: "public/audio"
}

export async function generateVoiceover(options: VoiceoverOptions): Promise<string> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");

  const voiceId = options.voiceId ?? "21m00Tcm4TlvDq8ikWAM";
  const modelId = options.modelId ?? "eleven_monolingual_v1";
  const outputDir = options.outputDir ?? path.join(process.cwd(), "public", "audio");

  // Create output directory
  fs.mkdirSync(outputDir, { recursive: true });

  // Generate filename from text hash
  const hash = crypto.createHash("md5").update(options.text).digest("hex").slice(0, 8);
  const filename = `voiceover-${hash}.mp3`;
  const filepath = path.join(outputDir, filename);

  // Skip if already generated
  if (fs.existsSync(filepath)) {
    console.log(`Using cached voiceover: ${filename}`);
    return `audio/${filename}`;
  }

  const response = await fetch(`${API_BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text: options.text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`ElevenLabs API error ${response.status}: ${error}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(filepath, buffer);
  console.log(`Generated voiceover: ${filename} (${buffer.length} bytes)`);

  // Return the path relative to public/ for use with staticFile()
  return `audio/${filename}`;
}

export async function listVoices(): Promise<Array<{ voice_id: string; name: string }>> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error("ELEVENLABS_API_KEY not set");

  const response = await fetch(`${API_BASE}/voices`, {
    headers: { "xi-api-key": apiKey },
  });

  if (!response.ok) throw new Error(`Failed to list voices: ${response.status}`);
  const data = await response.json();
  return data.voices.map((v: any) => ({ voice_id: v.voice_id, name: v.name }));
}
