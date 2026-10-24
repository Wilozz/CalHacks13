import {Component,forwardRef,useEffect,useRef,useState,type ReactNode} from 'react';
import {Canvas,useFrame} from '@react-three/fiber';
import type {Group} from 'three';
export interface DotGlobeHeroProps{rotationSpeed?:number;globeRadius?:number;className?:string;children?:ReactNode}
function Globe({rotationSpeed,radius}:{rotationSpeed:number;radius:number}){
 const group=useRef<Group>(null);
 useFrame((_,delta)=>{if(group.current){group.current.rotation.y+=rotationSpeed*delta*60;group.current.rotation.x+=rotationSpeed*delta*18;}});
 return <group ref={group} rotation={[.25,0,.12]}><mesh><sphereGeometry args={[radius,32,20]}/><meshBasicMaterial color="#bcbcbc" transparent opacity={.14} wireframe depthWrite={false}/></mesh><points><sphereGeometry args={[radius*1.004,32,20]}/><pointsMaterial color="#eeeeee" size={.013} transparent opacity={.55} sizeAttenuation/></points></group>;
}
class GlobeBoundary extends Component<{children:ReactNode},{failed:boolean}>{
 state={failed:false};static getDerivedStateFromError(){return {failed:true};}
 render(){return this.state.failed?<div className="globe-fallback"/>:this.props.children;}
}
/** Adapted from the supplied hero using the project's existing R3F camera, no Drei dependency. */
export const DotGlobeHero=forwardRef<HTMLDivElement,DotGlobeHeroProps>(function DotGlobeHero({rotationSpeed=.002,globeRadius=1,className='',children},ref){
 const container=useRef<HTMLDivElement>(null),[visible,setVisible]=useState(false),[reduced,setReduced]=useState(true);
 useEffect(()=>{const mq=matchMedia('(prefers-reduced-motion: reduce)'),update=()=>setReduced(mq.matches);update();mq.addEventListener('change',update);return()=>mq.removeEventListener('change',update);},[]);
 useEffect(()=>{const node=container.current;if(!node)return;const observer=new IntersectionObserver(([entry])=>setVisible(entry.isIntersecting));observer.observe(node);return()=>observer.disconnect();},[]);
 return <div ref={ref} className={`globe-hero ${className}`}><div ref={container} className="globe-art" aria-hidden="true"><GlobeBoundary><Canvas camera={{position:[0,0,3],fov:55}} dpr={[1,1.25]} frameloop={visible&&!reduced?'always':'demand'} gl={{alpha:true,antialias:false,powerPreference:'low-power'}} fallback={<div className="globe-fallback"/>}><Globe rotationSpeed={rotationSpeed} radius={globeRadius}/></Canvas></GlobeBoundary></div><div className="globe-hero-content">{children}</div></div>;
});
