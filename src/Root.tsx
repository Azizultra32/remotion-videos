import React from "react";
import { Composition } from "remotion";
import { TextOverlay, textOverlaySchema } from "./compositions/TextOverlay";
import { ProductDemo, productDemoSchema } from "./compositions/ProductDemo";
import { MMXPipelineReport, mmxPipelineReportSchema } from "./compositions/MMXPipelineReport";
import {
  BrandedDemo,
  brandedDemoSchema,
  calculateBrandedDemoMetadata,
} from "./compositions/BrandedDemo";
import {
  VideoStitcher,
  videoStitcherSchema,
  calculateVideoStitcherMetadata,
  defaultVideoStitcherProps,
} from "./compositions/VideoStitcher";
import {
  AdCreative,
  adCreativeSchema,
  defaultAdCreativePropsHorizontal,
  defaultAdCreativePropsVertical,
} from "./compositions/AdCreative";
import { MapAnimation, mapAnimationSchema } from "./compositions/MapAnimation";
import { ExplainerVideo, explainerVideoSchema } from "./compositions/ExplainerVideo";
import { SocialProof, socialProofSchema } from "./compositions/SocialProof";
import {
  CountdownTimer,
  countdownTimerSchema,
  calculateCountdownTimerMetadata,
  defaultCountdownTimerProps,
} from "./compositions/CountdownTimer";
import {
  CaptionedVideo,
  captionedVideoSchema,
  calculateCaptionedVideoMetadata,
  defaultCaptionedVideoProps,
} from "./compositions/CaptionedVideo";
import {
  LogoReveal,
  logoRevealSchema,
  calculateLogoRevealMetadata,
  defaultLogoRevealProps,
} from "./compositions/LogoReveal";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="TextOverlay"
        component={TextOverlay}
        schema={textOverlaySchema}
        durationInFrames={150}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          title: "Hello, Remotion!",
          subtitle: "Made with Claude Code",
          backgroundColor: "#0b1215",
          textColor: "#ffffff",
          accentColor: "#3b82f6",
        }}
      />
      <Composition
        id="ProductDemo"
        component={ProductDemo}
        schema={productDemoSchema}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          productName: "My Product",
          tagline: "The future of productivity",
          features: ["Fast", "Reliable", "Beautiful"],
          ctaText: "Get Started",
          backgroundColor: "#ffffff",
          primaryColor: "#3b82f6",
          textColor: "#111827",
        }}
      />
      <Composition
        id="MMXPipelineReport"
        component={MMXPipelineReport}
        schema={mmxPipelineReportSchema}
        durationInFrames={450}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          stages: [
            { name: "PRE-FLIGHT", status: "passed", findings: 0, duration: "2s" },
            { name: "CATHEDRAL", status: "passed", findings: 12, duration: "45s" },
            { name: "FIND", status: "passed", findings: 72, duration: "120s" },
            { name: "DISTILL", status: "passed", findings: 51, duration: "90s" },
            { name: "PREDICT", status: "passed", findings: 5, duration: "60s" },
            { name: "PROPOSE", status: "failed", findings: 0, duration: "15s" },
            { name: "IMPLEMENT", status: "pending", findings: 0, duration: "-" },
            { name: "FINAL GUARD", status: "pending", findings: 0, duration: "-" },
          ],
          runId: "run-001",
          targetRepo: "mmx-test-repo",
          totalCost: "$48.61",
        }}
      />
      <Composition
        id="BrandedDemo"
        component={BrandedDemo}
        schema={brandedDemoSchema}
        calculateMetadata={calculateBrandedDemoMetadata}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          brandName: "example-brand",
          brandConfig: {
            name: "Example Brand",
            tagline: "Innovation at Scale",
            colors: {
              primary: "#3b82f6",
              secondary: "#8b5cf6",
              accent: "#f59e0b",
              background: "#ffffff",
              text: "#111827",
            },
            typography: {
              heading: "system-ui, -apple-system, sans-serif",
              body: "system-ui, -apple-system, sans-serif",
            },
            social: {
              website: "https://example.com",
              twitter: "@example",
            },
          },
          features: [
            {
              title: "Lightning Fast",
              description:
                "Built for speed with optimized performance at every layer of the stack.",
              icon: "\u26A1",
            },
            {
              title: "Rock Solid",
              description:
                "Enterprise-grade reliability with 99.99% uptime guarantee.",
              icon: "\uD83D\uDEE1\uFE0F",
            },
            {
              title: "Beautifully Simple",
              description:
                "An intuitive interface that your team will love from day one.",
              icon: "\u2728",
            },
          ],
          ctaText: "Ready to Get Started?",
          showLogo: false,
        }}
      />
      <Composition
        id="VideoStitcher"
        component={VideoStitcher}
        schema={videoStitcherSchema}
        calculateMetadata={calculateVideoStitcherMetadata}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultVideoStitcherProps}
      />
      <Composition
        id="AdCreative"
        component={AdCreative}
        schema={adCreativeSchema}
        durationInFrames={450}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultAdCreativePropsHorizontal}
      />
      <Composition
        id="AdCreativeVertical"
        component={AdCreative}
        schema={adCreativeSchema}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultAdCreativePropsVertical}
      />
      <Composition
        id="MapAnimation"
        component={MapAnimation}
        schema={mapAnimationSchema}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          locations: [
            { name: "San Francisco", x: 180, y: 420, color: "#6C63FF" },
            { name: "New York", x: 420, y: 380, color: "#FF6B6B" },
            { name: "London", x: 870, y: 310, color: "#4ECDC4" },
            { name: "Tokyo", x: 1580, y: 400, color: "#FFE66D" },
            { name: "Sydney", x: 1600, y: 720, color: "#95E1D3" },
            { name: "São Paulo", x: 530, y: 660, color: "#F38181" },
          ],
          connectionSpeed: 2,
          backgroundColor: "#0a0a1a",
        }}
      />
      <Composition
        id="ExplainerVideo"
        component={ExplainerVideo}
        schema={explainerVideoSchema}
        durationInFrames={360}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          scenes: [
            {
              title: "The Problem",
              description:
                "Finding and fixing bugs in large codebases takes weeks of manual effort.",
              iconEmoji: "\uD83D\uDD0D",
              backgroundColor: "#1a1a2e",
            },
            {
              title: "Our Solution",
              description:
                "An AI-powered pipeline that autonomously discovers, triages, and fixes issues.",
              iconEmoji: "\u2728",
              backgroundColor: "#16213e",
            },
            {
              title: "How It Works",
              description:
                "Eight stages from deep analysis to verified implementation, with human oversight at every critical gate.",
              iconEmoji: "\u2699\uFE0F",
              backgroundColor: "#0f3460",
            },
            {
              title: "Get Started",
              description:
                "Deploy MetaMatrix on your codebase today and ship with confidence.",
              iconEmoji: "\uD83D\uDE80",
              backgroundColor: "#1a1a2e",
            },
          ],
        }}
      />
      <Composition
        id="SocialProof"
        component={SocialProof}
        schema={socialProofSchema}
        durationInFrames={360}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          testimonials: [
            {
              quote:
                "MetaMatrix found 3 critical bugs our team missed in code review. Incredible.",
              author: "Sarah Chen",
              role: "VP Engineering, Acme Corp",
              rating: 5,
            },
            {
              quote:
                "We deployed it on our legacy codebase and it paid for itself in a week.",
              author: "James Wilson",
              role: "CTO, StartupCo",
              rating: 5,
            },
            {
              quote:
                "The Cathedral analysis alone is worth the price of admission.",
              author: "Maria Garcia",
              role: "Lead Developer, BigTech Inc",
              rating: 4,
            },
          ],
          accentColor: "#6C63FF",
        }}
      />
      <Composition
        id="CountdownTimer"
        component={CountdownTimer}
        schema={countdownTimerSchema}
        calculateMetadata={calculateCountdownTimerMetadata}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultCountdownTimerProps}
      />
      <Composition
        id="CaptionedVideo"
        component={CaptionedVideo}
        schema={captionedVideoSchema}
        calculateMetadata={calculateCaptionedVideoMetadata}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultCaptionedVideoProps}
      />
      <Composition
        id="LogoReveal"
        component={LogoReveal}
        schema={logoRevealSchema}
        calculateMetadata={calculateLogoRevealMetadata}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={defaultLogoRevealProps}
      />
    </>
  );
};
