import type {ReactNode} from 'react';
/** Shared, understated page typography. */
export function PageHeading({title,description,children,compact=false}:{eyebrow:string;title:ReactNode;description?:string;children?:ReactNode;compact?:boolean}){
 return <div className={`page-heading${compact?' compact':''}`}><h1>{title}</h1>{description&&<p className="page-description">{description}</p>}{children}</div>;
}
