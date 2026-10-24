import type {MutationCtx} from './_generated/server';
import type {Id} from './_generated/dataModel';
/** Existing handles win. New accounts get a stable, searchable handle immediately. */
export async function defaultUsername(ctx:MutationCtx,userId:Id<'users'>,name:string){
 const cleaned=name.trim().toLowerCase().replace(/[^a-z0-9_]/g,'').slice(0,24),base=cleaned.length>=3?cleaned:'member';
 let candidate=base,attempt=0;
 while(await ctx.db.query('profiles').withIndex('by_username',q=>q.eq('username',candidate)).unique()){
  const suffix=`_${userId.slice(-8)}${attempt?`_${attempt}`:''}`;candidate=base.slice(0,24-suffix.length)+suffix;attempt++;
 }
 return candidate;
}
