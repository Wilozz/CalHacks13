import {useEffect,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useConvexAuth,useQuery} from 'convex/react';
import {ConvexAuthProvider} from '@convex-dev/auth/react';
import App from './App';
import {api} from '../convex/_generated/api';
import {ProfileProvider} from './community/MemberProfile';
import {Messages} from './community/Messages';
import type {Id} from '../convex/_generated/dataModel';
import {Tutorials} from './replay/Tutorials';
import {Community,Login,MemberPresence,Profile,type SessionLaunch} from './community/Community';
import '@fontsource-variable/inter';
import './style.css';
import './community/community.css';
import './design.css';
import {convex} from './convexClient';
import {Icon,type IconName} from './icons';
type Tab='call'|'tutorials'|'community'|'profile'|'messages'|'helpers'|'activity';
// Regular icon, then the filled one for the selected screen.
const TAB_ICONS:Record<Tab,[IconName,IconName]>={call:['video','videoFill'],community:['hand','handFill'],helpers:['users','usersFill'],activity:['clock','clockFill'],messages:['chat','chatFill'],tutorials:['cube','cubeFill'],profile:['user','userFill']};
function Root(){
 const [tab,setTab]=useState<Tab>(()=>location.hash==='#helpers'?'helpers':location.hash==='#activity'?'activity':location.hash==='#messages'?'messages':location.hash==='#tutorials'?'tutorials':location.hash==='#community'?'community':location.hash==='#profile'?'profile':'call');
 const [conversation,setConversation]=useState<Id<'conversations'>>();
 const [session,setSession]=useState<SessionLaunch>();
 useEffect(()=>{history.replaceState(null,'',tab==='call'?location.pathname+location.search:'#'+tab);},[tab]);
 const navigate=(next:Tab)=>{setSession(undefined);setTab(next);};
 const tabButton=(t:Tab)=><button key={t} aria-label={t==='messages'?'Messages':undefined} aria-pressed={tab===t} onClick={()=>navigate(t)}><Icon name={TAB_ICONS[t][tab===t?1:0]} size={22}/><span>{t==='community'?'Requests':t==='helpers'?'Helpers':t==='activity'?'Activity':t[0].toUpperCase()+t.slice(1)}</span>{t==='messages'&&convex&&<MessageRequestsBadge/>}</button>;
 return <ProfileProvider onMessage={id=>{setConversation(id);setTab('messages');}}>{convex&&<AuthPresence/>}{tab==='call'?<App communitySession={session}/>:tab==='tutorials'&&convex?<Tutorials/>:convex?<ProtectedPage tab={tab} conversation={conversation} onMessage={id=>{setConversation(id);setTab('messages');}} onJoin={launch=>{setSession(launch);setTab('call');}}/>:<section className="community-auth"><h1>Community setup needed</h1><p>Start the local Convex backend with <code>npm run convex</code>, run <code>npm run community:auth</code>, then restart the dev server. Manual calls still work.</p></section>}
 <nav className="tabs" aria-label="Screens"><b>Handoff</b><div className="tabs-links">{(['call','community','helpers','activity','messages','tutorials'] as Tab[]).map(t=>tabButton(t))}</div><div className="tabs-actions">{tabButton('profile')}</div></nav></ProfileProvider>;
}
function MessageRequestsBadge(){const {isAuthenticated}=useConvexAuth();return isAuthenticated?<RequestCount/>:null;}
function RequestCount(){const viewer=useQuery(api.community.viewer),friends=useQuery(api.social.friends);const count=friends?.filter((f:any)=>f.status==='pending'&&f.sender!==viewer?.userId).length??0;return count?<span className="nav-count" aria-label={`${count} friend requests`}>{count}</span>:null;}
function AuthPresence(){const {isAuthenticated}=useConvexAuth();return isAuthenticated?<MemberPresence/>:null;}
function ProtectedPage({tab,onJoin,onMessage,conversation}:{tab:Tab;conversation?:Id<'conversations'>;onMessage:(id:Id<'conversations'>)=>void;onJoin:(launch:SessionLaunch)=>void}){const {isAuthenticated,isLoading}=useConvexAuth();return isLoading?<p className="community-empty">Loading account…</p>:!isAuthenticated?<Login/>:tab==='profile'?<Profile/>:tab==='messages'?<Messages initial={conversation} onJoin={onJoin}/>:<Community view={tab==='helpers'?'helpers':tab==='activity'?'activity':'requests'} onJoin={onJoin} onMessage={onMessage}/>;}
createRoot(document.getElementById('root')!).render(convex?<ConvexAuthProvider client={convex}><Root/></ConvexAuthProvider>:<Root/>);
