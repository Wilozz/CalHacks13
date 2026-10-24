import {ConvexHttpClient} from 'convex/browser';
import {makeFunctionReference} from 'convex/server';
export function communityBridge(url) {
 if(!url)return null;
 return {
  async authorize(id,token){
   const client=new ConvexHttpClient(url);client.setAuth(token);
   const assignment=await client.query(makeFunctionReference('community:authorize'),{id});
   return {...assignment,client};
  },
  async check(member){if(member?.communityAuth)await member.communityAuth.client.query(makeFunctionReference('community:authorize'),{id:member.communityAuth.sessionId});},
  async event(member,event){if(member?.communityAuth)await member.communityAuth.client.mutation(makeFunctionReference(`community:${event}`),{id:member.communityAuth.sessionId});},
 };
}
