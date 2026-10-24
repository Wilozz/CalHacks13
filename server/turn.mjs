import { createHmac, randomBytes } from 'node:crypto';
export function turnConfiguration(env = process.env, now = Date.now()) {
  const urls=(env.TURN_URLS??'').split(',').map(value=>value.trim()).filter(Boolean);
  if(urls.some(url=>!/^turns?:[^\s]+$/.test(url))) throw new Error('TURN_URLS must contain comma-separated turn: or turns: URLs.');
  const managed=!!env.TURN_USERNAME && !!env.TURN_PASSWORD;
  if(urls.length && !env.TURN_SHARED_SECRET && !managed) throw new Error('Set TURN_SHARED_SECRET for coturn, or both TURN_USERNAME and TURN_PASSWORD for a managed relay.');
  if(urls.length && env.TURN_SHARED_SECRET && (env.TURN_USERNAME || env.TURN_PASSWORD)) throw new Error('Choose one TURN authentication method: shared secret or managed username/password.');
  if(env.RELAY_ONLY==='true' && !urls.length) throw new Error('RELAY_ONLY requires TURN_URLS and valid TURN credentials.');
  const iceServers=[{urls:'stun:stun.l.google.com:19302'}];
  if(urls.length) {
    if(managed) iceServers.push({urls,username:env.TURN_USERNAME,credential:env.TURN_PASSWORD});
    else {
      const username=`${Math.floor(now/1000)+86400}:${randomBytes(8).toString('hex')}`;
      iceServers.push({urls,username,credential:createHmac('sha1',env.TURN_SHARED_SECRET).update(username).digest('base64')});
    }
  }
  return {iceServers,iceTransportPolicy:urls.length && env.RELAY_ONLY!=='false'?'relay':'all',relayConfigured:urls.length>0};
}
