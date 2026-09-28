import { ReactNode, useEffect } from "react"

/**
 * What this provider is FOR, after the widget era: the 'sidepanel' port that
 * lets the background broadcast SIDEPANEL_OPENED/CLOSED, and the
 * CLOSE_SIDEPANEL listener. It used to also message OPEN_SIDE_PANEL at the
 * active tab on every mount — a message nothing anywhere listened for — and
 * to read three preference fields it never used.
 */
export const SidepanelProvider = ({ children }: { children: ReactNode }) => {

  useEffect(()=>{
    const port = chrome.runtime.connect({ name: 'sidepanel' });

    return () => port.disconnect()

  }, [])

  useEffect(()=>{


    const messageHandler =  (request: any)=>{

      if(request.type === "CLOSE_SIDEPANEL"){
        window.close()
      }

    }

    chrome.runtime.onMessage.addListener(messageHandler)
    
    return () => chrome.runtime.onMessage.removeListener(messageHandler)

  },[])


  return <>{children}</>
}
