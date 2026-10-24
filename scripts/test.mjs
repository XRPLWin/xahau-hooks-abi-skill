/**
 * The scripts' own tests: the examples pass, overlapping projections are caught, and the
 * validator refuses what the explorer refuses. Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { normalise, lint, ManifestError } from './lib/manifest.js';
import { parser } from './lib/io.js';

const here = path.dirname(new URL(import.meta.url).pathname);
const ex = (p) => path.join(here, '..', 'examples', p);
const run = (script, ...args) => spawnSync(process.execPath, [path.join(here, script), ...args], { encoding: 'utf8' });

test('the examples decode every entry exactly once', () => {
  for (const cfg of ['xahaucards/check.issuer.json', 'xahaucards/check.shop.json', 'governance-game/check.json']) {
    const r = run('check.mjs', ex(cfg));
    assert.equal(r.status, 0, cfg + '\n' + r.stdout);
    assert.match(r.stdout, /Every entry decodes, by exactly one projection/);
  }
});

test('a short key also matched by an account-ID projection is caught', () => {
  //Account Place without its regex: nothing keeps the 2-byte key MC out of it
  const overlap = [
    { name: 'Current member count', selector: [{ type: 'Null', byteLength: 30 }, { type: 'VarString', byteLength: 2, pattern: 'MC' }], data: [{ type: 'UInt8' }] },
    { name: 'Account Place', selector: [{ type: 'Null', byteLength: 12 }, { type: 'AccountID' }], data: [{ type: 'UInt8' }] },
  ];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abi-'));
  fs.writeFileSync(path.join(dir, 'overlap.abi.json'), JSON.stringify(overlap));
  const cfg = JSON.parse(fs.readFileSync(ex('governance-game/check.json'), 'utf8'));
  cfg.hooks[0].manifest = 'overlap.abi.json';
  cfg.state = { [Object.keys(cfg.state)[0]]: ex('governance-game/state.json') };
  cfg.extra = {};
  const tmp = path.join(dir, 'check.json');
  fs.writeFileSync(tmp, JSON.stringify(cfg));
  const r = run('check.mjs', tmp);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /MATCHED MORE THAN ONCE 1 entry/);
  assert.match(r.stdout, /4D43 {2}by govern: Current member count \| govern: Account Place/);
});

test('every example manifest validates', () => {
  const files = [
    ...['mint', 'manager', 'shop', 'doors'].map((n) => ex(`xahaucards/${n}.abi.json`)),
    ex('governance-game/governance.manifest.json'),
    path.join(here, '..', 'templates', 'manifest.json'),
  ];
  for (const f of files) {
    const r = run('validate.mjs', f);
    assert.equal(r.status, 0, f + '\n' + r.stdout);
  }
});

test('decode explains a miss', () => {
  const r = run('decode.mjs', ex('xahaucards/doors.abi.json'), '00000000000000000000000000000000000000000000000000004752414E5453', '0231');
  assert.match(r.stdout, /data: the segments cover 4 bytes|Insufficient data: need 4 bytes, have 2/);
  const ok = run('decode.mjs', ex('xahaucards/doors.abi.json'), '00000000000000000000000000000000000000000000000000004752414E5453', '00000231');
  assert.match(ok.stdout, /MATCH {2}Grant allowance\n {7}Grants left=561/);
});

test('the validator refuses what the explorer refuses', () => {
  const seg = (s) => ({ name: 'x', abi: { hookStates: [{ name: 'p', selector: [s], data: [] }] } });
  const refused = {
    'The hook name is required.': { abi: { hookStates: [] } },
    'unknown type "Foo"': seg({ type: 'Foo' }),
    'byteLength must be 1-65535': seg({ type: 'Blob', byteLength: 0 }),
    'only containers have items': seg({ type: 'UInt8', items: [{ type: 'UInt8' }] }),
    'containers nest at most two deep': seg({ type: 'Array', items: [{ type: 'Array', items: [{ type: 'Array', items: [{ type: 'UInt8' }] }] }] }),
    'Repository URL must be an http(s) address': { name: 'x', repo: 'javascript:alert(1)' },
    'the selector (HookStateKey) is empty': { name: 'x', abi: { hookStates: [{ name: 'p', selector: [], data: [] }] } },
  };
  for (const [msg, input] of Object.entries(refused)) {
    assert.throws(() => normalise(input), (e) => e instanceof ManifestError && e.message.includes(msg), msg);
  }
});

test('lint finds projections that can never match', () => {
  const p = (selector, data = []) => normalise([{ name: 'p', selector, data }]).manifest;
  assert.match(lint(p([{ type: 'Null', byteLength: 30 }, { type: 'VarString', byteLength: 3, pattern: 'FEE' }])).errors.join(), /covers 33 bytes/);
  assert.match(lint(p([{ type: 'Null', byteLength: 29 }, { type: 'VarString', byteLength: 3, pattern: 'FEES' }])).errors.join(), /is 4 bytes but the segment is 3/);
  assert.match(lint(p([{ type: 'Hash256' }], [{ type: 'VarString' }, { type: 'UInt8' }])).errors.join(), /takes the rest of the value/);
  assert.match(lint(p([{ type: 'Hash256' }], [{ type: 'NativeAmount' }])).warnings.join(), /plain integer needs UInt64/);
  assert.equal(lint(p([{ type: 'Null', byteLength: 29, exclude: true }, { type: 'VarString', byteLength: 3, pattern: 'FEE', exclude: true }], [{ type: 'UInt64', endianness: 'BE' }])).errors.length, 0);
});

test('the decoder reads both byte orders', () => {
  const d = parser();
  const key = '0'.repeat(58) + '464545'; //"FEE"
  const sel = [{ type: 'Null', byteLength: 29 }, { type: 'VarString', byteLength: 3, pattern: 'FEE' }];
  assert.equal(d.decodeHookState(key, '0000000000000001', { selector: sel, data: [{ type: 'UInt64', endianness: 'BE' }] }).HookStateData[0].value, '1');
  assert.equal(d.decodeHookState(key, '0100000000000000', { selector: sel, data: [{ type: 'UInt64' }] }).HookStateData[0].value, '1');
});
