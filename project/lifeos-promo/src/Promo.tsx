import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame } from "remotion";
import { config } from "./config";
import { sec } from "./anim";
import { Background, FontFaces, SceneFade } from "./ui";
import { SceneApp, SceneFinal, SceneFood, SceneMulti, SceneReceipt, SceneSplit } from "./scenes";

const SCENES: { key: keyof typeof config.timing; C: React.FC }[] = [
  { key: "food", C: SceneFood },
  { key: "split", C: SceneSplit },
  { key: "multi", C: SceneMulti },
  { key: "receipt", C: SceneReceipt },
  { key: "app", C: SceneApp },
  { key: "final", C: SceneFinal },
];

const Faded: React.FC<{ total: number; first: boolean; last: boolean; children: React.ReactNode }> = ({ total, first, last, children }) => {
  const f = useCurrentFrame();
  return <SceneFade frame={f} total={total} ov={config.crossfadeFrames} first={first} last={last}>{children}</SceneFade>;
};

export const Promo: React.FC = () => {
  const ov = config.crossfadeFrames;
  return (
    <AbsoluteFill>
      <FontFaces />
      <Background />
      {SCENES.map(({ key, C }, i) => {
        const t = config.timing[key];
        const first = i === 0;
        const last = i === SCENES.length - 1;
        const from = sec(t.start);
        const total = sec(t.end) - from + (last ? 0 : ov);
        return (
          <Sequence key={key} from={from} durationInFrames={total} name={key}>
            <Faded total={total} first={first} last={last}><C /></Faded>
          </Sequence>
        );
      })}
      {config.audio.enabled && <Audio src={staticFile(config.audio.file)} volume={config.audio.volume} />}
    </AbsoluteFill>
  );
};
