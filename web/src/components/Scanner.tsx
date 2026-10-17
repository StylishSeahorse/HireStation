import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Camera, CameraOff, ScanLine } from 'lucide-react';
import clsx from 'clsx';
import { api } from '@/lib/api';
import { BarcodeEntry, normaliseCode, ScanResult } from '@/lib/scan';
import { Button } from '@/components/ui';

/** All barcodes, fetched once so each scan is an instant local lookup. */
export function useBarcodes(enabled = true) {
  const q = useQuery({ queryKey: ['barcodes'], queryFn: () => api('/barcodes') as Promise<BarcodeEntry[]>, enabled, staleTime: 60_000 });
  const map = new Map<string, BarcodeEntry>((q.data ?? []).map((e) => [e.code, e]));
  return { ...q, map };
}

let audio: AudioContext | null = null;
function beep(ok: boolean) {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const g = audio.createGain();
    o.frequency.value = ok ? 1500 : 220;
    o.type = ok ? 'sine' : 'square';
    g.gain.value = 0.08;
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + (ok ? 0.08 : 0.3));
  } catch { /* no audio available */ }
  try { navigator.vibrate?.(ok ? 40 : [80, 60, 80]); } catch { /* not supported */ }
}

const toneClass = { ok: 'text-emerald-700', warn: 'text-amber-700', error: 'text-rose-700 font-medium' };

/**
 * Scan input for USB/Bluetooth scanners (they type the code and press Enter) and, over HTTPS,
 * the device camera. `onScan` applies the scan and says how it went.
 */
export function ScanBox({ onScan, onDone }: { onScan: (code: string) => ScanResult; onDone: () => void }) {
  const [text, setText] = useState('');
  const [log, setLog] = useState<(ScanResult & { id: number })[]>([]);
  const [camera, setCamera] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const handler = useRef(onScan);
  handler.current = onScan;

  const submit = (raw: string) => {
    const code = normaliseCode(raw);
    if (!code) return;
    const r = handler.current(code);
    beep(r.tone !== 'error');
    setLog((l) => [{ ...r, id: ++seq.current }, ...l].slice(0, 8));
  };

  useEffect(() => { input.current?.focus(); }, []);

  return (
    <div className="mb-4 rounded-lg border-2 border-brand-accent/40 bg-slate-50 p-3">
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); submit(text); setText(''); }}>
        <ScanLine size={18} className="text-brand-accent" />
        <input ref={input} value={text} onChange={(e) => setText(e.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false}
          placeholder="Scan a barcode (or type it and press Enter)" aria-label="Barcode"
          className="min-w-0 flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-accent" />
        <Button type="button" size="sm" variant="secondary" onClick={() => setCamera((c) => !c)}>{camera ? <><CameraOff size={14} /> Stop camera</> : <><Camera size={14} /> Camera</>}</Button>
        <Button type="button" size="sm" onClick={onDone}>Finish scanning</Button>
      </form>
      {camera && <CameraScanner onCode={submit} />}
      <ul className="mt-2 space-y-0.5 text-sm" aria-live="polite">
        {log.map((r, i) => <li key={r.id} className={clsx(toneClass[r.tone], i > 0 && 'opacity-60')}>{r.tone === 'ok' ? '✓' : r.tone === 'warn' ? '!' : '✕'} {r.text}</li>)}
      </ul>
    </div>
  );
}

function CameraScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError('The camera only works when HireStation is opened over HTTPS. Use a USB or Bluetooth scanner, or type the code.');
      return;
    }
    let stop: (() => void) | undefined;
    let cancelled = false;
    // The camera sees a label on many frames in a row: count it once, then only again after the
    // code has been out of view for a moment (i.e. the next item with the same label).
    let last = '';
    let lastSeen = 0;
    (async () => {
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([import('@zxing/browser'), import('@zxing/library')]);
      const hints = new Map([[DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128, BarcodeFormat.QR_CODE, BarcodeFormat.EAN_13, BarcodeFormat.CODE_39]]]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
      try {
        const controls = await reader.decodeFromConstraints({ video: { facingMode: 'environment' } }, video.current!, (result) => {
          if (!result) return;
          const code = result.getText();
          const now = Date.now();
          if (code !== last || now - lastSeen > 800) cb.current(code);
          last = code;
          lastSeen = now;
        });
        if (cancelled) controls.stop(); else stop = () => controls.stop();
      } catch (e) {
        if (!cancelled) setError(e instanceof Error && e.name === 'NotAllowedError' ? 'Camera permission was refused.' : `Couldn't start the camera: ${(e as Error).message}`);
      }
    })();
    return () => { cancelled = true; stop?.(); };
  }, []);

  if (error) return <p className="mt-2 text-sm text-amber-800">{error}</p>;
  return <video ref={video} muted playsInline className="mt-2 max-h-64 w-full max-w-md rounded bg-black object-cover" />;
}
