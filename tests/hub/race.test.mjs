/**
 * Hub race scenarios for The 15 Puzzle (diffenderfer-games docs/multiplayer.md
 * "Races"), driven by the hub's test kit against a real host with this game
 * linked in (it is built and started like production).
 *
 *   npm run test:hub                  (DG_HOST=path/to/diffenderfer-games to override)
 *
 *   1. Race button → Easy → Start; a second player joins from Open races →
 *      both get the same board → the HUD shows the other's moves → solving
 *      wins → result cards → race history.
 *   2. A private race joined with its code → Give up → the other player wins.
 */
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HUB = process.env.DG_HOST || resolve(ROOT, '..', 'diffenderfer-games');
const { e2e, e2eEnv } = await import(pathToFileURL(resolve(HUB, 'test/e2e/helpers.mjs')).href);
const { solve, findZero, areAdjacent } = await import(pathToFileURL(resolve(ROOT, 'shared/dist/index.js')).href);

const SLUG = 'the15puzzle';
const L = '#hub-social-layer >>> ';
const env = e2eEnv({
  apps: { [SLUG]: ROOT },
  env: {
    P15_DB_PATH: join(mkdtempSync(join(tmpdir(), 'p15-test-')), 'p15.db'),
    HUB_LIMITS_JSON: JSON.stringify({ raceCountdownMs: 1500 }),
  },
});

const raceState = (p) => p.page.evaluate(() => window.__P15_RACE__ || null);
const waitLive = (p) => p.page.waitForFunction(() => window.__P15_RACE__ && window.__P15_RACE__.live, { timeout: 30_000, polling: 100 });

/** Slide the tile showing `value` (a real click on the board). */
async function slide(p, value) {
  const before = (await raceState(p)).moves;
  await p.page.evaluate((v) => [...document.querySelectorAll('.board .tile')].find((t) => t.textContent === String(v)).click(), value);
  await p.page.waitForFunction((n) => window.__P15_RACE__.moves === n, { polling: 50 }, before + 1);
}

/** Any tile next to the blank. */
function movable(board) {
  const z = findZero(board);
  return board[board.findIndex((v, i) => v !== 0 && areAdjacent(i, z))];
}

e2e('race: Start (Easy) → join from Open races → same board → live moves → solve wins → history', env, async (t) => {
  const alice = await t.newPlayer(undefined, `/${SLUG}/`);
  const bob = await t.newPlayer(undefined, `/${SLUG}/race`);
  await alice.page.click('[data-testid="race-button"]');
  await alice.tid('race-scramble-easy');
  await alice.tid('race-start');
  await alice.find(`${L}.so-dialog .so-dtitle`, 'Race · The 15 Puzzle');
  await alice.find(`${L}.so-dialog .so-rparams`, 'Scramble Easy');

  await bob.page.waitForFunction((name) => [...document.querySelectorAll('.race-list li')].some((li) => li.textContent.includes(name)), { timeout: 20_000, polling: 200 }, alice.name);
  await bob.page.evaluate(() => document.querySelector('.race-list .race-join').click());
  await Promise.all([waitLive(alice), waitLive(bob)]);
  const [ra, rb] = await Promise.all([raceState(alice), raceState(bob)]);
  assert.equal(ra.seed, rb.seed);
  assert.deepEqual(ra.board, rb.board, 'both racers get the same scramble');

  await slide(bob, movable(rb.board));
  await alice.find(`${L}.so-hud .so-hudrow`, new RegExp(`${bob.name}.*Moves 1`));

  const { moves, truncated } = solve(ra.board);
  assert.ok(!truncated && moves.length > 0);
  // A bot solves it well inside game.race.minMs (3 s): the hub refuses that
  // finish, and the race runtime re-sends it once 3 s have passed.
  for (const v of moves) await slide(alice, v);
  await alice.find(`${L}.so-dialog .so-dtitle`, 'You won! 🏆');
  await alice.find(`${L}.so-dialog .so-rres`, new RegExp(`Moves ${moves.length}`));
  await bob.find(`${L}.so-dialog .so-dtitle`, `${alice.name} won`);
  await alice.click(`${L}.so-dialog button`, '📜 Races');
  await alice.find(`${L}.so-dialog .so-rsum`, '1 race · 1 win');
  await alice.find(`${L}.so-dialog .so-rhist .so-status`, 'The 15 Puzzle · Scramble Easy');
});

e2e('race: a private race joined by code → Give up → the other player wins', env, async (t) => {
  const alice = await t.newPlayer(undefined, `/${SLUG}/race`);
  const bob = await t.newPlayer(undefined, `/${SLUG}/race`);
  await alice.tid('race-private');
  await alice.tid('race-start');
  const code = await (await alice.find(`${L}.so-dialog .so-rcode b`)).evaluate((b) => b.textContent);
  await alice.find(`${L}.so-dialog .so-rcode`, 'Private');
  await bob.tid('race-browse');
  const input = await bob.find(`${L}.so-dialog .so-codein`);
  await input.type(code);
  await bob.click(`${L}.so-dialog button`, /^Join$/);
  await Promise.all([waitLive(alice), waitLive(bob)]);
  await bob.tid('race-giveup');
  await alice.find(`${L}.so-dialog .so-dtitle`, 'You won! 🏆');
  await alice.find(`${L}.so-dialog .so-rhow`, `${bob.name} gave up — you win!`);
  await bob.find(`${L}.so-dialog .so-rhow`, 'You gave up.');
});
