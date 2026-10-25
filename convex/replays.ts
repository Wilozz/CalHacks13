import {v} from 'convex/values';
import {action,internalMutation,mutation,query} from './_generated/server';
import {internal} from './_generated/api';
import type {Id} from './_generated/dataModel';
import {decodeReplay,MAX_REPLAY_BYTES} from '../src/replay/log';
// shortcut: ownerKey is a random id kept in the browser, not auth; anyone holding it owns those replays. Fine for the demo, use accounts if replays get shared.
const ownerKey=v.string();
const checkKey=(key:string)=>{if(!/^[a-f0-9]{32}$/.test(key))throw new Error('Invalid owner key');};
export const generateUploadUrl=mutation({args:{},handler:async ctx=>await ctx.storage.generateUploadUrl()});
/** Checks the uploaded log (size, then every field with the call's own decoders) before it becomes a replay; a bad upload is deleted. */
export const save=action({args:{storageId:v.id('_storage'),name:v.string(),ownerKey},handler:async(ctx,{storageId,name,ownerKey}):Promise<Id<'replays'>>=>{
 const blob=await ctx.storage.get(storageId);
 const replay=blob&&blob.size<=MAX_REPLAY_BYTES?decodeReplay(await blob.text()):null;
 try{checkKey(ownerKey);if(!replay)throw new Error('Not a valid tutorial recording');}catch(e){await ctx.storage.delete(storageId);throw e;}
 return await ctx.runMutation(internal.replays.insert,{ownerKey,storageId,durationMs:replay.durationMs,label:replay.label,name:name.trim().slice(0,80)||`${replay.label} lesson`});
}});
export const insert=internalMutation({args:{ownerKey,storageId:v.id('_storage'),durationMs:v.number(),label:v.string(),name:v.string()},handler:async(ctx,{storageId,...rest})=>await ctx.db.insert('replays',{...rest,logFile:storageId})});
// shortcut: anyone holding a fresh replay id can add it to their Tutorials; the id only travels over the call's own data channel. Use accounts if replays get shared wider.
const SHARE_MS=10*60_000;
/** The other person in the call keeps the same recording: a second row pointing at the same log file. */
export const copy=mutation({args:{id:v.id('replays'),ownerKey},handler:async(ctx,{id,ownerKey}):Promise<Id<'replays'>>=>{
 checkKey(ownerKey);
 const r=await ctx.db.get(id);
 if(!r||Date.now()-r._creationTime>SHARE_MS)throw new Error('Tutorial not found');
 const mine=(await ctx.db.query('replays').withIndex('by_logFile',q=>q.eq('logFile',r.logFile)).take(10)).find(x=>x.ownerKey===ownerKey);
 return mine?mine._id:await ctx.db.insert('replays',{ownerKey,name:r.name,label:r.label,durationMs:r.durationMs,logFile:r.logFile});
}});
export const list=query({args:{ownerKey},handler:async(ctx,{ownerKey})=>{
 const rows=await ctx.db.query('replays').withIndex('by_ownerKey',q=>q.eq('ownerKey',ownerKey)).order('desc').take(100);
 return rows.map(({_id,_creationTime,name,label,durationMs})=>({_id,_creationTime,name,label,durationMs}));
}});
export const get=query({args:{id:v.id('replays'),ownerKey},handler:async(ctx,{id,ownerKey})=>{
 const r=await ctx.db.get(id);
 return r&&r.ownerKey===ownerKey?{name:r.name,label:r.label,durationMs:r.durationMs,url:await ctx.storage.getUrl(r.logFile)}:null;
}});
export const rename=mutation({args:{id:v.id('replays'),name:v.string(),ownerKey},handler:async(ctx,{id,name,ownerKey})=>{
 const r=await ctx.db.get(id);
 if(!r||r.ownerKey!==ownerKey)throw new Error('Tutorial not found');
 await ctx.db.patch(id,{name:name.trim().slice(0,80)||r.name});
 return null;
}});
export const remove=mutation({args:{id:v.id('replays'),ownerKey},handler:async(ctx,{id,ownerKey})=>{
 const r=await ctx.db.get(id);
 if(!r||r.ownerKey!==ownerKey)throw new Error('Tutorial not found');
 await ctx.db.delete(id);
 // Shared with the other person in the call: the file goes when its last owner deletes it.
 if(!await ctx.db.query('replays').withIndex('by_logFile',q=>q.eq('logFile',r.logFile)).first())await ctx.storage.delete(r.logFile);
 return null;
}});
