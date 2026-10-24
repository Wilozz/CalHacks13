import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {useMutation,useQuery} from 'convex/react';
import {api} from '../../convex/_generated/api';
import type {Id} from '../../convex/_generated/dataModel';
const OpenProfile=createContext<(id:Id<'users'>)=>void>(()=>{});
export function MemberAvatar({userId,name,avatar}:{userId:Id<'users'>;name:string;avatar?:string|null}){
 const open=useContext(OpenProfile),[failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[avatar]);
 return <button type="button" className="member-avatar-button" aria-label={`View ${name}'s profile`} onClick={()=>open(userId)}>{avatar&&!failed?<img className="community-avatar" src={avatar} alt="" referrerPolicy="no-referrer" onError={()=>setFailed(true)}/>:<span className="community-avatar">{name.slice(0,1).toUpperCase()}</span>}</button>;
}
export function MemberStats({person}:{person:{rating:number|null;ratingCount:number;peopleHelped:number;helpSessions:number}}){return <dl className="member-stats"><div><dt>Rating</dt><dd>{person.rating===null?'—':person.rating.toFixed(1)}<small>{person.ratingCount?`${person.ratingCount} review${person.ratingCount===1?'':'s'}`:'Not rated yet'}</small></dd></div><div><dt>People helped</dt><dd>{person.peopleHelped}</dd></div><div><dt>Help sessions</dt><dd>{person.helpSessions}</dd></div></dl>;}
export function ProfileProvider({children,onMessage}:{children:ReactNode;onMessage:(id:Id<'conversations'>)=>void}){
 const [selected,setSelected]=useState<Id<'users'>>();
 return <OpenProfile.Provider value={setSelected}>{children}{selected&&<MemberDialog userId={selected} onClose={()=>setSelected(undefined)} onMessage={id=>{setSelected(undefined);onMessage(id);}}/>}</OpenProfile.Provider>;
}
function MemberDialog({userId,onClose,onMessage}:{userId:Id<'users'>;onClose:()=>void;onMessage:(id:Id<'conversations'>)=>void}){
 const person=useQuery(api.profiles.get,{userId}),message=useMutation(api.profiles.message),add=useMutation(api.social.addFriend),friends=useQuery(api.social.friends);
 const dialog=useRef<HTMLDialogElement>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;dialog.current?.showModal();const overflow=document.body.style.overflow;document.body.style.overflow='hidden';return()=>{document.body.style.overflow=overflow;previous?.focus();};},[]);
 const run=async(task:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await task();}catch(e){setError(e instanceof Error?e.message.split('Uncaught Error: ').pop()!.split('\n')[0]:'Please retry.');}finally{setBusy(false);}};
 const friendship=friends?.find((f:any)=>f.person.userId===userId);
 return <dialog ref={dialog} className="member-dialog" aria-label="Member profile" onCancel={e=>{e.preventDefault();onClose();}} onClick={e=>{if(e.target===dialog.current){const r=dialog.current.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)onClose();}}}><button className="member-close" autoFocus aria-label="Close profile" onClick={onClose}>×</button>{person===undefined?<p>Loading profile…</p>:person===null?<p>This profile is no longer available.</p>:<><div className="member-identity"><MemberAvatar userId={person.userId} name={person.displayName} avatar={person.avatar}/><div><h2>{person.displayName}</h2><p>{person.username?`@${person.username}`:'Community member'}</p></div></div><p className="member-bio">{person.bio||'No bio added yet.'}</p>{!!person.expertise.length&&<p className="member-expertise">{person.expertise.join(' · ')}</p>}<MemberStats person={person}/><div className="member-actions">{!person.isSelf&&<><button className="primary" disabled={busy} onClick={()=>void run(async()=>onMessage(await message({userId})))}>Message</button><button className="secondary" disabled={busy||!!friendship} onClick={()=>void run(()=>add({userId}))}>{friendship?.status==='accepted'?'Friends':friendship?friendship.sender===userId?'Request received':'Request sent':'Send request'}</button></>}</div>{error&&<p role="alert">{error}</p>}</>}</dialog>;
}
