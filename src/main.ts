import { Engine } from "./core/Engine";
import { SD } from "./state/SD";
import { LoaderScreen } from "./screens/LoaderScreen";

/**
 * Entry point. Boots the engine, loads saved data, and starts the front-end
 * flow: Loader (preloads audio) -> Menu -> Game, mirroring the original
 * Main() -> Loader -> Menu -> Game sequence.
 */
async function main() {
  const mount = document.getElementById("game");
  if (!mount) throw new Error("#game mount element not found");

  SD.init();
  const engine = await Engine.create(mount);
  engine.setScreen(LoaderScreen);
}

main().catch((err) => {
  console.error("Failed to start Raze:", err);
});
