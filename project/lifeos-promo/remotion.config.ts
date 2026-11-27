import { Config } from "@remotion/cli/config";
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);
// Системный Chrome: Remotion не может скачать свой headless shell в этой сети.
Config.setBrowserExecutable(process.env.REMOTION_CHROME ?? "/usr/bin/google-chrome");
Config.setChromiumOpenGlRenderer("angle");
