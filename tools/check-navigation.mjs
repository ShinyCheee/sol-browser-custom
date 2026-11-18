// Windows integration check: node tools/check-navigation.mjs [path/to/Sol.exe] [flags...]
// Uses a disposable profile and a local server; never touches the user's session.
import { runBaseNavigation } from './navigation-checks/base-navigation.mjs';
import { runCapturesAndExtensions } from './navigation-checks/captures-and-extensions.mjs';
import { runDesign, runReader } from './navigation-checks/design-and-reader.mjs';
import { createNavigationHarness } from './navigation-checks/harness.mjs';
import { runLanguages } from './navigation-checks/languages.mjs';
import { runAnchors, runMarkdown, runScale, runUsability } from './navigation-checks/markdown-and-usability.mjs';
import {
  runPlayerWindow,
  runStartRefresh,
  runVideoCursor,
  runVideoCursorNative,
} from './navigation-checks/media-and-start.mjs';
import { runNetworkLot } from './navigation-checks/network.mjs';
import { runNotes } from './navigation-checks/notes.mjs';
import { runHistory, runPalette } from './navigation-checks/palette-and-history.mjs';
import { runSessions } from './navigation-checks/sessions.mjs';
import { runSiteReset, runSiteSessions } from './navigation-checks/site-isolation.mjs';
import { runSolAi } from './navigation-checks/sol-ai.mjs';

const argv = process.argv;
const has = flag => argv.includes(flag);

const ctx = await createNavigationHarness(argv);

try {
  await ctx.launch(has('--private-check') ? ['--private'] : []);

  if (has('--start-refresh')) await runStartRefresh(ctx);
  else if (has('--player-window')) await runPlayerWindow(ctx);
  else if (has('--video-cursor-native')) await runVideoCursorNative(ctx);
  else if (has('--video-cursor')) await runVideoCursor(ctx);
  else if (has('--markdown')) await runMarkdown(ctx);
  else if (has('--site-reset')) await runSiteReset(ctx);
  else if (has('--site-sessions')) await runSiteSessions(ctx);
  else if (has('--usability')) await runUsability(ctx);
  else if (has('--sessions')) await runSessions(ctx);
  else if (has('--network-lot')) await runNetworkLot(ctx);
  else if (has('--design')) await runDesign(ctx);
  else if (has('--anchors')) await runAnchors(ctx);
  else if (has('--palette')) await runPalette(ctx);
  else if (has('--reader')) await runReader(ctx);
  else if (has('--notes')) await runNotes(ctx);
  else if (has('--languages')) await runLanguages(ctx);
  else if (has('--history')) await runHistory(ctx);
  else if (has('--sol-ai')) await runSolAi(ctx);
  else if (has('--scale')) await runScale(ctx);
  else if (has('--extensions') || has('--captures')) await runCapturesAndExtensions(ctx);
  else await runBaseNavigation(ctx);
} catch (error) {
  await ctx.dumpDiagnostics();
  throw error;
} finally {
  ctx.cleanup();
}
