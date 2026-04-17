import { Config } from "@remotion/cli/config";

Config.setOverwriteOutput(true);
Config.setCodec("h264");

// Video and pixel format for optimal compatibility
Config.setVideoImageFormat("jpeg");
Config.setPixelFormat("yuv420p");

// Audio settings - Use shared audio tags to bypass browser autoplay policies
Config.setNumberOfSharedAudioTags(5);
