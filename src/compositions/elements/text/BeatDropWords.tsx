import React from "react";
import { z } from "zod";
import type { ElementModule, ElementRendererProps } from "../types";
import { FONT_STACK, expDecay } from "../_helpers";

const schema = z.object({
  words: z.array(z.string()),
  mode: z.enum(["cut", "flash"]),
  textColor: z.string(),
  backgroundColor: z.string(),
  fontSize: z.number(),
  fontWeight: z.number(),
  fontFamily: z.string(),
  letterSpacing: z.string(),
  useDownbeatsOnly: z.boolean(),
  decay: z.number(),
  blackBackground: z.boolean(),
});

type Props = z.infer<typeof schema>;

const defaults: Props = {
  words: ["BASS", "DROPS", "NOW", "PULSE", "LIGHT", "SPACE"],
  mode: "flash",
  textColor: "#ffffff",
  backgroundColor: "#000000",
  fontSize: 180,
  fontWeight: 200,
  fontFamily: FONT_STACK,
  letterSpacing: "0.08em",
  useDownbeatsOnly: false,
  decay: 5,
  blackBackground: true,
};

const Renderer: React.FC<ElementRendererProps<Props>> = ({ element, ctx }) => {
  const { words, mode, textColor, backgroundColor, fontSize, fontWeight, fontFamily, letterSpacing, useDownbeatsOnly, decay, blackBackground } = element.props;
  if (words.length === 0) return null;

  const beatSource = useDownbeatsOnly ? ctx.beats.downbeats : ctx.beats.beats;
  const beatsInside = beatSource.filter((t) => t >= element.startSec && t <= ctx.absTimeSec);
  if (beatsInside.length === 0) return null;

  const wordIndex = (beatsInside.length - 1) % words.length;
  const word = words[wordIndex];
  const lastBeatTime = beatsInside[beatsInside.length - 1];
  const opacity = mode === "cut" ? 1 : expDecay(ctx.absTimeSec - lastBeatTime, decay);
  const kick = mode === "flash" ? 0.96 + opacity * 0.06 : 1;

  return (
    <>
      {blackBackground && (
        <div style={{ position: "absolute", inset: 0, backgroundColor }} />
      )}
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity,
          transform: `scale(${kick})`,
        }}
      >
        <div
          style={{
            fontFamily,
            fontSize,
            fontWeight,
            letterSpacing,
            color: textColor,
            textTransform: "uppercase",
            whiteSpace: "pre",
          }}
        >
          {word}
        </div>
      </div>
    </>
  );
};

export const BeatDropWordsModule: ElementModule<Props> = {
  id: "text.beatDrop",
  category: "text",
  label: "Beat Drop Words",
  description: "One word per detected beat (zeta drop). cut = hard swap, flash = decay envelope",
  defaultDurationSec: 18,
  defaultTrack: 1,
  schema,
  defaults,
  Renderer,
};
