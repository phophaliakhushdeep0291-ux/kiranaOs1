import type {Metadata} from "next";
import "./globals.css";
export const metadata:Metadata={title:"Aranya House — Your stay, beautifully considered",description:"A private digital guest experience for a fictional luxury retreat in Mussoorie."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
