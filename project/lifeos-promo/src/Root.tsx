import React from "react";
import { Composition } from "remotion";
import { Promo } from "./Promo";
import { Day, DAY_SECONDS } from "./Day";
import { Fix, FIX_SECONDS } from "./Fix";
import { Money, MONEY_SECONDS } from "./Money";
import { Quit, QUIT_SECONDS } from "./Quit";
import { Duel, DUEL_SECONDS } from "./Duel";
import { Apps, APPS_SECONDS } from "./Apps";
import { Debt, DEBT_SECONDS } from "./Debt";
import { FPS, H, W } from "./tokens";
import { totalSeconds } from "./config";

export const Root: React.FC = () => (
  <>
    <Composition id="Promo" component={Promo} durationInFrames={Math.round(totalSeconds * FPS)} fps={FPS} width={W} height={H} />
    <Composition id="Day" component={Day} durationInFrames={Math.round(DAY_SECONDS * FPS)} fps={FPS} width={W} height={H} />
    <Composition id="Fix" component={Fix} durationInFrames={Math.round(FIX_SECONDS * FPS)} fps={FPS} width={W} height={H} />
    <Composition id="Money" component={Money} durationInFrames={Math.round(MONEY_SECONDS * FPS)} fps={FPS} width={W} height={H} />
    <Composition id="Quit" component={Quit} durationInFrames={Math.round(QUIT_SECONDS * FPS)} fps={FPS} width={W} height={H} />
    <Composition id="Duel" component={Duel} durationInFrames={Math.round(DUEL_SECONDS * FPS)} fps={FPS} width={W} height={H} />
    <Composition id="Apps" component={Apps} durationInFrames={Math.round(APPS_SECONDS * FPS)} fps={FPS} width={W} height={H} />
    <Composition id="Debt" component={Debt} durationInFrames={Math.round(DEBT_SECONDS * FPS)} fps={FPS} width={W} height={H} />
  </>
);
