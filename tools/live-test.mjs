// 不用麥克風，直接拿 WAV 檔測 Gemini Live 翻譯 API。
// 模擬 app 的雙向模式：同時開兩條連線（目標＝對方語言、目標＝我的語言），
// 用即時速度每 100ms 送一包 16kHz PCM16，最後補幾秒靜音，再印出每條連線收到什麼。
//
// 用法（API key 只從環境變數讀，不會印出來）：
//   PowerShell： $env:GEMINI_API_KEY = '...'; node tools/live-test.mjs tools/audio/zh.wav tools/audio/en.wav
//   參數：WAV 檔（16kHz/16-bit/mono）可以多個，依序測。
//   選項：--targets=en,zh-Hant  --model=...  --raw（印出每則原始訊息）
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => {
  const [k, v = '1'] = a.slice(2).split('='); return [k, v];
}));
const files = args.filter(a => !a.startsWith('--'));
// 環境變數沒有時，讀 repo 根目錄的 .env（已列在 .gitignore，不會被 commit）
if (!process.env.GEMINI_API_KEY) {
  try { process.loadEnvFile(new URL('../.env', import.meta.url)); } catch {}
}
const KEY = process.env.GEMINI_API_KEY;
const MODEL = opt.model || 'gemini-3.5-live-translate-preview';
const TARGETS = (opt.targets || 'en,zh-Hant').split(',');
const TAIL_SILENCE_MS = Number(opt.tail || 5000);
const WS_BASE = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

if (!KEY) { console.error('請先設定環境變數 GEMINI_API_KEY'); process.exit(2); }
if (!files.length) { console.error('請給至少一個 WAV 檔'); process.exit(2); }

function readWav(buf) {
  // 找 fmt 和 data chunk
  let p = 12, fmt = null, data = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), size = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') fmt = { ch: buf.readUInt16LE(p + 10), rate: buf.readUInt32LE(p + 12), bits: buf.readUInt16LE(p + 22) };
    if (id === 'data') data = buf.subarray(p + 8, p + 8 + size);
    p += 8 + size + (size & 1);
  }
  if (!fmt || !data) throw new Error('不是有效的 WAV');
  if (fmt.ch !== 1 || fmt.rate !== 16000 || fmt.bits !== 16) throw new Error(`WAV 必須是 16kHz/16-bit/mono，目前是 ${fmt.rate}Hz/${fmt.bits}-bit/${fmt.ch}ch`);
  return data;
}

