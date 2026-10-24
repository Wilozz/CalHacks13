import {Presence} from '@convex-dev/presence';
import {getAuthUserId} from '@convex-dev/auth/server';
import {v} from 'convex/values';
import {components} from './_generated/api';
import {mutation,query} from './_generated/server';
export const presence=new Presence(components.presence);
export const heartbeat=mutation({args:{roomId:v.string(),userId:v.string(),sessionId:v.string(),interval:v.number()},returns:v.object({roomToken:v.string(),sessionToken:v.string()}),handler:async(ctx,a)=>{
 const id=await getAuthUserId(ctx);if(!id||a.userId!==id||a.roomId!=='community'||a.sessionId.length>300)throw new Error('Unauthorized presence');
 return presence.heartbeat(ctx,'community',id,a.sessionId,10_000);
}});
export const list=query({args:{roomToken:v.string()},returns:v.any(),handler:async(ctx,a)=>{if(!await getAuthUserId(ctx))throw new Error('Sign in first');return presence.list(ctx,a.roomToken,100);}});
// Presence tokens are scoped, unguessable disconnect capabilities used by sendBeacon after tab closure.
export const disconnect=mutation({args:{sessionToken:v.string()},returns:v.null(),handler:async(ctx,a)=>presence.disconnect(ctx,a.sessionToken)});
