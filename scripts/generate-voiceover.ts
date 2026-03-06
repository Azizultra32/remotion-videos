#!/usr/bin/env npx tsx
import { generateVoiceover, listVoices } from "../src/lib/elevenlabs";

const args = process.argv.slice(2);

if (args[0] === "--list-voices") {
  const voices = await listVoices();
  console.log("\nAvailable voices:");
  voices.forEach((v) => console.log(`  ${v.voice_id} — ${v.name}`));
  process.exit(0);
}

const text = args.find((a) => !a.startsWith("--")) || "Welcome to our product demo. Experience the future of productivity.";
const voiceId = args.find((a) => a.startsWith("--voice="))?.split("=")[1];

console.log(`Generating voiceover for: "${text.slice(0, 60)}..."`);
const outputPath = await generateVoiceover({ text, voiceId });
console.log(`\nDone! Use in Remotion: staticFile("${outputPath}")`);
