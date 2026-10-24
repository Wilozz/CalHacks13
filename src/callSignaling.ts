export const ROOM_PATTERN=/^[A-HJ-NP-Z2-9]{6}$/;
export function normalizeRoomCode(value:string):string {
  return value.toUpperCase().replace(/[\s-]/g,'');
}
export function validateRoomCode(value:string):string {
  const code=normalizeRoomCode(value);
  if(!ROOM_PATTERN.test(code))throw new Error('Enter the six-character room code from your friend.');
  return code;
}
export function signalingUrl():string {
  const configured=import.meta.env.VITE_SIGNALING_URL;
  const url=new URL(configured || '/signal',window.location.href);
  if(url.protocol==='http:')url.protocol='ws:';
  if(url.protocol==='https:')url.protocol='wss:';
  if(!['ws:','wss:'].includes(url.protocol))throw new Error('Calling server URL must use ws:// or wss://.');
  if(window.location.protocol==='https:' && url.protocol!=='wss:')throw new Error('HTTPS requires a secure wss:// calling server.');
  return url.href;
}
