import type {Metadata} from "next";import {Cormorant_Garamond,DM_Sans} from "next/font/google";import "./globals.css";
const display=Cormorant_Garamond({variable:"--display",subsets:["latin"],weight:["400","500","600"],style:["normal","italic"]}),sans=DM_Sans({variable:"--sans",subsets:["latin"],weight:["400","500","600"]});
export const metadata:Metadata={title:"Aranya House — Your stay, beautifully considered",description:"A private digital guest experience for a fictional luxury retreat in Mussoorie."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body className={`${display.variable} ${sans.variable}`}>{children}</body></html>}