const LANG_ALIAS = { tl: 'fil', in: 'id', iw: 'he', nb: 'no', nn: 'no' };
const baseLang = c => { const b = String(c || '').toLowerCase().split(/[-_]/)[0]; return LANG_ALIAS[b] || b; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shrink = (k, v) => (typeof v === 'string' && v.length > 120 && /data$/i.test(k)) ? `<base64 ${v.length}>` : v;

class Conn {
  constructor(target) {
    this.target = target; this.log = []; this.inText = ''; this.outText = '';
    this.inLang = new Set(); this.outLang = new Set(); this.audioBytes = 0; this.turns = 0;
    this.setupOk = false; this.close = null; this.other = {}; this.pcm = [];
    // 模擬 interpreter.html 的判斷：輸入語言＝目標語言就略過；靜音包不算
    this.appLang = ''; this.appText = ''; this.appAudioSec = 0;
  }
  open() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`${WS_BASE}?key=${encodeURIComponent(KEY)}`);
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      const t0 = Date.now();
      // 和 interpreter.html 相同：transcription 在 setup 頂層，translationConfig 在 generationConfig 裡
      ws.onopen = () => ws.send(JSON.stringify({ setup: { model: 'models/' + MODEL,
        generationConfig: { responseModalities: ['AUDIO'],
          translationConfig: { targetLanguageCode: this.target, echoTargetLanguage: false } },
        inputAudioTranscription: {}, outputAudioTranscription: {} } }));
      ws.onmessage = ev => {
        const text = typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8');
        let m; try { m = JSON.parse(text); } catch { this.log.push('非 JSON：' + text.slice(0, 200)); return; }
        const ms = Date.now() - t0;
        if (opt.raw) console.log(`  [→${this.target} +${ms}ms]`, JSON.stringify(m, shrink));
        for (const k of Object.keys(m)) if (k !== 'serverContent' && k !== 'setupComplete') this.other[k] = (this.other[k] || 0) + 1;
        if (m.setupComplete) { this.setupOk = true; resolve(); }
        const c = m.serverContent; if (!c) return;
        for (const k of Object.keys(c)) if (!['modelTurn', 'inputTranscription', 'outputTranscription', 'turnComplete'].includes(k)) this.other['serverContent.' + k] = (this.other['serverContent.' + k] || 0) + 1;
        const it = c.inputTranscription;
        if (it && it.text && it.text.trim() && it.languageCode) this.appLang = it.languageCode;
        const echo = !!this.appLang && baseLang(this.appLang) === baseLang(this.target);
        if (!echo && c.outputTranscription?.text?.trim()) this.appText += c.outputTranscription.text;
        if (!echo) for (const p of c.modelTurn?.parts || []) if (p.inlineData?.data) {
          const b = Buffer.from(p.inlineData.data, 'base64'); let loud = false;
          for (let i = 0; i + 1 < b.length; i += 2) { const v = b.readInt16LE(i); if (v > 655 || v < -655) { loud = true; break; } }
          if (loud) this.appAudioSec += b.length / 2 / 24000;
        }
        if (c.inputTranscription) { this.inText += c.inputTranscription.text || ''; if (c.inputTranscription.languageCode) this.inLang.add(c.inputTranscription.languageCode); }
        if (c.outputTranscription) { this.outText += c.outputTranscription.text || ''; if (c.outputTranscription.languageCode) this.outLang.add(c.outputTranscription.languageCode); }
        for (const p of c.modelTurn?.parts || []) if (p.inlineData?.data) { const b = Buffer.from(p.inlineData.data, 'base64'); this.audioBytes += b.length; this.pcm.push(b); this.audioMime = p.inlineData.mimeType; }
        if (c.turnComplete) this.turns++;
      };
      ws.onerror = () => {};
      ws.onclose = ev => { this.close = { code: ev.code, reason: ev.reason }; if (!this.setupOk) reject(new Error(`setup 前就被關閉：${ev.code} ${ev.reason}`)); };
    });
  }
  send(chunk) {
    if (this.ws.readyState !== 1) return;
    this.ws.send(JSON.stringify({ realtimeInput: { audio: { data: Buffer.from(chunk).toString('base64'), mimeType: 'audio/pcm;rate=16000' } } }));
  }
  // 音訊分析：RMS（0~1）和非靜音比例，判斷「保持安靜」的連線送回的是靜音還是真的聲音
  audioStats() {
    const b = Buffer.concat(this.pcm); const n = b.length >> 1; if (!n) return null;
    let sq = 0, loud = 0, peak = 0;
    for (let i = 0; i < n; i++) { const v = b.readInt16LE(i * 2) / 32768; sq += v * v; const a = Math.abs(v); if (a > 0.02) loud++; if (a > peak) peak = a; }
    return { rms: +Math.sqrt(sq / n).toFixed(4), peak: +peak.toFixed(3), 有聲比例: +(loud / n).toFixed(3) };
  }
  report() {
    return {
      目標語言: this.target, setupComplete: this.setupOk,
      原文逐字稿: this.inText.trim(), 原文languageCode: [...this.inLang],
      翻譯逐字稿: this.outText.trim(), 翻譯languageCode: [...this.outLang],
      app顯示字幕: this.appText.trim(), app播放秒數: +this.appAudioSec.toFixed(2),
      翻譯音訊秒數: +(this.audioBytes / 2 / 24000).toFixed(2), 音訊mimeType: this.audioMime, 音訊分析: this.audioStats(),
      turnComplete次數: this.turns, 其他訊息: this.other, close: this.close
    };
  }
}

const results = [];
for (const f of files) {
  const pcm = readWav(await readFile(f));
  console.log(`\n=== ${basename(f)}：${(pcm.length / 32000).toFixed(1)} 秒，目標 ${TARGETS.join(' / ')} ===`);
  const conns = TARGETS.map(t => new Conn(t));
  await Promise.all(conns.map(c => c.open()));
  console.log('  兩條連線都收到 setupComplete，開始送音訊');
  const CHUNK = 3200; // 100ms
  const silence = Buffer.alloc(CHUNK);
  const total = Math.ceil(pcm.length / CHUNK) + Math.ceil(TAIL_SILENCE_MS / 100);
  const start = Date.now();
  for (let i = 0; i < total; i++) {
    let chunk = i * CHUNK < pcm.length ? pcm.subarray(i * CHUNK, (i + 1) * CHUNK) : silence;
    if (chunk.length < CHUNK) chunk = Buffer.concat([chunk, silence.subarray(chunk.length)]);
    for (const c of conns) c.send(chunk);
    await sleep(Math.max(0, start + (i + 1) * 100 - Date.now()));
  }
  for (const c of conns) { try { c.ws.close(); } catch {} }
  await sleep(300);
  const outDir0 = join(import.meta.dirname, 'out'); await mkdir(outDir0, { recursive: true });
  for (const c of conns) {
    const d = Buffer.concat(c.pcm); if (!d.length) continue;
    const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + d.length, 4); h.write('WAVEfmt ', 8);
    h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(24000, 24);
    h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(d.length, 40);
    await writeFile(join(outDir0, basename(f, '.wav') + '-to-' + c.target + '.wav'), Buffer.concat([h, d]));
  }
  const r = { 檔案: basename(f), 連線: conns.map(c => c.report()) };
  console.log(JSON.stringify(r, null, 2));
  results.push(r);
}
const outDir = join(import.meta.dirname, 'out');
await mkdir(outDir, { recursive: true });
const outFile = join(outDir, `live-test-${Date.now()}.json`);
await writeFile(outFile, JSON.stringify(results, null, 2));
console.log('\n結果已存到 ' + outFile);
