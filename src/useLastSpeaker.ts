import { useEffect, useState } from 'react';

/**
 * Who spoke last in the call, from the loudness of my microphone and the friend's audio: 'me' or 'friend'. A side takes
 * over after about 0.3 s of clearly louder speech, so a cough or the other side's echo does not flip it. Starts on the
 * friend.
 */
export function useLastSpeaker(local: MediaStream | null, remote: MediaStream | null, threshold = 0.02): 'me' | 'friend' {
  const [who, setWho] = useState<'me' | 'friend'>('friend');
  useEffect(() => {
    const tracks = [local, remote].map(s => s?.getAudioTracks().find(t => t.readyState === 'live') ?? null);
    if (!tracks.some(Boolean)) return;
    const ctx = new AudioContext();
    const meters = tracks.map(t => {
      if (!t) return null;
      const a = ctx.createAnalyser(); a.fftSize = 512;
      ctx.createMediaStreamSource(new MediaStream([t])).connect(a);
      return { a, buf: new Float32Array(a.fftSize), streak: 0 };
    });
    const id = window.setInterval(() => {
      const level = meters.map(m => { if (!m) return 0; m.a.getFloatTimeDomainData(m.buf); let s = 0; for (const x of m.buf) s += x * x; return Math.sqrt(s / m.buf.length); });
      meters.forEach((m, i) => {
        if (!m) return;
        m.streak = level[i] > threshold && level[i] > 1.3 * level[1 - i] ? m.streak + 1 : 0;
        if (m.streak >= 3) setWho(i === 0 ? 'me' : 'friend');
      });
    }, 100);
    void ctx.resume().catch(() => {});
    return () => { clearInterval(id); void ctx.close(); };
  }, [local, remote, threshold]);
  return who;
}
